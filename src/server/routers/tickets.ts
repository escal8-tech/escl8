/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import {
  businesses,
  customers,
  messageThreads,
  orders,
  supportTicketEvents,
  supportTicketTypes,
  supportTickets,
  threadMessages,
} from "../../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { normalizeOrderFlowSettings } from "@/lib/order-settings";
import { resolveInitialFulfillmentStatus } from "@/lib/order-operations";
import { DEFAULT_TICKET_TYPE_KEYS, ensureDefaultTicketTypes } from "../services/ticketDefaults";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { drainBusinessOutbox, enqueueWhatsAppOutboxMessages } from "@/server/services/messageOutbox";
import { assertExpectedUpdatedAt, assertOperationThrottle, getStaffActorKey } from "@/server/operationalHardening";
import { type BotSendMessage } from "../services/botApi";
import {
  buildOrderApprovalMessages,
  computeOrderExpectedAmount,
  extractOrderFulfillmentSeed,
  formatOrderItemsSummary,
  logOrderEvent,
  sanitizePhoneDigits,
} from "../services/orderFlow";

const ticketStatusSchema = z.enum(["open", "in_progress", "resolved"]);
const ticketPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
const ticketOutcomeSchema = z.enum(["pending", "won", "lost"]);
const orderStageSchema = z.enum([
  "pending_approval",
  "approved",
  "awaiting_payment",
  "payment_submitted",
  "payment_rejected",
  "paid",
  "refund_pending",
  "refunded",
  "denied",
]);
const ORDER_TICKET_OPERATION_LIMITS = {
  approve: {
    actorMax: Number(process.env.TICKET_APPROVE_ORDER_ACTOR_MAX ?? "30"),
    actorWindowMs: Number(process.env.TICKET_APPROVE_ORDER_ACTOR_WINDOW_MS ?? String(5 * 60 * 1000)),
    businessMax: Number(process.env.TICKET_APPROVE_ORDER_BUSINESS_MAX ?? "180"),
    businessWindowMs: Number(process.env.TICKET_APPROVE_ORDER_BUSINESS_WINDOW_MS ?? String(5 * 60 * 1000)),
    entityMax: Number(process.env.TICKET_APPROVE_ORDER_ENTITY_MAX ?? "2"),
    entityWindowMs: Number(process.env.TICKET_APPROVE_ORDER_ENTITY_WINDOW_MS ?? String(10 * 60 * 1000)),
    message: "This ticket is being actioned too frequently. Please wait a moment and try again.",
  },
  deny: {
    actorMax: Number(process.env.TICKET_DENY_ORDER_ACTOR_MAX ?? "30"),
    actorWindowMs: Number(process.env.TICKET_DENY_ORDER_ACTOR_WINDOW_MS ?? String(5 * 60 * 1000)),
    businessMax: Number(process.env.TICKET_DENY_ORDER_BUSINESS_MAX ?? "180"),
    businessWindowMs: Number(process.env.TICKET_DENY_ORDER_BUSINESS_WINDOW_MS ?? String(5 * 60 * 1000)),
    entityMax: Number(process.env.TICKET_DENY_ORDER_ENTITY_MAX ?? "2"),
    entityWindowMs: Number(process.env.TICKET_DENY_ORDER_ENTITY_WINDOW_MS ?? String(10 * 60 * 1000)),
    message: "This ticket is being actioned too frequently. Please wait a moment and try again.",
  },
} as const;
const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeKey(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getSlaDueAt(priority: z.infer<typeof ticketPrioritySchema>, base = new Date()): Date {
  const byPriority: Record<z.infer<typeof ticketPrioritySchema>, number> = {
    urgent: 60 * 60 * 1000,
    high: 4 * 60 * 60 * 1000,
    normal: 12 * 60 * 60 * 1000,
    low: 24 * 60 * 60 * 1000,
  };
  return new Date(base.getTime() + byPriority[priority]);
}

async function logTicketEvent(params: {
  businessId: string;
  ticketId: string;
  eventType: string;
  actorType: "user" | "bot" | "system";
  actorId?: string | null;
  actorLabel?: string | null;
  payload?: Record<string, unknown>;
}) {
  await db.insert(supportTicketEvents).values({
    businessId: params.businessId,
    ticketId: params.ticketId,
    eventType: params.eventType,
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel ?? null,
    payload: params.payload ?? {},
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function validateTicketOrderFlow(input: {
  ticketTypeKey: string | null | undefined;
  ticketFlowEnabled: boolean;
}) {
  if (normalizeKey(String(input.ticketTypeKey || "")) !== "ordercreation") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Only order creation tickets support approve and deny." });
  }
  if (!input.ticketFlowEnabled) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket-to-order flow is disabled for this business." });
  }
}

function assertTicketAwaitingOrderDecision(input: {
  status: string | null | undefined;
  outcome: string | null | undefined;
}) {
  const status = String(input.status ?? "").trim().toLowerCase();
  const outcome = String(input.outcome ?? "").trim().toLowerCase();
  if (status === "resolved" || (outcome && outcome !== "pending")) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only unresolved order tickets can be approved or denied.",
    });
  }
}

function bankQrMessagingConfigured(settings: ReturnType<typeof normalizeOrderFlowSettings>): boolean {
  if (settings.paymentMethod !== "bank_qr") return true;
  const bankQr = settings.bankQr;
  const hasQr = bankQr.showQr && Boolean(bankQr.qrImageUrl);
  const hasBankDetails =
    bankQr.showBankDetails && Boolean(bankQr.bankName || bankQr.accountName || bankQr.accountNumber || bankQr.accountInstructions);
  return hasQr || hasBankDetails;
}

function coalesceText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return null;
}

function preferredWhatsAppNumber(source: string | null | undefined, ...values: Array<string | null | undefined>): string | null {
  const sourceKey = String(source ?? "").trim().toLowerCase();
  for (const value of values) {
    const normalized = sanitizePhoneDigits(value);
    if (normalized) return normalized;
  }
  if (sourceKey === "whatsapp") {
    for (const value of values) {
      const fallback = String(value ?? "").trim();
      if (fallback) return fallback;
    }
  }
  return null;
}

function maskPhoneNumber(value: string | null | undefined): string | null {
  const digits = sanitizePhoneDigits(value);
  if (!digits) return null;
  if (digits.length <= 4) return digits;
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function whatsappWindowState(lastInboundAt: Date | string | null | undefined) {
  const parsed = lastInboundAt ? new Date(lastInboundAt) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return {
      lastInboundAt: null as Date | null,
      whatsappWindowExpiresAt: null as Date | null,
      whatsappWindowOpen: false,
    };
  }
  const expiresAt = new Date(parsed.getTime() + WHATSAPP_WINDOW_MS);
  return {
    lastInboundAt: parsed,
    whatsappWindowExpiresAt: expiresAt,
    whatsappWindowOpen: expiresAt.getTime() > Date.now(),
  };
}

type CustomerContext = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  externalId: string | null;
  source: string | null;
  whatsappIdentityId: string | null;
};

type ThreadContext = {
  threadId: string;
  whatsappIdentityId: string | null;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  customerExternalId: string | null;
  customerSource: string | null;
};

async function getCustomerContext(businessId: string, customerId: string | null | undefined): Promise<CustomerContext | null> {
  const normalizedCustomerId = String(customerId ?? "").trim();
  if (!normalizedCustomerId) return null;
  const [row] = await db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      externalId: customers.externalId,
      source: customers.source,
      whatsappIdentityId: customers.whatsappIdentityId,
    })
    .from(customers)
    .where(and(eq(customers.businessId, businessId), eq(customers.id, normalizedCustomerId)))
    .limit(1);
  return row ?? null;
}

function extractCustomerEmail(fields: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(fields)) {
    const normalized = normalizeKey(key);
    if (normalized !== "email" && normalized !== "customeremail") continue;
    const text = String(value ?? "").trim().toLowerCase();
    if (text && text.includes("@")) return text.slice(0, 320);
  }
  return null;
}

async function getThreadContext(businessId: string, threadId: string | null | undefined): Promise<ThreadContext | null> {
  const normalizedThreadId = String(threadId ?? "").trim();
  if (!normalizedThreadId) return null;
  const [row] = await db
    .select({
      threadId: messageThreads.id,
      whatsappIdentityId: messageThreads.whatsappIdentityId,
      customerId: customers.id,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerExternalId: customers.externalId,
      customerSource: customers.source,
    })
    .from(messageThreads)
    .innerJoin(customers, eq(messageThreads.customerId, customers.id))
    .where(and(eq(messageThreads.businessId, businessId), eq(messageThreads.id, normalizedThreadId)))
    .limit(1);
  return row ?? null;
}

async function resolveTicketContactContext(params: {
  businessId: string;
  customerId?: string | null;
  threadId?: string | null;
  whatsappIdentityId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerExternalId?: string | null;
  customerSource?: string | null;
}) {
  const directCustomer = await getCustomerContext(params.businessId, params.customerId);
  const threadContext = await getThreadContext(params.businessId, params.threadId);

  const customerId = coalesceText(
    params.customerId,
    directCustomer?.id ?? null,
    threadContext?.customerId ?? null,
  );
  const customerName = coalesceText(
    params.customerName,
    directCustomer?.name ?? null,
    threadContext?.customerName ?? null,
  );
  const customerEmail = coalesceText(directCustomer?.email ?? null);
  const customerExternalId = coalesceText(
    params.customerExternalId,
    directCustomer?.externalId ?? null,
    threadContext?.customerExternalId ?? null,
  );
  const customerSource = coalesceText(
    params.customerSource,
    directCustomer?.source ?? null,
    threadContext?.customerSource ?? null,
  );
  const customerPhone = coalesceText(
    params.customerPhone,
    directCustomer?.phone ?? null,
    threadContext?.customerPhone ?? null,
    customerSource?.toLowerCase() === "whatsapp" ? customerExternalId : null,
  );
  const whatsappIdentityId = coalesceText(
    params.whatsappIdentityId,
    directCustomer?.whatsappIdentityId ?? null,
    threadContext?.whatsappIdentityId ?? null,
  );

  const recipient =
    preferredWhatsAppNumber(params.customerSource, params.customerPhone) ??
    preferredWhatsAppNumber(directCustomer?.source, directCustomer?.phone, directCustomer?.externalId) ??
    preferredWhatsAppNumber(
      threadContext?.customerSource,
      threadContext?.customerPhone,
      threadContext?.customerExternalId,
    );

  const recipientSource =
    preferredWhatsAppNumber(params.customerSource, params.customerPhone) != null
      ? "ticket.customer_phone"
      : preferredWhatsAppNumber(directCustomer?.source, directCustomer?.phone) != null
        ? "customer.phone"
        : preferredWhatsAppNumber(directCustomer?.source, directCustomer?.externalId) != null
          ? "customer.external_id"
          : preferredWhatsAppNumber(threadContext?.customerSource, threadContext?.customerPhone) != null
            ? "thread.customer.phone"
            : preferredWhatsAppNumber(threadContext?.customerSource, threadContext?.customerExternalId) != null
              ? "thread.customer.external_id"
              : null;

  const whatsappIdentitySource = coalesceText(params.whatsappIdentityId)
    ? "ticket.whatsapp_identity_id"
    : coalesceText(directCustomer?.whatsappIdentityId ?? null)
      ? "customer.whatsapp_identity_id"
      : coalesceText(threadContext?.whatsappIdentityId ?? null)
        ? "thread.whatsapp_identity_id"
        : null;

  return {
    customerId,
    customerName,
    customerEmail,
    customerPhone,
    customerExternalId,
    customerSource,
    threadId: coalesceText(params.threadId, threadContext?.threadId ?? null),
    whatsappIdentityId,
    approvalRecipient: recipient ?? "",
    recipientSource,
    whatsappIdentitySource,
  };
}

async function lockWorkflowKey(tx: any, key: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}

async function flushBusinessOutbox(businessId: string) {
  await drainBusinessOutbox({ businessId, limit: 25 });
}

async function enforceOrderTicketOperationThrottle(
  tx: any,
  ctx: {
    businessId: string;
    userId?: string | null;
    firebaseUid?: string | null;
    userEmail?: string | null;
  },
  action: keyof typeof ORDER_TICKET_OPERATION_LIMITS,
  ticketId: string,
) {
  const limits = ORDER_TICKET_OPERATION_LIMITS[action];
  const actorKey = getStaffActorKey(ctx);
  await assertOperationThrottle(tx, {
    businessId: ctx.businessId,
    bucket: `ticket.${action}.actor`,
    scope: `${ctx.businessId}:${actorKey}`,
    max: limits.actorMax,
    windowMs: limits.actorWindowMs,
    message: limits.message,
  });
  await assertOperationThrottle(tx, {
    businessId: ctx.businessId,
    bucket: `ticket.${action}.business`,
    scope: ctx.businessId,
    max: limits.businessMax,
    windowMs: limits.businessWindowMs,
    message: limits.message,
  });
  await assertOperationThrottle(tx, {
    businessId: ctx.businessId,
    bucket: `ticket.${action}.entity`,
    scope: `${ctx.businessId}:${ticketId}`,
    max: limits.entityMax,
    windowMs: limits.entityWindowMs,
    message: limits.message,
  });
}

async function getHydratedTicketRow(businessId: string, ticketId: string) {
  const [row] = await db
    .select({
      ...getTableColumns(supportTickets),
      orderId: orders.id,
      orderStatus: orders.status,
      orderPaymentMethod: orders.paymentMethod,
      orderUpdatedAt: orders.updatedAt,
    })
    .from(supportTickets)
    .leftJoin(orders, and(eq(orders.businessId, supportTickets.businessId), eq(orders.supportTicketId, supportTickets.id)))
    .where(and(eq(supportTickets.businessId, businessId), eq(supportTickets.id, ticketId)))
    .limit(1);
  return row ?? null;
}

async function publishHydratedTicketUpsert(input: {
  businessId: string;
  ticketId: string;
  createdAt?: Date | string | null;
}) {
  const ticket = await getHydratedTicketRow(input.businessId, input.ticketId);
  if (!ticket) return null;
  await publishPortalEvent({
    businessId: input.businessId,
    entity: "ticket",
    op: "upsert",
    entityId: ticket.id,
    payload: { ticket: ticket as any },
    createdAt: input.createdAt ?? ticket.updatedAt ?? ticket.createdAt ?? new Date(),
  });
  return ticket;
}

function buildOrderDenialMessages(input: {
  customerName?: string | null;
  reason?: string | null;
}): BotSendMessage[] {
  const normalizedReason = String(input.reason ?? "").trim();
  const customerLine = input.customerName
    ? `Hi ${input.customerName}, we could not approve your order request yet.`
    : "We could not approve your order request yet.";
  const lines = [
    customerLine,
    normalizedReason && normalizedReason.toLowerCase() !== "denied" ? `Reason: ${normalizedReason}.` : null,
    "Please reply in this chat if you want to update the request or place a new order.",
  ].filter(Boolean);
  return [{ type: "text", text: lines.join("\n") }];
}

export const ticketsRouter = router({
  listTypes: businessProcedure
    .input(z.object({ includeDisabled: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      await ensureDefaultTicketTypes(ctx.businessId);
      const conditions = [eq(supportTicketTypes.businessId, ctx.businessId)];
      if (!input?.includeDisabled) {
        conditions.push(eq(supportTicketTypes.enabled, true));
      }
      return db
        .select()
        .from(supportTicketTypes)
        .where(and(...conditions))
        .orderBy(supportTicketTypes.sortOrder, supportTicketTypes.label);
    }),

  upsertType: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        enabled: z.boolean().optional(),
        requiredFields: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureDefaultTicketTypes(ctx.businessId);
      const requiredFields = (input.requiredFields ?? [])
        .map((x) => normalizeKey(x))
        .filter(Boolean);

      const [existing] = await db
        .select({ key: supportTicketTypes.key })
        .from(supportTicketTypes)
        .where(and(eq(supportTicketTypes.id, input.id), eq(supportTicketTypes.businessId, ctx.businessId)))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket type not found" });
      }
      if (!DEFAULT_TICKET_TYPE_KEYS.has(existing.key as any)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only default ticket types can be edited." });
      }

      const [updated] = await db
        .update(supportTicketTypes)
        .set({
          enabled: input.enabled ?? true,
          requiredFields,
          updatedAt: new Date(),
        })
        .where(and(eq(supportTicketTypes.id, input.id), eq(supportTicketTypes.businessId, ctx.businessId)))
        .returning();
      if (updated) {
        recordBusinessEvent({
          event: "ticket.type_updated",
          action: "upsertType",
          area: "ticket",
          businessId: ctx.businessId,
          entity: "ticket_type",
          entityId: updated.id,
          userId: ctx.userId,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
          actorType: "user",
          outcome: "success",
          status: updated.enabled ? "enabled" : "disabled",
          attributes: {
            key: updated.key,
            required_fields_count: Array.isArray(updated.requiredFields) ? updated.requiredFields.length : 0,
          },
        });
      }
      return updated ?? null;
    }),

  deleteType: businessProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async () => {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket types are fixed. Disable instead of deleting." });
    }),

  listTickets: businessProcedure
    .input(
      z.object({
        status: ticketStatusSchema.optional(),
        typeKey: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(supportTickets.businessId, ctx.businessId)];
      if (input?.status) conditions.push(eq(supportTickets.status, input.status));
      if (input?.typeKey) conditions.push(eq(supportTickets.ticketTypeKey, normalizeKey(input.typeKey)));
      return db
        .select({
          ...getTableColumns(supportTickets),
          orderId: orders.id,
          orderStatus: orders.status,
          orderPaymentMethod: orders.paymentMethod,
          orderUpdatedAt: orders.updatedAt,
        })
        .from(supportTickets)
        .leftJoin(orders, and(eq(orders.businessId, supportTickets.businessId), eq(orders.supportTicketId, supportTickets.id)))
        .where(and(...conditions))
        .orderBy(desc(supportTickets.updatedAt), desc(supportTickets.createdAt))
        .limit(input?.limit ?? 200);
    }),

  listTicketLedger: businessProcedure
    .input(
      z.object({
        typeKey: z.string().optional(),
        status: ticketStatusSchema.optional(),
        orderStage: orderStageSchema.optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions: any[] = [eq(supportTickets.businessId, ctx.businessId)];
      const normalizedStatusExpr = sql<string>`case when lower(coalesce(${supportTickets.status}, '')) = 'closed' then 'resolved' else lower(coalesce(${supportTickets.status}, '')) end`;
      const orderStageExpr = sql<string>`case
        when lower(coalesce(${orders.status}, '')) in ('pending_approval', 'approved', 'awaiting_payment', 'payment_submitted', 'payment_rejected', 'paid', 'refund_pending', 'refunded', 'denied')
          then lower(coalesce(${orders.status}, ''))
        when lower(coalesce(${supportTickets.outcome}, '')) = 'lost' then 'denied'
        when lower(coalesce(${supportTickets.outcome}, '')) = 'won' then 'approved'
        else 'pending_approval'
      end`;
      if (input.typeKey) {
        conditions.push(eq(supportTickets.ticketTypeKey, normalizeKey(input.typeKey)));
      }
      if (input.status) {
        conditions.push(sql<boolean>`${normalizedStatusExpr} = ${input.status}`);
      }
      if (input.orderStage) {
        conditions.push(sql<boolean>`${orderStageExpr} = ${input.orderStage}`);
      }

      const searchPattern = String(input.search ?? "").trim().replace(/^#/, "");
      if (searchPattern) {
        const pattern = `%${searchPattern}%`;
        conditions.push(
          or(
            ilike(supportTickets.id, pattern),
            ilike(supportTickets.title, pattern),
            ilike(supportTickets.summary, pattern),
            ilike(supportTickets.notes, pattern),
            ilike(supportTickets.customerName, pattern),
            ilike(supportTickets.customerPhone, pattern),
            ilike(orders.id, pattern),
          ),
        );
      }

      const [countRow] = await db
        .select({
          count: sql<number>`count(*)::int`,
        })
        .from(supportTickets)
        .leftJoin(orders, and(eq(orders.businessId, supportTickets.businessId), eq(orders.supportTicketId, supportTickets.id)))
        .where(and(...conditions));

      const rows = await db
        .select({
          ...getTableColumns(supportTickets),
          orderId: orders.id,
          orderStatus: orders.status,
          orderPaymentMethod: orders.paymentMethod,
          orderUpdatedAt: orders.updatedAt,
        })
        .from(supportTickets)
        .leftJoin(orders, and(eq(orders.businessId, supportTickets.businessId), eq(orders.supportTicketId, supportTickets.id)))
        .where(and(...conditions))
        .orderBy(desc(supportTickets.updatedAt), desc(supportTickets.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return {
        totalCount: countRow?.count ?? 0,
        items: rows,
      };
    }),

  getTicketById: businessProcedure
    .input(z.object({ ticketId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return getHydratedTicketRow(ctx.businessId, input.ticketId);
    }),

  createTicket: businessProcedure
    .input(
      z.object({
        ticketTypeKey: z.string().min(1),
        title: z.string().optional(),
        summary: z.string().optional(),
        status: ticketStatusSchema.optional(),
        priority: ticketPrioritySchema.optional(),
        source: z.string().optional(),
        customerId: z.string().optional(),
        threadId: z.string().optional(),
        whatsappIdentityId: z.string().optional(),
        customerName: z.string().optional(),
        customerPhone: z.string().optional(),
        fields: z.record(z.string(), z.unknown()).optional(),
        notes: z.string().optional(),
        createdBy: z.enum(["bot", "user", "system"]).optional(),
        slaDueAt: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureDefaultTicketTypes(ctx.businessId);
      const ticketTypeKey = normalizeKey(input.ticketTypeKey);
      const [typeRow] = await db
        .select()
        .from(supportTicketTypes)
        .where(
          and(
            eq(supportTicketTypes.businessId, ctx.businessId),
            eq(supportTicketTypes.key, ticketTypeKey),
          ),
        )
        .limit(1);
      if (!typeRow) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid ticket type" });
      }
      const contactContext = await resolveTicketContactContext({
        businessId: ctx.businessId,
        customerId: input.customerId ?? null,
        threadId: input.threadId ?? null,
        whatsappIdentityId: input.whatsappIdentityId ?? null,
        customerName: input.customerName ?? null,
        customerPhone: input.customerPhone ?? null,
      });
      const [created] = await db
        .insert(supportTickets)
        .values({
          businessId: ctx.businessId,
          ticketTypeId: typeRow.id,
          ticketTypeKey,
          title: input.title?.trim() || null,
          summary: input.summary?.trim() || null,
          status: input.status ?? "open",
          priority: input.priority ?? "normal",
          source: input.source?.trim() || "whatsapp",
          customerId: contactContext.customerId,
          threadId: contactContext.threadId,
          whatsappIdentityId: contactContext.whatsappIdentityId,
          customerName: contactContext.customerName,
          customerPhone: contactContext.customerPhone,
          fields: input.fields ?? {},
          notes: input.notes?.trim() || null,
          createdBy: input.createdBy ?? "user",
          outcome: "pending",
          lossReason: null,
          slaDueAt: input.slaDueAt ?? getSlaDueAt(input.priority ?? "normal"),
        })
        .returning();
      if (created) {
        await logTicketEvent({
          businessId: ctx.businessId,
          ticketId: created.id,
          eventType: "created",
          actorType: input.createdBy === "bot" ? "bot" : "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? input.createdBy ?? "system",
          payload: {
            status: created.status,
            priority: created.priority,
            outcome: created.outcome,
            slaDueAt: created.slaDueAt ? new Date(created.slaDueAt).toISOString() : null,
          },
        });
        await publishHydratedTicketUpsert({
          businessId: ctx.businessId,
          ticketId: created.id,
          createdAt: created.updatedAt ?? created.createdAt ?? new Date(),
        });
        recordBusinessEvent({
          event: "ticket.created",
          action: "createTicket",
          area: "ticket",
          businessId: ctx.businessId,
          entity: "ticket",
          entityId: created.id,
          userId: ctx.userId,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
          actorType: input.createdBy === "bot" ? "bot" : "user",
          outcome: "success",
          status: created.status,
          attributes: {
            outcome: created.outcome,
            priority: created.priority,
            source: created.source,
            ticket_type_key: created.ticketTypeKey,
            customer_phone_saved: Boolean(contactContext.customerPhone),
            customer_phone_source: contactContext.recipientSource,
          },
        });
      }
      return created;
    }),

  updateTicket: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        title: z.string().nullish(),
        summary: z.string().nullish(),
        notes: z.string().nullish(),
        priority: ticketPrioritySchema.optional(),
        customerName: z.string().nullish(),
        customerPhone: z.string().nullish(),
        fields: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select()
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      assertExpectedUpdatedAt({
        entityLabel: "ticket",
        expectedUpdatedAt: input.expectedUpdatedAt,
        actualUpdatedAt: existing.updatedAt,
      });

      const nextFields = input.fields ?? asRecord(existing.fields);
      const [updated] = await db
        .update(supportTickets)
        .set({
          title: input.title === undefined ? existing.title : input.title?.trim() || null,
          summary: input.summary === undefined ? existing.summary : input.summary?.trim() || null,
          notes: input.notes === undefined ? existing.notes : input.notes?.trim() || null,
          priority: input.priority ?? existing.priority,
          customerName:
            input.customerName === undefined ? existing.customerName : input.customerName?.trim() || null,
          customerPhone:
            input.customerPhone === undefined ? existing.customerPhone : input.customerPhone?.trim() || null,
          fields: nextFields,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(supportTickets.id, input.id),
            eq(supportTickets.businessId, ctx.businessId),
            eq(supportTickets.updatedAt, existing.updatedAt),
          ),
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This ticket was updated by another staff member. Refresh and try again.",
        });
      }

      await logTicketEvent({
        businessId: ctx.businessId,
        ticketId: updated.id,
        eventType: "edited",
        actorType: "user",
        actorId: ctx.userId ?? ctx.firebaseUid ?? null,
        actorLabel: ctx.userEmail ?? "user",
        payload: {
          fieldsUpdated: input.fields ? Object.keys(input.fields) : [],
          priority: updated.priority,
        },
      });
      await publishHydratedTicketUpsert({
        businessId: ctx.businessId,
        ticketId: updated.id,
        createdAt: updated.updatedAt ?? updated.createdAt ?? new Date(),
      });
      recordBusinessEvent({
        event: "ticket.updated",
        action: "updateTicket",
        area: "ticket",
        businessId: ctx.businessId,
        entity: "ticket",
        entityId: updated.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: "success",
        status: updated.status,
        attributes: {
          priority: updated.priority,
          ticket_type_key: updated.ticketTypeKey,
        },
      });

      return updated;
    }),

  updateTicketStatus: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        status: ticketStatusSchema,
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const nextStatus = input.status;
      const [existing] = await db
        .select({
          status: supportTickets.status,
          resolvedAt: supportTickets.resolvedAt,
          outcome: supportTickets.outcome,
          lossReason: supportTickets.lossReason,
          updatedAt: supportTickets.updatedAt,
        })
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      assertExpectedUpdatedAt({
        entityLabel: "ticket",
        expectedUpdatedAt: input.expectedUpdatedAt,
        actualUpdatedAt: existing.updatedAt,
      });
      const [updated] = await db
        .update(supportTickets)
        .set({
          status: nextStatus,
          notes: input.notes?.trim() || null,
          resolvedAt: nextStatus === "resolved" ? now : null,
          outcome: nextStatus === "resolved" ? sql`${supportTickets.outcome}` : "pending",
          lossReason: nextStatus === "resolved" ? sql`${supportTickets.lossReason}` : null,
          closedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(supportTickets.id, input.id),
            eq(supportTickets.businessId, ctx.businessId),
            eq(supportTickets.updatedAt, existing.updatedAt),
          ),
        )
        .returning();
      if (!updated) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This ticket was updated by another staff member. Refresh and try again.",
        });
      }
      if (existing.status !== updated.status) {
        await logTicketEvent({
          businessId: ctx.businessId,
          ticketId: updated.id,
          eventType: "status_changed",
          actorType: "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? "user",
          payload: {
            from: existing.status,
            to: updated.status,
            resolvedAt: updated.resolvedAt ? new Date(updated.resolvedAt).toISOString() : null,
          },
        });
      }
      await publishHydratedTicketUpsert({
        businessId: ctx.businessId,
        ticketId: updated.id,
        createdAt: updated.updatedAt ?? updated.createdAt ?? new Date(),
      });
      if (existing.status !== updated.status) {
        recordBusinessEvent({
          event: "ticket.status_updated",
          action: "updateTicketStatus",
          area: "ticket",
          businessId: ctx.businessId,
          entity: "ticket",
          entityId: updated.id,
          userId: ctx.userId,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
          actorType: "user",
          outcome: "success",
          status: updated.status,
          attributes: {
            from_status: existing.status,
            to_status: updated.status,
          },
        });
      }
      return updated;
    }),

  updateTicketOutcome: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        outcome: ticketOutcomeSchema,
        lossReason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select({
          status: supportTickets.status,
          outcome: supportTickets.outcome,
          lossReason: supportTickets.lossReason,
          updatedAt: supportTickets.updatedAt,
        })
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      if (existing.status !== "resolved" && input.outcome !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only resolved tickets can be marked won/lost." });
      }
      assertExpectedUpdatedAt({
        entityLabel: "ticket",
        expectedUpdatedAt: input.expectedUpdatedAt,
        actualUpdatedAt: existing.updatedAt,
      });

      const normalizedLossReason = input.lossReason?.trim() || null;
      if (input.outcome === "lost" && !normalizedLossReason) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Loss reason is required when outcome is lost." });
      }

      const [updated] = await db
        .update(supportTickets)
        .set({
          outcome: input.outcome,
          lossReason: input.outcome === "lost" ? normalizedLossReason : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(supportTickets.id, input.id),
            eq(supportTickets.businessId, ctx.businessId),
            eq(supportTickets.updatedAt, existing.updatedAt),
          ),
        )
        .returning();
      if (!updated) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This ticket was updated by another staff member. Refresh and try again.",
        });
      }

      if (existing.outcome !== updated.outcome || (existing.lossReason ?? "") !== (updated.lossReason ?? "")) {
        await logTicketEvent({
          businessId: ctx.businessId,
          ticketId: updated.id,
          eventType: "outcome_changed",
          actorType: "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? "user",
          payload: {
            from: existing.outcome,
            to: input.outcome,
            previousLossReason: existing.lossReason ?? null,
            lossReason: input.outcome === "lost" ? normalizedLossReason : null,
          },
        });
      }
      await publishHydratedTicketUpsert({
        businessId: ctx.businessId,
        ticketId: updated.id,
        createdAt: updated.updatedAt ?? updated.createdAt ?? new Date(),
      });
      if (existing.outcome !== updated.outcome || (existing.lossReason ?? "") !== (updated.lossReason ?? "")) {
        recordBusinessEvent({
          event: "ticket.outcome_updated",
          action: "updateTicketOutcome",
          area: "ticket",
          businessId: ctx.businessId,
          entity: "ticket",
          entityId: updated.id,
          userId: ctx.userId,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
          actorType: "user",
          outcome: "success",
          status: updated.outcome,
          attributes: {
            from_outcome: existing.outcome,
            loss_reason: updated.lossReason,
            to_outcome: updated.outcome,
          },
        });
      }
      return updated;
    }),

  updateTicketSlaDueAt: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        slaDueAt: z.coerce.date().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select({ slaDueAt: supportTickets.slaDueAt, updatedAt: supportTickets.updatedAt })
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      assertExpectedUpdatedAt({
        entityLabel: "ticket",
        expectedUpdatedAt: input.expectedUpdatedAt,
        actualUpdatedAt: existing.updatedAt,
      });

      const [updated] = await db
        .update(supportTickets)
        .set({
          slaDueAt: input.slaDueAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(supportTickets.id, input.id),
            eq(supportTickets.businessId, ctx.businessId),
            eq(supportTickets.updatedAt, existing.updatedAt),
          ),
        )
        .returning();
      if (!updated) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This ticket was updated by another staff member. Refresh and try again.",
        });
      }

      const fromIso = existing.slaDueAt ? new Date(existing.slaDueAt).toISOString() : null;
      const toIso = updated.slaDueAt ? new Date(updated.slaDueAt).toISOString() : null;
      if (fromIso !== toIso) {
        await logTicketEvent({
          businessId: ctx.businessId,
          ticketId: updated.id,
          eventType: "sla_changed",
          actorType: "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? "user",
          payload: {
            from: fromIso,
            to: toIso,
          },
        });
      }
      await publishHydratedTicketUpsert({
        businessId: ctx.businessId,
        ticketId: updated.id,
        createdAt: updated.updatedAt ?? updated.createdAt ?? new Date(),
      });
      if (fromIso !== toIso) {
        recordBusinessEvent({
          event: "ticket.sla_updated",
          action: "updateTicketSlaDueAt",
          area: "ticket",
          businessId: ctx.businessId,
          entity: "ticket",
          entityId: updated.id,
          userId: ctx.userId,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
          actorType: "user",
          outcome: "success",
          attributes: {
            from_sla_due_at: fromIso,
            to_sla_due_at: toIso,
          },
        });
      }
      return updated;
    }),

  approveOrderTicket: businessProcedure
    .input(z.object({ id: z.string().min(1), expectedUpdatedAt: z.coerce.date().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [biz] = await db
        .select({ settings: businesses.settings })
        .from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .limit(1);
      const orderSettings = normalizeOrderFlowSettings(biz?.settings);

      const [ticket] = await db
        .select({
          id: supportTickets.id,
          businessId: supportTickets.businessId,
          ticketTypeKey: supportTickets.ticketTypeKey,
          status: supportTickets.status,
          outcome: supportTickets.outcome,
          source: supportTickets.source,
          customerId: supportTickets.customerId,
          threadId: supportTickets.threadId,
          whatsappIdentityId: supportTickets.whatsappIdentityId,
          customerName: supportTickets.customerName,
          customerPhone: supportTickets.customerPhone,
          title: supportTickets.title,
          summary: supportTickets.summary,
          fields: supportTickets.fields,
          notes: supportTickets.notes,
          priority: supportTickets.priority,
          createdBy: supportTickets.createdBy,
          createdAt: supportTickets.createdAt,
          updatedAt: supportTickets.updatedAt,
        })
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);

      if (!ticket) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      validateTicketOrderFlow({
        ticketTypeKey: ticket.ticketTypeKey,
        ticketFlowEnabled: orderSettings.ticketToOrderEnabled,
      });
      assertTicketAwaitingOrderDecision({
        status: ticket.status,
        outcome: ticket.outcome,
      });
      if (orderSettings.paymentMethod === "bank_qr" && !bankQrMessagingConfigured(orderSettings)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Bank or QR payment details are not configured in General settings.",
        });
      }

      const fields = asRecord(ticket.fields);
      const requestedCustomerEmail = extractCustomerEmail(fields);
      const itemsSummary = formatOrderItemsSummary(fields);
      const expectedAmount = computeOrderExpectedAmount(fields);
      if (orderSettings.paymentMethod === "bank_qr" && !expectedAmount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Bank or QR order approval requires a verified payable amount.",
        });
      }
      const contactContext = await resolveTicketContactContext({
        businessId: ctx.businessId,
        customerId: ticket.customerId,
        threadId: ticket.threadId,
        whatsappIdentityId: ticket.whatsappIdentityId,
        customerName: ticket.customerName,
        customerPhone: ticket.customerPhone,
      });
      const lastInboundRows = contactContext.threadId
        ? await db
            .select({ createdAt: threadMessages.createdAt })
            .from(threadMessages)
            .where(and(eq(threadMessages.threadId, contactContext.threadId), eq(threadMessages.direction, "inbound")))
            .orderBy(desc(threadMessages.createdAt))
            .limit(1)
        : [];
      const lastInboundAt = lastInboundRows[0]?.createdAt ?? null;
      const windowState = whatsappWindowState(lastInboundAt);
      const approvalRecipient = sanitizePhoneDigits(contactContext.approvalRecipient);
      const hasImmediateWhatsAppDeliveryPath = Boolean(
        contactContext.whatsappIdentityId && approvalRecipient && windowState.whatsappWindowOpen,
      );
      const customerEmail = coalesceText(requestedCustomerEmail, contactContext.customerEmail);
      if (!customerEmail && !hasImmediateWhatsAppDeliveryPath) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Order approval requires the customer's email when the WhatsApp 24-hour window is closed or WhatsApp routing is unavailable.",
        });
      }
      if (orderSettings.paymentMethod === "bank_qr" && (!contactContext.whatsappIdentityId || !approvalRecipient)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ticket is missing WhatsApp routing details for payment delivery.",
        });
      }
      const now = new Date();
      const nextOrderStatus = orderSettings.paymentMethod === "bank_qr" ? "awaiting_payment" : "approved";
      const initialFulfillmentStatus = resolveInitialFulfillmentStatus(orderSettings.paymentMethod);
      const fulfillmentSeed = extractOrderFulfillmentSeed({
        fields,
        customerName: contactContext.customerName ?? ticket.customerName,
        customerPhone: contactContext.customerPhone ?? ticket.customerPhone,
      });
      const ticketSnapshot = {
        ticketId: ticket.id,
        title: ticket.title ?? null,
        summary: ticket.summary ?? null,
        fields,
        notes: ticket.notes ?? null,
        priority: ticket.priority ?? null,
      };
      const paymentConfigSnapshot = {
        paymentMethod: orderSettings.paymentMethod,
        currency: orderSettings.currency,
        bankQr: orderSettings.bankQr,
      };

      const result = await db.transaction(async (tx) => {
        await lockWorkflowKey(tx, `${ctx.businessId}::ticket::${ticket.id}`);
        await enforceOrderTicketOperationThrottle(tx, ctx, "approve", ticket.id);

        const [existingOrder] = await tx
          .select({
            id: orders.id,
            status: orders.status,
          })
          .from(orders)
          .where(and(eq(orders.businessId, ctx.businessId), eq(orders.supportTicketId, ticket.id)))
          .limit(1);
        if (existingOrder) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Ticket already has a linked order (${existingOrder.status || "existing"}) and cannot be approved again.`,
          });
        }

        const orderId = randomUUID();
        const paymentReference =
          orderSettings.paymentMethod === "bank_qr"
            ? `ORD-${orderId.slice(0, 8).toUpperCase()}`
            : null;

        const baseOrderValues = {
          businessId: ctx.businessId,
          supportTicketId: ticket.id,
          source: ticket.source || "whatsapp",
          customerId: contactContext.customerId,
          threadId: contactContext.threadId,
          whatsappIdentityId: contactContext.whatsappIdentityId,
          customerName: contactContext.customerName,
          customerPhone: contactContext.customerPhone,
          customerEmail,
          status: nextOrderStatus,
          fulfillmentStatus: initialFulfillmentStatus,
          fulfillmentUpdatedAt: now,
          recipientName: fulfillmentSeed.recipientName,
          recipientPhone: fulfillmentSeed.recipientPhone,
          shippingAddress: fulfillmentSeed.shippingAddress,
          deliveryArea: fulfillmentSeed.deliveryArea,
          deliveryNotes: fulfillmentSeed.deliveryNotes,
          paymentMethod: orderSettings.paymentMethod,
          currency: orderSettings.currency,
          expectedAmount,
          paymentReference,
          ticketSnapshot,
          paymentConfigSnapshot,
          notes: ticket.notes?.trim() || null,
          approvedAt: now,
          updatedAt: now,
        } as const;

        const [orderRow] = await tx
          .insert(orders)
          .values({
            id: orderId,
            ...baseOrderValues,
          })
          .returning();

        if (contactContext.customerId && customerEmail) {
          await tx
            .update(customers)
            .set({
              email: customerEmail,
              updatedAt: now,
            })
            .where(and(eq(customers.businessId, ctx.businessId), eq(customers.id, contactContext.customerId)));
        }

        const [ticketRow] = await tx
          .update(supportTickets)
          .set({
            customerId: contactContext.customerId,
            threadId: contactContext.threadId,
            whatsappIdentityId: contactContext.whatsappIdentityId,
            customerName: contactContext.customerName,
            customerPhone: contactContext.customerPhone,
            status: "resolved",
            outcome: "won",
            lossReason: null,
            resolvedAt: now,
            closedAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(supportTickets.id, ticket.id),
              eq(supportTickets.businessId, ctx.businessId),
              eq(supportTickets.updatedAt, ticket.updatedAt),
            ),
          )
          .returning();

        if (!ticketRow) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This ticket was updated by another staff member. Refresh and try again.",
          });
        }

        const approvalMessages = buildOrderApprovalMessages({
          orderId: orderRow?.id ?? orderId,
          customerName: contactContext.customerName ?? ticket.customerName,
          itemsSummary,
          expectedAmount,
          paymentReference: orderRow?.paymentReference ?? paymentReference,
          orderSettings,
        });
        const notification = await enqueueWhatsAppOutboxMessages(tx, {
          businessId: ctx.businessId,
          entityType: "order",
          entityId: orderRow?.id ?? orderId,
          customerId: contactContext.customerId,
          threadId: contactContext.threadId,
          whatsappIdentityId: contactContext.whatsappIdentityId,
          recipient: contactContext.approvalRecipient,
          recipientSource: contactContext.recipientSource,
          whatsappIdentitySource: contactContext.whatsappIdentitySource,
          source: "order_ticket_approval",
          idempotencyBaseKey: `order_ticket:${ticket.id}:approval:${orderRow?.id ?? orderId}`,
          messages: approvalMessages,
        });

        return {
          order: orderRow ?? null,
          ticket: ticketRow ?? null,
          notification,
        };
      });

      if (!result.order || !result.ticket) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to approve order ticket." });
      }

      await Promise.all([
        logTicketEvent({
          businessId: ctx.businessId,
          ticketId: result.ticket.id,
          eventType: "order_approved",
          actorType: "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? "user",
          payload: {
            orderId: result.order.id,
            orderStatus: result.order.status,
            paymentMethod: result.order.paymentMethod,
          },
        }),
        logOrderEvent({
          businessId: ctx.businessId,
          orderId: result.order.id,
          eventType: "approved",
          actorType: "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? "user",
          payload: {
            supportTicketId: result.ticket.id,
            paymentMethod: result.order.paymentMethod,
            expectedAmount: result.order.expectedAmount,
            recipient: maskPhoneNumber(approvalRecipient),
            recipientSource: contactContext.recipientSource,
            whatsappIdentitySource: contactContext.whatsappIdentitySource,
          },
        }),
      ]);

      let delivery: {
        ok: boolean;
        error: string | null;
        recipientSource: string | null;
        whatsappIdentitySource: string | null;
      } = {
        ok: true,
        error: null,
        recipientSource: result.notification.recipientSource,
        whatsappIdentitySource: result.notification.whatsappIdentitySource,
      };
      if (!result.notification.ok) {
        delivery = {
          ok: false,
          error: result.notification.error,
          recipientSource: result.notification.recipientSource,
          whatsappIdentitySource: result.notification.whatsappIdentitySource,
        };
      } else if (result.notification.idempotencyKeys.length) {
        const drained = await drainBusinessOutbox({
          businessId: ctx.businessId,
          idempotencyKeys: result.notification.idempotencyKeys,
          limit: result.notification.idempotencyKeys.length,
        });
        delivery = {
          ok: drained.ok,
          error: drained.error,
          recipientSource: result.notification.recipientSource,
          whatsappIdentitySource: result.notification.whatsappIdentitySource,
        };
      }
      await flushBusinessOutbox(ctx.businessId);
      if (!delivery.ok) {
        await logOrderEvent({
          businessId: ctx.businessId,
          orderId: result.order.id,
          eventType: orderSettings.paymentMethod === "bank_qr"
            ? "payment_instructions_delivery_failed"
            : "order_approval_notification_failed",
          actorType: "system",
          actorLabel: "bot",
          payload: {
            error: delivery.error,
          },
        });
      }

      const [realtimeTicket] = await Promise.all([
        publishHydratedTicketUpsert({
          businessId: ctx.businessId,
          ticketId: result.ticket.id,
          createdAt: result.ticket.updatedAt ?? now,
        }),
        publishPortalEvent({
          businessId: ctx.businessId,
          entity: "order",
          op: "upsert",
          entityId: result.order.id,
          payload: { order: result.order as any },
          createdAt: result.order.updatedAt ?? now,
        }),
      ]);

      recordBusinessEvent({
        event: "ticket.order_approved",
        action: "approveOrderTicket",
        area: "ticket",
        businessId: ctx.businessId,
        entity: "ticket",
        entityId: result.ticket.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: delivery.ok ? "success" : "degraded",
        status: result.order.status,
        attributes: {
          delivery_ok: delivery.ok,
          order_id: result.order.id,
          payment_method: result.order.paymentMethod,
          delivery_phone_source: delivery.recipientSource,
          delivery_identity_source: delivery.whatsappIdentitySource,
        },
      });

      return {
        ticket: realtimeTicket ?? result.ticket,
        order: result.order,
        delivery,
      };
    }),

  denyOrderTicket: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [biz] = await db
        .select({ settings: businesses.settings })
        .from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .limit(1);
      const orderSettings = normalizeOrderFlowSettings(biz?.settings);

      const [ticket] = await db
        .select({
          id: supportTickets.id,
          businessId: supportTickets.businessId,
          ticketTypeKey: supportTickets.ticketTypeKey,
          status: supportTickets.status,
          outcome: supportTickets.outcome,
          source: supportTickets.source,
          customerId: supportTickets.customerId,
          threadId: supportTickets.threadId,
          whatsappIdentityId: supportTickets.whatsappIdentityId,
          customerName: supportTickets.customerName,
          customerPhone: supportTickets.customerPhone,
          notes: supportTickets.notes,
          updatedAt: supportTickets.updatedAt,
        })
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);
      if (!ticket) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      validateTicketOrderFlow({
        ticketTypeKey: ticket.ticketTypeKey,
        ticketFlowEnabled: orderSettings.ticketToOrderEnabled,
      });
      assertTicketAwaitingOrderDecision({
        status: ticket.status,
        outcome: ticket.outcome,
      });

      const now = new Date();
      const normalizedReason = input.reason?.trim() || "Denied";
      const contactContext = await resolveTicketContactContext({
        businessId: ctx.businessId,
        customerId: ticket.customerId,
        threadId: ticket.threadId,
        whatsappIdentityId: ticket.whatsappIdentityId,
        customerName: ticket.customerName,
        customerPhone: ticket.customerPhone,
      });
      const result = await db.transaction(async (tx) => {
        await lockWorkflowKey(tx, `${ctx.businessId}::ticket::${input.id}`);
        await enforceOrderTicketOperationThrottle(tx, ctx, "deny", input.id);

        const [existingOrder] = await tx
          .select({
            id: orders.id,
            status: orders.status,
          })
          .from(orders)
          .where(and(eq(orders.businessId, ctx.businessId), eq(orders.supportTicketId, input.id)))
          .limit(1);
        if (existingOrder) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Ticket already has a linked order (${existingOrder.status || "existing"}) and cannot be denied.`,
          });
        }

        const [ticketRow] = await tx
          .update(supportTickets)
          .set({
            status: "resolved",
            outcome: "lost",
            lossReason: normalizedReason,
            resolvedAt: now,
            closedAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(supportTickets.id, input.id),
              eq(supportTickets.businessId, ctx.businessId),
              eq(supportTickets.updatedAt, ticket.updatedAt),
            ),
          )
          .returning();

        if (!ticketRow) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This ticket was updated by another staff member. Refresh and try again.",
          });
        }

        const notification = await enqueueWhatsAppOutboxMessages(tx, {
          businessId: ctx.businessId,
          entityType: "ticket",
          entityId: input.id,
          customerId: contactContext.customerId,
          threadId: contactContext.threadId,
          whatsappIdentityId: contactContext.whatsappIdentityId,
          recipient: contactContext.approvalRecipient,
          recipientSource: contactContext.recipientSource,
          whatsappIdentitySource: contactContext.whatsappIdentitySource,
          source: "order_ticket_denied",
          idempotencyBaseKey: `order_ticket:${input.id}:denial`,
          messages: buildOrderDenialMessages({
            customerName: contactContext.customerName ?? ticket.customerName,
            reason: normalizedReason,
          }),
        });

        return {
          ticket: ticketRow ?? null,
          order: null,
          notification,
        };
      });

      if (!result.ticket) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to deny order ticket." });
      }

      await logTicketEvent({
        businessId: ctx.businessId,
        ticketId: result.ticket.id,
        eventType: "order_denied",
        actorType: "user",
        actorId: ctx.userId ?? ctx.firebaseUid ?? null,
        actorLabel: ctx.userEmail ?? "user",
        payload: {
          reason: normalizedReason,
          orderId: null,
        },
      });

      let delivery: {
        ok: boolean;
        error: string | null;
        recipientSource: string | null;
        whatsappIdentitySource: string | null;
      } = {
        ok: true,
        error: null,
        recipientSource: result.notification.recipientSource,
        whatsappIdentitySource: result.notification.whatsappIdentitySource,
      };
      if (!result.notification.ok) {
        delivery = {
          ok: false,
          error: result.notification.error,
          recipientSource: result.notification.recipientSource,
          whatsappIdentitySource: result.notification.whatsappIdentitySource,
        };
      } else if (result.notification.idempotencyKeys.length) {
        const drained = await drainBusinessOutbox({
          businessId: ctx.businessId,
          idempotencyKeys: result.notification.idempotencyKeys,
          limit: result.notification.idempotencyKeys.length,
        });
        delivery = {
          ok: drained.ok,
          error: drained.error,
          recipientSource: result.notification.recipientSource,
          whatsappIdentitySource: result.notification.whatsappIdentitySource,
        };
      }
      await flushBusinessOutbox(ctx.businessId);
      if (!delivery.ok) {
        await logTicketEvent({
          businessId: ctx.businessId,
          ticketId: result.ticket.id,
          eventType: "order_denial_notification_failed",
          actorType: "system",
          actorLabel: "bot",
          payload: {
            error: delivery.error,
          },
        });
      }

      const realtimeTicket = await publishHydratedTicketUpsert({
        businessId: ctx.businessId,
        ticketId: result.ticket.id,
        createdAt: result.ticket.updatedAt ?? now,
      });

      recordBusinessEvent({
        event: "ticket.order_denied",
        action: "denyOrderTicket",
        area: "ticket",
        businessId: ctx.businessId,
        entity: "ticket",
        entityId: result.ticket.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: delivery.ok ? "success" : "degraded",
        status: "denied",
        attributes: {
          order_id: null,
          reason: normalizedReason,
          delivery_ok: delivery.ok,
          delivery_phone_source: delivery.recipientSource,
          delivery_identity_source: delivery.whatsappIdentitySource,
        },
      });

      return {
        ...result,
        ticket: realtimeTicket ?? result.ticket,
        delivery,
      };
    }),

  listTicketEvents: businessProcedure
    .input(
      z.object({
        ticketId: z.string().min(1),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return db
        .select()
        .from(supportTicketEvents)
        .where(and(eq(supportTicketEvents.businessId, ctx.businessId), eq(supportTicketEvents.ticketId, input.ticketId)))
        .orderBy(desc(supportTicketEvents.createdAt))
        .limit(input.limit ?? 100);
    }),

  getTypeCounters: businessProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        key: supportTickets.ticketTypeKey,
        openCount: sql<number>`count(*) filter (where lower(coalesce(${supportTickets.status}, '')) = 'open')::int`,
        inProgressCount: sql<number>`count(*) filter (where lower(coalesce(${supportTickets.status}, '')) in ('in_progress', 'pending'))::int`,
      })
      .from(supportTickets)
      .where(eq(supportTickets.businessId, ctx.businessId))
      .groupBy(supportTickets.ticketTypeKey);

    return rows.map((row) => ({
      key: row.key,
      openCount: Number(row.openCount ?? 0),
      inProgressCount: Number(row.inProgressCount ?? 0),
    }));
  }),

  getPerformance: businessProcedure
    .input(
      z
        .object({
          typeKey: z.string().optional(),
          windowDays: z.number().int().min(1).max(365).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const whereChunks = [sql`${supportTickets.businessId} = ${ctx.businessId}`];
      if (input?.typeKey) {
        whereChunks.push(sql`${supportTickets.ticketTypeKey} = ${normalizeKey(input.typeKey)}`);
      }
      if (input?.windowDays) {
        whereChunks.push(sql`${supportTickets.createdAt} >= now() - (${input.windowDays} * interval '1 day')`);
      }

      const whereSql = sql.join(whereChunks, sql` AND `);
      const result = await db.execute<{
        total: number;
        overdue_open: number;
        resolved_total: number;
        resolved_on_time: number;
        resolved_late: number;
        won_count: number;
        lost_count: number;
      }>(sql`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (
            WHERE ${supportTickets.status} IN ('open','in_progress')
            AND ${supportTickets.slaDueAt} IS NOT NULL
            AND ${supportTickets.slaDueAt} < now()
          )::int AS overdue_open,
          count(*) FILTER (WHERE ${supportTickets.status} = 'resolved')::int AS resolved_total,
          count(*) FILTER (
            WHERE ${supportTickets.status} = 'resolved'
            AND ${supportTickets.resolvedAt} IS NOT NULL
            AND ${supportTickets.slaDueAt} IS NOT NULL
            AND ${supportTickets.resolvedAt} <= ${supportTickets.slaDueAt}
          )::int AS resolved_on_time,
          count(*) FILTER (
            WHERE ${supportTickets.status} = 'resolved'
            AND ${supportTickets.resolvedAt} IS NOT NULL
            AND ${supportTickets.slaDueAt} IS NOT NULL
            AND ${supportTickets.resolvedAt} > ${supportTickets.slaDueAt}
          )::int AS resolved_late,
          count(*) FILTER (WHERE ${supportTickets.outcome} = 'won')::int AS won_count,
          count(*) FILTER (WHERE ${supportTickets.outcome} = 'lost')::int AS lost_count
        FROM ${supportTickets}
        WHERE ${whereSql}
      `);

      const row = result.rows?.[0] ?? {
        total: 0,
        overdue_open: 0,
        resolved_total: 0,
        resolved_on_time: 0,
        resolved_late: 0,
        won_count: 0,
        lost_count: 0,
      };
      const won = Number(row.won_count ?? 0);
      const lost = Number(row.lost_count ?? 0);
      const closedDeals = won + lost;
      const resolvedTotal = Number(row.resolved_total ?? 0);
      const resolvedOnTime = Number(row.resolved_on_time ?? 0);

      return {
        total: Number(row.total ?? 0),
        overdueOpen: Number(row.overdue_open ?? 0),
        resolvedTotal,
        resolvedOnTime,
        resolvedLate: Number(row.resolved_late ?? 0),
        wonCount: won,
        lostCount: lost,
        conversionRate: closedDeals > 0 ? Number(((won / closedDeals) * 100).toFixed(1)) : 0,
        slaOnTimeRate: resolvedTotal > 0 ? Number(((resolvedOnTime / resolvedTotal) * 100).toFixed(1)) : 0,
      };
    }),
});
