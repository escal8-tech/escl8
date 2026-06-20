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

    return { customer, ticket: ticket! };
  });

  await logTicketEvent({
    businessId: ctx.businessId,
    ticketId: result.ticket.id,
    eventType: "created",
    actorType: "user",
    actorId: ctx.userId ?? ctx.firebaseUid ?? null,
    actorLabel: ctx.userEmail ?? "user",
    payload: {
      source: "staff_manual",
      customerName: input.customerName,
    },
  });

  const realtimeTicket = await publishHydratedTicketUpsert({
    businessId: ctx.businessId,
    ticketId: result.ticket.id,
    createdAt: result.ticket.updatedAt ?? now,
  });

  recordBusinessEvent({
    event: "ticket.created",
    action: "createManualTicket",
    area: "ticket",
    businessId: ctx.businessId,
    entity: "ticket",
    entityId: result.ticket.id,
    userId: ctx.userId,
    actorId: ctx.firebaseUid ?? ctx.userId ?? null,
    actorType: "user",
    outcome: "success",
    status: "open",
    attributes: {
      source: "staff_manual",
      ticket_type: "ordercreation",
    },
  });

  return {
    customer: result.customer,
    ticket: realtimeTicket ?? result.ticket,
  };
}
