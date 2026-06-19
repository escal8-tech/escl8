/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  businesses,
  customers,
  orders,
  orderPayments,
  requests,
  supportTicketTypes,
  supportTickets,
} from "../../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { resolveInitialFulfillmentStatus } from "@/lib/order-operations";
import { DEFAULT_TICKET_TYPE_KEYS, ensureDefaultTicketTypes } from "../services/ticketDefaults";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { drainBusinessOutbox, enqueueEmailOutboxMessages, enqueueWhatsAppOutboxMessages } from "@/server/services/messageOutbox";
import {
  buildOrderApprovalEmail,
  buildOrderApprovalMessages,
  buildOrderDeliveryDetailsRequestMessages,
  computeOrderExpectedAmount,
  extractOrderFulfillmentSeed,
  formatOrderItemsSummary,
  logOrderEvent,
  missingRequiredOrderDeliveryFields,
  parseMoneyValue,
  sanitizePhoneDigits,
} from "../services/orderFlow";
import {
  asRecord,
  assertTicketAwaitingOrderDecision,
  buildOrderDenialMessages,
  coalesceText,
  enforceOrderTicketOperationThrottle,
  extractCustomerEmail,
  flushBusinessOutbox,
  getSlaDueAt,
  getThreadWhatsappWindowState,
  lockWorkflowKey,
  logTicketEvent,
  maskPhoneNumber,
  normalizeKey,
  publishHydratedTicketUpsert,
  resolveTicketContactContext,
  sanitizeTicketFields,
  validateTicketOrderFlow,
} from "@/server/services/ticketWorkflowSupport";
import { getBusinessOrderSettingsRecord } from "@/server/services/businessSettingsStore";
import { normalizeOptionalText } from "./ticketMutationSupport";

export async function updateTicketStatus(
  ctx: any,
  input: {
    id: string;
    expectedUpdatedAt?: Date;
    status: "open" | "in_progress" | "resolved";
    notes?: string;
  }
) {
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
      ),
    )
    .returning();
  if (!updated) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update ticket status.",
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
}

export async function updateTicketOutcome(
  ctx: any,
  input: {
    id: string;
    expectedUpdatedAt?: Date;
    outcome: "pending" | "won" | "lost";
    lossReason?: string;
  }
) {
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
      ),
    )
    .returning();
  if (!updated) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update ticket outcome.",
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
}

export async function resolveSupportTicket(
  ctx: any,
  input: {
    id: string;
    expectedUpdatedAt?: Date;
    resolution: "completed" | "failed";
    failureReason?: string;
  }
) {
  const now = new Date();
  const [existing] = await db
    .select({
      ticketTypeKey: supportTickets.ticketTypeKey,
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
  if (normalizeKey(existing.ticketTypeKey) === "ordercreation") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Order tickets use the order approval workflow." });
  }

  const nextOutcome = input.resolution === "completed" ? "won" : "lost";
  const nextLossReason =
    input.resolution === "failed"
      ? normalizeOptionalText(input.failureReason) || normalizeOptionalText(existing.lossReason) || "Not completable"
      : null;

  const [updated] = await db
    .update(supportTickets)
    .set({
      status: "resolved",
      resolvedAt: now,
      closedAt: now,
      outcome: nextOutcome,
      lossReason: nextLossReason,
      updatedAt: now,
    })
    .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
    .returning();

  if (!updated) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update ticket resolution.",
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
        to: updated.outcome,
        previousLossReason: existing.lossReason ?? null,
        lossReason: updated.lossReason ?? null,
        resolution: input.resolution,
      },
    });
  }

  await publishHydratedTicketUpsert({
    businessId: ctx.businessId,
    ticketId: updated.id,
    createdAt: updated.updatedAt ?? updated.createdAt ?? new Date(),
  });

  recordBusinessEvent({
    event: "ticket.resolution_updated",
    action: "resolveSupportTicket",
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
      resolution: input.resolution,
      loss_reason: updated.lossReason,
      previous_outcome: existing.outcome,
      previous_status: existing.status,
    },
  });

  return updated;
}
