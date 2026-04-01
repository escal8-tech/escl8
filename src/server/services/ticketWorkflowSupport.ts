/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from "@trpc/server";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";
import { drainBusinessOutbox } from "@/server/services/messageOutbox";
import { assertOperationThrottle, getStaffActorKey } from "@/server/operationalHardening";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import { db } from "@/server/db/client";
import {
  customers,
  messageThreads,
  orders,
  supportTicketEvents,
  supportTickets,
  threadMessages,
} from "../../../drizzle/schema";
import { type BotSendMessage } from "@/server/services/botApi";
import { sanitizePhoneDigits } from "@/server/services/orderFlow";

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;
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

export function normalizeKey(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function getSlaDueAt(priority: "low" | "normal" | "high" | "urgent", base = new Date()): Date {
  const byPriority: Record<"low" | "normal" | "high" | "urgent", number> = {
    urgent: 60 * 60 * 1000,
    high: 4 * 60 * 60 * 1000,
    normal: 12 * 60 * 60 * 1000,
    low: 24 * 60 * 60 * 1000,
  };
  return new Date(base.getTime() + byPriority[priority]);
}

export async function logTicketEvent(params: {
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

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function sanitizeJsonLikeValue(
  value: unknown,
  depth = 0,
): z.infer<ReturnType<typeof z.unknown>> {
  if (depth > 6) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Ticket fields are too deeply nested.",
    });
  }
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 200) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Ticket fields contain too many array items.",
      });
    }
    return value.map((entry) => sanitizeJsonLikeValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.entries(record);
    if (entries.length > 200) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Ticket fields contain too many properties.",
      });
    }
    const next: Record<string, unknown> = {};
    for (const [rawKey, rawValue] of entries) {
      const key = String(rawKey || "").trim().slice(0, 120);
      if (!key) continue;
      next[key] = sanitizeJsonLikeValue(rawValue, depth + 1);
    }
    return next;
  }
  return String(value);
}

export function sanitizeTicketFields(fields: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeJsonLikeValue(fields, 0);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) return {};
  const serialized = JSON.stringify(sanitized);
  if (serialized.length > 24_000) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Ticket fields are too large to save safely.",
    });
  }
  return sanitized as Record<string, unknown>;
}

export function validateTicketOrderFlow(input: {
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

export function assertTicketAwaitingOrderDecision(input: {
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

export function coalesceText(...values: Array<string | null | undefined>): string | null {
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

export function maskPhoneNumber(value: string | null | undefined): string | null {
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

function parseThreadTimestamp(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export async function getThreadWhatsappWindowState(tx: any, threadId: string | null | undefined) {
  const normalizedThreadId = String(threadId ?? "").trim();
  if (!normalizedThreadId) return whatsappWindowState(null);

  const [agg] = await tx
    .select({
      lastInboundAt: sql<Date | null>`
        max(${threadMessages.createdAt})
        filter (
          where lower(coalesce(${threadMessages.direction}, '')) in ('inbound', 'incoming', 'customer', 'user')
        )
      `,
      lastMessageAt: sql<Date | null>`max(${threadMessages.createdAt})`,
    })
    .from(threadMessages)
    .where(eq(threadMessages.threadId, normalizedThreadId));

  const lastInboundAt = parseThreadTimestamp(agg?.lastInboundAt);
  const lastMessageAt = parseThreadTimestamp(agg?.lastMessageAt);
  return whatsappWindowState(lastInboundAt ?? lastMessageAt);
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

export function extractCustomerEmail(fields: Record<string, unknown>): string | null {
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

export async function resolveTicketContactContext(params: {
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

export async function lockWorkflowKey(tx: any, key: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}

export async function flushBusinessOutbox(businessId: string) {
  await drainBusinessOutbox({ businessId, limit: 25 });
}

export async function enforceOrderTicketOperationThrottle(
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

export async function getHydratedTicketRow(businessId: string, ticketId: string) {
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

export async function publishHydratedTicketUpsert(input: {
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

export function buildOrderDenialMessages(input: {
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
