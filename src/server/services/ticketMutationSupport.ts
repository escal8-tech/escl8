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
import { normalizeOptionalText } from "@/server/services/ticketLifecycleSupport";

export * from "./ticketLifecycleSupport";

export function normalizeManualExternalId(input: {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
}) {
  const phone = sanitizePhoneDigits(input.phone);
  if (phone) return phone;
  const email = String(input.email ?? "").trim().toLowerCase();
  if (email) return email;
  const name = String(input.name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `manual-${name || randomUUID().slice(0, 8)}-${Date.now()}`;
}

export function parseManualQuantity(value: string | undefined): string {
  const parsed = Number(String(value ?? "1").replace(/[^\d]/g, "") || "1");
  return String(Math.max(1, Number.isFinite(parsed) ? parsed : 1));
}

export function buildManualOrderFields(input: {
  channel: string;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  notes?: string | null;
  deliveryArea?: string | null;
  shippingAddress?: string | null;
  lineItems: Array<{ item: string; quantity?: string; unitPrice?: string }>;
  total?: string | null;
}) {
  const lineItems = input.lineItems
    .map((line) => {
      const item = String(line.item ?? "").trim();
      if (!item) return null;
      const quantity = parseManualQuantity(line.quantity);
      const unitPrice = parseMoneyValue(line.unitPrice);
      const row: Record<string, unknown> = { item, quantity };
      if (unitPrice) {
        row.unit_price = unitPrice;
        row.line_total = (Number(unitPrice) * Number(quantity)).toFixed(2);
      }
      return row;
    })
    .filter((line): line is Record<string, unknown> => Boolean(line));
  const pricedLineItems = lineItems.filter((line) => typeof line.unit_price === "string");
  const total =
    parseMoneyValue(input.total) ??
    (pricedLineItems.length === lineItems.length && lineItems.length
      ? lineItems.reduce((sum, line) => sum + Number(line.line_total ?? 0), 0).toFixed(2)
      : null);

  return {
    manual_order: true,
    manual_channel: input.channel,
    staff_created: true,
    suppress_customer_notifications: true,
    name: input.customerName,
    customer_name: input.customerName,
    phone: normalizeOptionalText(input.customerPhone),
    customer_phone: normalizeOptionalText(input.customerPhone),
    email: normalizeOptionalText(input.customerEmail),
    customer_email: normalizeOptionalText(input.customerEmail),
    items: lineItems.map((line) => String(line.item)),
    product: String(lineItems[0]?.item ?? ""),
    quantity: lineItems.map((line) => String(line.quantity ?? "1")),
    line_items: lineItems,
    ...(pricedLineItems.length === lineItems.length && lineItems.length ? { priced_line_items: lineItems } : {}),
    ...(total ? { total } : {}),
    ...(normalizeOptionalText(input.shippingAddress) ? { shipping_address: normalizeOptionalText(input.shippingAddress) } : {}),
    ...(normalizeOptionalText(input.deliveryArea) ? { delivery_area: normalizeOptionalText(input.deliveryArea) } : {}),
    ...(normalizeOptionalText(input.notes) ? { internal_notes: normalizeOptionalText(input.notes) } : {}),
  };
}

export async function upsertType(
  ctx: any,
  input: {
    id: string;
    enabled?: boolean;
    requiredFields?: string[];
  }
) {
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

  const [row] = await db
    .update(supportTicketTypes)
    .set({
      ...(input.enabled !== undefined ? { isActive: input.enabled } : {}),
      ...(input.requiredFields !== undefined ? { requiredFields } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(supportTicketTypes.id, input.id), eq(supportTicketTypes.businessId, ctx.businessId)))
    .returning();

  return row;
}

export async function createManualTicket(
  ctx: any,
  input: {
    channel: string;
    customerName: string;
    customerPhone?: string | null;
    customerEmail?: string | null;
    notes?: string | null;
    deliveryArea?: string | null;
    shippingAddress?: string | null;
    lineItems: Array<{ item: string; quantity?: string; unitPrice?: string }>;
    total?: string | null;
  }
) {
  const settings = await getBusinessOrderSettingsRecord(ctx.businessId);
  validateTicketOrderFlow({
    ticketTypeKey: "ordercreation",
    ticketFlowEnabled: settings.ticketToOrderEnabled,
  });

  const now = new Date();
  const externalId = normalizeManualExternalId({
    phone: input.customerPhone,
    email: input.customerEmail,
    name: input.customerName,
  });

  const customerEmail = normalizeOptionalText(input.customerEmail);

  const result = await db.transaction(async (tx) => {
    let [customer] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.businessId, ctx.businessId), eq(customers.externalId, externalId)))
      .limit(1);

    if (!customer) {
      const [newCustomer] = await tx
        .insert(customers)
        .values({
          businessId: ctx.businessId,
          externalId,
          source: "staff_manual",
          name: input.customerName,
          phone: sanitizePhoneDigits(input.customerPhone),
          email: customerEmail,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      customer = newCustomer!;
    }

    const fields = buildManualOrderFields(input);
    const [ticket] = await tx
      .insert(supportTickets)
      .values({
        businessId: ctx.businessId,
        customerId: customer.id,
        ticketTypeKey: "ordercreation",
        status: "open",
        outcome: "pending",
        source: "staff_manual",
        customerName: input.customerName,
        customerPhone: sanitizePhoneDigits(input.customerPhone),
        notes: normalizeOptionalText(input.notes),
        fields,
        slaDueAt: getSlaDueAt(now, 24 * 60),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!ticketRow) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create manual order ticket." });
    }

    const [requestRow] = await tx
      .insert(requests)
      .values({
        businessId: ctx.businessId,
        customerId: customerRow.id,
        customerNumber: phoneDigits || null,
        source: "other",
        sourceMeta: {
          source: "manual_order",
          channel: input.channel,
          ticketId: ticketRow.id,
          suppressCustomerNotifications: true,
        },
        sentiment: "neutral",
        status: "ongoing",
        type: "high_intent_lead",
        price: expectedAmount ?? "0",
        paid: false,
        summary,
        botVersion: "staff_manual",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const [finalCustomerRow] = await tx
      .update(customers)
      .set({
        totalRequests: sql`${customers.totalRequests} + 1`,
        leadScore: sql`${customers.leadScore} + 20`,
        isHighIntent: true,
        updatedAt: now,
      })
      .where(and(eq(customers.businessId, ctx.businessId), eq(customers.id, customerRow.id)))
      .returning();

    await logTicketEvent({
      businessId: ctx.businessId,
      ticketId: ticketRow.id,
      eventType: "created",
      actorType: "user",
      actorId: ctx.userId ?? ctx.firebaseUid ?? null,
      actorLabel: ctx.userEmail ?? "user",
      payload: {
        source: "staff_manual",
        channel: input.channel,
        customerId: customerRow.id,
        requestId: requestRow?.id ?? null,
        suppressCustomerNotifications: true,
      },
    });

    return { customerRow: finalCustomerRow ?? customerRow, ticketRow, requestRow: requestRow ?? null };
  });

  await Promise.all([
    publishPortalEvent({
      businessId: ctx.businessId,
      entity: "customer",
      op: "upsert",
      entityId: result.customerRow.id,
      payload: { customer: JSON.parse(JSON.stringify(result.customerRow)) as any },
      createdAt: result.customerRow.updatedAt ?? now,
    }),
    publishHydratedTicketUpsert({
      businessId: ctx.businessId,
      ticketId: result.ticketRow.id,
      createdAt: result.ticketRow.updatedAt ?? now,
    }),
    result.requestRow
      ? publishPortalEvent({
          businessId: ctx.businessId,
          entity: "request",
          op: "upsert",
          entityId: result.requestRow.id,
          payload: { request: JSON.parse(JSON.stringify(result.requestRow)) as any },
          createdAt: result.requestRow.updatedAt ?? now,
        })
      : Promise.resolve(null),
  ]);

  recordBusinessEvent({
    event: "ticket.manual_order_created",
    action: "createManualOrderTicket",
    area: "ticket",
    businessId: ctx.businessId,
    entity: "ticket",
    entityId: result.ticketRow.id,
    userId: ctx.userId,
    actorId: ctx.firebaseUid ?? ctx.userId ?? null,
    actorType: "user",
    outcome: "success",
    attributes: {
      source: "staff_manual",
      channel: input.channel,
      customer_id: result.customerRow.id,
      request_id: result.requestRow?.id ?? null,
      expected_amount: expectedAmount,
    },
  });

  return {
    ticket: result.ticketRow,
    customer: result.customerRow,
    request: result.requestRow,
  };
}

export async function updateTicket(
  ctx: any,
  input: {
    id: string;
    expectedUpdatedAt?: Date;
    title?: string | null;
    summary?: string | null;
    notes?: string | null;
    priority?: "low" | "normal" | "high" | "urgent";
    customerName?: string | null;
    customerPhone?: string | null;
    fields?: Record<string, unknown>;
  }
) {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(supportTickets)
    .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
    .limit(1);
  if (!existing) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
  }
  const nextFields = sanitizeTicketFields(input.fields ?? asRecord(existing.fields));
  const nextCustomerEmail = extractCustomerEmail(nextFields);
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
      message: "Failed to update ticket.",
    });
  }

  let updatedDraftOrder: { id: string; updatedAt: Date | string | null } | null = null;
  if (normalizeKey(updated.ticketTypeKey) === "ordercreation") {
    const ticketSnapshot = {
      ticketId: updated.id,
      title: updated.title ?? null,
      summary: updated.summary ?? null,
      fields: nextFields,
      notes: updated.notes ?? null,
      priority: updated.priority ?? null,
    };
    const [draftOrder] = await db
      .select({
        id: orders.id,
      })
      .from(orders)
      .where(
        and(
          eq(orders.businessId, ctx.businessId),
          eq(orders.supportTicketId, updated.id),
          eq(orders.status, "pending_approval"),
        ),
      )
      .limit(1);

    if (draftOrder) {
      const [draftOrderRow] = await db
        .update(orders)
        .set({
          customerName: updated.customerName,
          customerPhone: updated.customerPhone,
          customerEmail: nextCustomerEmail,
          ticketSnapshot,
          notes: updated.notes?.trim() || null,
          updatedAt: now,
        })
        .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, draftOrder.id)))
        .returning({
          id: orders.id,
          updatedAt: orders.updatedAt,
        });
      if (draftOrderRow) updatedDraftOrder = draftOrderRow;
    }

    if (updated.customerId) {
      await db
        .update(customers)
        .set({
          name: updated.customerName,
          phone: updated.customerPhone,
          email: nextCustomerEmail,
          updatedAt: now,
        })
        .where(and(eq(customers.businessId, ctx.businessId), eq(customers.id, updated.customerId)));
    }
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
  if (updatedDraftOrder) {
    await logOrderEvent({
      businessId: ctx.businessId,
      orderId: updatedDraftOrder.id,
      eventType: "draft_updated",
      actorType: "user",
      actorId: ctx.userId ?? ctx.firebaseUid ?? null,
      actorLabel: ctx.userEmail ?? "user",
      payload: {
        supportTicketId: updated.id,
      },
    });
  }
  await Promise.all([
    publishHydratedTicketUpsert({
      businessId: ctx.businessId,
      ticketId: updated.id,
      createdAt: updated.updatedAt ?? updated.createdAt ?? now,
    }),
    updatedDraftOrder
      ? publishPortalEvent({
          businessId: ctx.businessId,
          entity: "order",
          op: "upsert",
          entityId: updatedDraftOrder.id,
          payload: { order: { id: updatedDraftOrder.id } as any },
          createdAt: updatedDraftOrder.updatedAt ?? now,
        })
      : Promise.resolve(false),
  ]);
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
}

export * from "./ticketLifecycleSupport";

export async function updateTicketSlaDueAt(
  ctx: any,
  input: {
    id: string;
    expectedUpdatedAt?: Date;
    slaDueAt: Date | null;
  }
) {
  const [existing] = await db
    .select({ slaDueAt: supportTickets.slaDueAt, updatedAt: supportTickets.updatedAt })
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
      message: "Failed to update ticket SLA.",
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
}

