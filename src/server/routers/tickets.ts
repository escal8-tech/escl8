/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import {
  businesses,
  customers,
  orders,
  supportTicketEvents,
  supportTicketTypes,
  supportTickets,
} from "../../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { normalizeOrderFlowSettings } from "@/lib/order-settings";
import { DEFAULT_TICKET_TYPE_KEYS, ensureDefaultTicketTypes } from "../services/ticketDefaults";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { sendWhatsAppMessagesViaBot } from "../services/botApi";
import {
  buildOrderApprovalMessages,
  computeOrderExpectedAmount,
  formatOrderItemsSummary,
  logOrderEvent,
  persistOutboundThreadMessage,
  sanitizePhoneDigits,
} from "../services/orderFlow";

const ticketStatusSchema = z.enum(["open", "in_progress", "resolved"]);
const ticketPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
const ticketOutcomeSchema = z.enum(["pending", "won", "lost"]);

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

function bankQrMessagingConfigured(settings: ReturnType<typeof normalizeOrderFlowSettings>): boolean {
  if (settings.paymentMethod !== "bank_qr") return true;
  const bankQr = settings.bankQr;
  const hasQr = bankQr.showQr && Boolean(bankQr.qrImageUrl);
  const hasBankDetails =
    bankQr.showBankDetails && Boolean(bankQr.bankName || bankQr.accountName || bankQr.accountNumber || bankQr.accountInstructions);
  return hasQr || hasBankDetails;
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
        .select()
        .from(supportTickets)
        .where(and(...conditions))
        .orderBy(desc(supportTickets.createdAt))
        .limit(input?.limit ?? 200);
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
          customerId: input.customerId ?? null,
          threadId: input.threadId ?? null,
          whatsappIdentityId: input.whatsappIdentityId ?? null,
          customerName: input.customerName?.trim() || null,
          customerPhone: input.customerPhone?.trim() || null,
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
        await publishPortalEvent({
          businessId: ctx.businessId,
          entity: "ticket",
          op: "upsert",
          entityId: created.id,
          payload: { ticket: created as any },
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
          },
        });
      }
      return created;
    }),

  updateTicket: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
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
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .returning();

      if (updated) {
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
        await publishPortalEvent({
          businessId: ctx.businessId,
          entity: "ticket",
          op: "upsert",
          entityId: updated.id,
          payload: { ticket: updated as any },
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
      }

      return updated ?? null;
    }),

  updateTicketStatus: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
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
        })
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
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
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .returning();
      if (updated) {
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
        await publishPortalEvent({
          businessId: ctx.businessId,
          entity: "ticket",
          op: "upsert",
          entityId: updated.id,
          payload: { ticket: updated as any },
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
      }
      return updated ?? null;
    }),

  updateTicketOutcome: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
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
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .returning();

      if (updated) {
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
        await publishPortalEvent({
          businessId: ctx.businessId,
          entity: "ticket",
          op: "upsert",
          entityId: updated.id,
          payload: { ticket: updated as any },
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
      }
      return updated ?? null;
    }),

  updateTicketSlaDueAt: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
        slaDueAt: z.coerce.date().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select({ slaDueAt: supportTickets.slaDueAt })
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }

      const [updated] = await db
        .update(supportTickets)
        .set({
          slaDueAt: input.slaDueAt,
          updatedAt: new Date(),
        })
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .returning();

      if (updated) {
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
        await publishPortalEvent({
          businessId: ctx.businessId,
          entity: "ticket",
          op: "upsert",
          entityId: updated.id,
          payload: { ticket: updated as any },
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
      }
      return updated ?? null;
    }),

  approveOrderTicket: businessProcedure
    .input(z.object({ id: z.string().min(1) }))
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
          customerExternalId: customers.externalId,
        })
        .from(supportTickets)
        .leftJoin(customers, eq(supportTickets.customerId, customers.id))
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
        .limit(1);

      if (!ticket) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      validateTicketOrderFlow({
        ticketTypeKey: ticket.ticketTypeKey,
        ticketFlowEnabled: orderSettings.ticketToOrderEnabled,
      });
      if (orderSettings.paymentMethod === "bank_qr" && !bankQrMessagingConfigured(orderSettings)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Bank or QR payment details are not configured in General settings.",
        });
      }

      const fields = asRecord(ticket.fields);
      const itemsSummary = formatOrderItemsSummary(fields);
      const expectedAmount = computeOrderExpectedAmount(fields);
      const approvalRecipient =
        orderSettings.paymentMethod === "bank_qr"
          ? sanitizePhoneDigits(ticket.customerExternalId || ticket.customerPhone)
          : "";
      if (orderSettings.paymentMethod === "bank_qr" && (!ticket.whatsappIdentityId || !approvalRecipient)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ticket is missing WhatsApp routing details for payment delivery.",
        });
      }
      const now = new Date();
      const nextOrderStatus = orderSettings.paymentMethod === "bank_qr" ? "awaiting_payment" : "approved";
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
        const [existingOrder] = await tx
          .select({
            id: orders.id,
            status: orders.status,
            paymentReference: orders.paymentReference,
            paidAmount: orders.paidAmount,
            paymentApprovedAt: orders.paymentApprovedAt,
            paymentRejectedAt: orders.paymentRejectedAt,
          })
          .from(orders)
          .where(and(eq(orders.businessId, ctx.businessId), eq(orders.supportTicketId, ticket.id)))
          .limit(1);

        const orderId = existingOrder?.id ?? randomUUID();
        const paymentReference =
          orderSettings.paymentMethod === "bank_qr"
            ? existingOrder?.paymentReference ?? `ORD-${orderId.slice(0, 8).toUpperCase()}`
            : null;

        const baseOrderValues = {
          businessId: ctx.businessId,
          supportTicketId: ticket.id,
          source: ticket.source || "whatsapp",
          customerId: ticket.customerId ?? null,
          threadId: ticket.threadId ?? null,
          whatsappIdentityId: ticket.whatsappIdentityId ?? null,
          customerName: ticket.customerName?.trim() || null,
          customerPhone: ticket.customerPhone?.trim() || null,
          status: existingOrder?.status === "paid" ? "paid" : nextOrderStatus,
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

        const [orderRow] = existingOrder
          ? await tx
              .update(orders)
              .set({
                ...baseOrderValues,
                paidAmount: existingOrder.paidAmount,
                paymentApprovedAt: existingOrder.paymentApprovedAt,
                paymentRejectedAt: existingOrder.paymentRejectedAt,
              })
              .where(eq(orders.id, existingOrder.id))
              .returning()
          : await tx
              .insert(orders)
              .values({
                id: orderId,
                ...baseOrderValues,
              })
              .returning();

        const [ticketRow] = await tx
          .update(supportTickets)
          .set({
            status: "resolved",
            outcome: "won",
            lossReason: null,
            resolvedAt: now,
            closedAt: null,
            updatedAt: now,
          })
          .where(and(eq(supportTickets.id, ticket.id), eq(supportTickets.businessId, ctx.businessId)))
          .returning();

        return {
          order: orderRow ?? null,
          ticket: ticketRow ?? null,
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
          },
        }),
      ]);

      let delivery: { ok: boolean; error?: string | null } = { ok: true };
      if (orderSettings.paymentMethod === "bank_qr") {
        const approvalMessages = buildOrderApprovalMessages({
          orderId: result.order.id,
          customerName: ticket.customerName,
          itemsSummary,
          expectedAmount,
          paymentReference: result.order.paymentReference,
          orderSettings,
        });

        try {
          const sendResults = await sendWhatsAppMessagesViaBot({
            businessId: ctx.businessId,
            phoneNumberId: ticket.whatsappIdentityId!,
            to: approvalRecipient,
            messages: approvalMessages,
          });

          if (ticket.threadId) {
            for (const [index, outbound] of approvalMessages.entries()) {
              await persistOutboundThreadMessage({
                threadId: ticket.threadId,
                messageType: outbound.type,
                textBody: outbound.type === "text" ? outbound.text : outbound.caption ?? "[payment QR image]",
                externalMessageId: sendResults[index]?.messageId ?? null,
                meta: {
                  source: "order_ticket_approval",
                  orderId: result.order.id,
                  providerResponse: sendResults[index]?.providerResponse ?? null,
                  whatsappIdentityId: ticket.whatsappIdentityId,
                },
              });
            }
          }
        } catch (error) {
          delivery = {
            ok: false,
            error: error instanceof Error ? error.message : "Failed to deliver payment instructions.",
          };
          await logOrderEvent({
            businessId: ctx.businessId,
            orderId: result.order.id,
            eventType: "payment_instructions_delivery_failed",
            actorType: "system",
            actorLabel: "bot",
            payload: {
              error: delivery.error,
            },
          });
        }
      }

      await Promise.all([
        publishPortalEvent({
          businessId: ctx.businessId,
          entity: "ticket",
          op: "upsert",
          entityId: result.ticket.id,
          payload: { ticket: result.ticket as any },
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
        },
      });

      return {
        ticket: result.ticket,
        order: result.order,
        delivery,
      };
    }),

  denyOrderTicket: businessProcedure
    .input(
      z.object({
        id: z.string().min(1),
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
          ticketTypeKey: supportTickets.ticketTypeKey,
          notes: supportTickets.notes,
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

      const now = new Date();
      const normalizedReason = input.reason?.trim() || "Denied";
      const result = await db.transaction(async (tx) => {
        const [existingOrder] = await tx
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.businessId, ctx.businessId), eq(orders.supportTicketId, input.id)))
          .limit(1);

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
          .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
          .returning();

        const [orderRow] = existingOrder
          ? await tx
              .update(orders)
              .set({
                status: "denied",
                notes: ticket.notes?.trim() || normalizedReason,
                updatedAt: now,
              })
              .where(eq(orders.id, existingOrder.id))
              .returning()
          : [];

        return {
          ticket: ticketRow ?? null,
          order: orderRow ?? null,
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
          orderId: result.order?.id ?? null,
        },
      });
      if (result.order) {
        await logOrderEvent({
          businessId: ctx.businessId,
          orderId: result.order.id,
          eventType: "denied",
          actorType: "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? "user",
          payload: {
            reason: normalizedReason,
            supportTicketId: result.ticket.id,
          },
        });
      }

      await publishPortalEvent({
        businessId: ctx.businessId,
        entity: "ticket",
        op: "upsert",
        entityId: result.ticket.id,
        payload: { ticket: result.ticket as any },
        createdAt: result.ticket.updatedAt ?? now,
      });
      if (result.order) {
        await publishPortalEvent({
          businessId: ctx.businessId,
          entity: "order",
          op: "upsert",
          entityId: result.order.id,
          payload: { order: result.order as any },
          createdAt: result.order.updatedAt ?? now,
        });
      }

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
        outcome: "success",
        status: "denied",
        attributes: {
          order_id: result.order?.id ?? null,
          reason: normalizedReason,
        },
      });

      return result;
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
