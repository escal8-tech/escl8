/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizeOrderFlowSettings } from "@/lib/order-settings";
import {
  ORDER_FULFILLMENT_STATUSES,
  normalizeOrderFulfillmentStatus,
  type OrderFulfillmentStatus,
} from "@/lib/order-operations";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { assertExpectedUpdatedAt, assertOperationThrottle, getStaffActorKey } from "@/server/operationalHardening";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import { drainBusinessOutbox, enqueueEmailOutboxMessages, enqueueWhatsAppOutboxMessages } from "@/server/services/messageOutbox";
import { db } from "../db/client";
import { businessProcedure, router } from "../trpc";
import { businesses, customers, messageThreads, orderEvents, orderPayments, orders, threadMessages, whatsappIdentities } from "../../../drizzle/schema";
import { type BotSendMessage } from "../services/botApi";
import {
  buildOrderApprovalMessages,
  buildFulfillmentStatusMessages,
  buildManualCollectionMessages,
  formatOrderItemsSummary,
  logOrderEvent,
  sanitizePhoneDigits,
} from "../services/orderFlow";
import type { OrderEmailMessage } from "../services/orderFlow";

const reviewActionSchema = z.enum(["approve", "reject"]);
const refundActionSchema = z.enum(["mark_pending", "mark_refunded", "cancel"]);
const fulfillmentStatusSchema = z.enum(ORDER_FULFILLMENT_STATUSES);
const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;
const ORDER_OPERATION_LIMITS = {
  sendPaymentDetails: {
    actorMax: Number(process.env.ORDER_SEND_PAYMENT_DETAILS_ACTOR_MAX ?? "8"),
    actorWindowMs: Number(process.env.ORDER_SEND_PAYMENT_DETAILS_ACTOR_WINDOW_MS ?? String(5 * 60 * 1000)),
    businessMax: Number(process.env.ORDER_SEND_PAYMENT_DETAILS_BUSINESS_MAX ?? "80"),
    businessWindowMs: Number(process.env.ORDER_SEND_PAYMENT_DETAILS_BUSINESS_WINDOW_MS ?? String(5 * 60 * 1000)),
    entityMax: Number(process.env.ORDER_SEND_PAYMENT_DETAILS_ENTITY_MAX ?? "2"),
    entityWindowMs: Number(process.env.ORDER_SEND_PAYMENT_DETAILS_ENTITY_WINDOW_MS ?? String(10 * 60 * 1000)),
    message: "Payment instructions were sent too recently. Please wait a moment before sending them again.",
  },
  reviewPayment: {
    actorMax: Number(process.env.ORDER_REVIEW_PAYMENT_ACTOR_MAX ?? "40"),
    actorWindowMs: Number(process.env.ORDER_REVIEW_PAYMENT_ACTOR_WINDOW_MS ?? String(5 * 60 * 1000)),
    businessMax: Number(process.env.ORDER_REVIEW_PAYMENT_BUSINESS_MAX ?? "250"),
    businessWindowMs: Number(process.env.ORDER_REVIEW_PAYMENT_BUSINESS_WINDOW_MS ?? String(5 * 60 * 1000)),
    entityMax: Number(process.env.ORDER_REVIEW_PAYMENT_ENTITY_MAX ?? "3"),
    entityWindowMs: Number(process.env.ORDER_REVIEW_PAYMENT_ENTITY_WINDOW_MS ?? String(10 * 60 * 1000)),
    message: "Too many payment reviews were attempted for this order. Please wait and try again.",
  },
  updateFulfillment: {
    actorMax: Number(process.env.ORDER_UPDATE_FULFILLMENT_ACTOR_MAX ?? "120"),
    actorWindowMs: Number(process.env.ORDER_UPDATE_FULFILLMENT_ACTOR_WINDOW_MS ?? String(5 * 60 * 1000)),
    businessMax: Number(process.env.ORDER_UPDATE_FULFILLMENT_BUSINESS_MAX ?? "800"),
    businessWindowMs: Number(process.env.ORDER_UPDATE_FULFILLMENT_BUSINESS_WINDOW_MS ?? String(5 * 60 * 1000)),
    entityMax: Number(process.env.ORDER_UPDATE_FULFILLMENT_ENTITY_MAX ?? "20"),
    entityWindowMs: Number(process.env.ORDER_UPDATE_FULFILLMENT_ENTITY_WINDOW_MS ?? String(2 * 60 * 1000)),
    message: "This order is being updated too frequently. Please wait a moment and try again.",
  },
  captureManualPayment: {
    actorMax: Number(process.env.ORDER_CAPTURE_MANUAL_PAYMENT_ACTOR_MAX ?? "40"),
    actorWindowMs: Number(process.env.ORDER_CAPTURE_MANUAL_PAYMENT_ACTOR_WINDOW_MS ?? String(5 * 60 * 1000)),
    businessMax: Number(process.env.ORDER_CAPTURE_MANUAL_PAYMENT_BUSINESS_MAX ?? "250"),
    businessWindowMs: Number(process.env.ORDER_CAPTURE_MANUAL_PAYMENT_BUSINESS_WINDOW_MS ?? String(5 * 60 * 1000)),
    entityMax: Number(process.env.ORDER_CAPTURE_MANUAL_PAYMENT_ENTITY_MAX ?? "3"),
    entityWindowMs: Number(process.env.ORDER_CAPTURE_MANUAL_PAYMENT_ENTITY_WINDOW_MS ?? String(10 * 60 * 1000)),
    message: "Manual payment updates were attempted too quickly. Please wait and try again.",
  },
  updateRefundStatus: {
    actorMax: Number(process.env.ORDER_UPDATE_REFUND_STATUS_ACTOR_MAX ?? "40"),
    actorWindowMs: Number(process.env.ORDER_UPDATE_REFUND_STATUS_ACTOR_WINDOW_MS ?? String(5 * 60 * 1000)),
    businessMax: Number(process.env.ORDER_UPDATE_REFUND_STATUS_BUSINESS_MAX ?? "250"),
    businessWindowMs: Number(process.env.ORDER_UPDATE_REFUND_STATUS_BUSINESS_WINDOW_MS ?? String(5 * 60 * 1000)),
    entityMax: Number(process.env.ORDER_UPDATE_REFUND_STATUS_ENTITY_MAX ?? "4"),
    entityWindowMs: Number(process.env.ORDER_UPDATE_REFUND_STATUS_ENTITY_WINDOW_MS ?? String(10 * 60 * 1000)),
    message: "Refund updates were attempted too quickly. Please wait and try again.",
  },
} as const;

function resolveOrderLedgerAmount(
  orderRow: {
    paidAmount?: string | number | null;
    expectedAmount?: string | number | null;
    refundAmount?: string | number | null;
  },
  latestPayment?: {
    paidAmount?: string | number | null;
  } | null,
): number {
  const amount = Number(
    orderRow.paidAmount ??
      latestPayment?.paidAmount ??
      orderRow.refundAmount ??
      orderRow.expectedAmount ??
      0,
  );
  return Number.isFinite(amount) ? amount : 0;
}

function resolveRefundAmount(
  value: string | undefined,
  orderRow: {
    paidAmount?: string | number | null;
    expectedAmount?: string | number | null;
    refundAmount?: string | number | null;
  },
): string | null {
  const parsedInput = Number(String(value ?? "").trim());
  if (Number.isFinite(parsedInput) && parsedInput > 0) {
    return parsedInput.toFixed(2);
  }
  const fallback = resolveOrderLedgerAmount(orderRow, null);
  return fallback > 0 ? fallback.toFixed(2) : null;
}

async function getBusinessOrderSettings(businessId: string) {
  const [biz] = await db
    .select({ settings: businesses.settings })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  return normalizeOrderFlowSettings(biz?.settings);
}

function cleanOptionalText(value: string | null | undefined, max = 500): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function cleanOptionalUrl(value: string | null | undefined): string | null {
  const normalized = cleanOptionalText(value, 1000);
  if (!normalized) return null;
  return /^https?:\/\//i.test(normalized) ? normalized : null;
}

function parseOptionalDate(value: string | null | undefined): Date | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asNullableDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function nextFulfillmentTimestamps(input: {
  currentStatus: string | null | undefined;
  nextStatus: OrderFulfillmentStatus;
  now: Date;
  existing: {
    packedAt?: Date | string | null;
    dispatchedAt?: Date | string | null;
    outForDeliveryAt?: Date | string | null;
    deliveredAt?: Date | string | null;
    failedDeliveryAt?: Date | string | null;
    returnedAt?: Date | string | null;
  };
}) {
  const current = normalizeOrderFulfillmentStatus(input.currentStatus);
  const changed = current !== input.nextStatus;
  const next = {
    packedAt: asNullableDate(input.existing.packedAt),
    dispatchedAt: asNullableDate(input.existing.dispatchedAt),
    outForDeliveryAt: asNullableDate(input.existing.outForDeliveryAt),
    deliveredAt: asNullableDate(input.existing.deliveredAt),
    failedDeliveryAt: asNullableDate(input.existing.failedDeliveryAt),
    returnedAt: asNullableDate(input.existing.returnedAt),
    fulfillmentUpdatedAt: changed ? input.now : null,
  };
  if (!changed) return next;
  if (input.nextStatus === "packed" && !next.packedAt) next.packedAt = input.now;
  if (input.nextStatus === "dispatched" && !next.dispatchedAt) next.dispatchedAt = input.now;
  if (input.nextStatus === "out_for_delivery" && !next.outForDeliveryAt) next.outForDeliveryAt = input.now;
  if (input.nextStatus === "delivered" && !next.deliveredAt) next.deliveredAt = input.now;
  if (input.nextStatus === "failed_delivery" && !next.failedDeliveryAt) next.failedDeliveryAt = input.now;
  if (input.nextStatus === "returned" && !next.returnedAt) next.returnedAt = input.now;
  return next;
}

function requiresDispatchData(status: OrderFulfillmentStatus): boolean {
  return status === "dispatched" || status === "out_for_delivery";
}

function canCaptureManualPayment(orderRow: {
  paymentMethod?: string | null;
  status?: string | null;
}): boolean {
  const method = String(orderRow.paymentMethod || "").trim().toLowerCase();
  const status = String(orderRow.status || "").trim().toLowerCase();
  return (method === "manual" || method === "cod") && ["approved", "payment_rejected"].includes(status);
}

function coalesceText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function buildStoredOrderFlowSettings(orderRow: {
  paymentMethod?: string | null;
  currency?: string | null;
  paymentConfigSnapshot?: Record<string, unknown> | null;
}) {
  const snapshot = asRecord(orderRow.paymentConfigSnapshot);
  return normalizeOrderFlowSettings({
    orderFlow: {
      ticketToOrderEnabled: true,
      paymentMethod: snapshot.paymentMethod ?? orderRow.paymentMethod ?? "manual",
      currency: snapshot.currency ?? orderRow.currency ?? "LKR",
      bankQr: asRecord(snapshot.bankQr),
    },
  });
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

type OrderAnalyticsDateField = "updatedAt" | "createdAt";
type OrderAnalyticsMethodFilter = "all" | "manual" | "bank_qr" | "cod";
type OrderAnalyticsFilterKey =
  | "all"
  | "needs_action"
  | "on_hold"
  | "active"
  | "in_transit"
  | "delivered"
  | "exceptions"
  | "refunds";

function getOrderRangeBounds(rangeDays: number) {
  const rangeEnd = new Date();
  rangeEnd.setHours(23, 59, 59, 999);
  const rangeStart = new Date(rangeEnd);
  rangeStart.setDate(rangeStart.getDate() - (rangeDays - 1));
  rangeStart.setHours(0, 0, 0, 0);
  return { rangeStart, rangeEnd };
}

function buildOrderSearchPattern(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? `%${normalized}%` : null;
}

function buildOrderBaseConditions(params: {
  businessId: string;
  status?: string;
  methodFilter?: OrderAnalyticsMethodFilter;
  dateField?: OrderAnalyticsDateField;
  rangeDays?: number;
  search?: string;
}) {
  const conditions: any[] = [eq(orders.businessId, params.businessId)];

  if (params.status) {
    conditions.push(eq(orders.status, params.status));
  }

  if (params.methodFilter && params.methodFilter !== "all") {
    conditions.push(eq(orders.paymentMethod, params.methodFilter));
  }

  if (params.dateField && params.rangeDays) {
    const { rangeStart, rangeEnd } = getOrderRangeBounds(params.rangeDays);
    const column = params.dateField === "createdAt" ? orders.createdAt : orders.updatedAt;
    conditions.push(gte(column, rangeStart));
    conditions.push(lte(column, rangeEnd));
  }

  const searchPattern = buildOrderSearchPattern(params.search);
  if (searchPattern) {
    conditions.push(
      or(
        ilike(orders.id, searchPattern),
        ilike(orders.customerName, searchPattern),
        ilike(orders.customerPhone, searchPattern),
        ilike(orders.recipientName, searchPattern),
        ilike(orders.recipientPhone, searchPattern),
        ilike(orders.paymentReference, searchPattern),
        ilike(orders.trackingNumber, searchPattern),
        ilike(orders.dispatchReference, searchPattern),
      ),
    );
  }

  return conditions;
}

async function hydrateOrderRows(businessId: string, orderRows: Array<typeof orders.$inferSelect>) {
  const orderIds = orderRows.map((row) => row.id);
  const paymentRows = orderIds.length
    ? await db
        .select()
        .from(orderPayments)
        .where(and(eq(orderPayments.businessId, businessId), inArray(orderPayments.orderId, orderIds)))
        .orderBy(desc(orderPayments.createdAt))
    : [];

  const latestPaymentByOrder = new Map<string, (typeof paymentRows)[number]>();
  for (const payment of paymentRows) {
    if (!latestPaymentByOrder.has(payment.orderId)) {
      latestPaymentByOrder.set(payment.orderId, payment);
    }
  }

  const threadIds = [...new Set(orderRows.map((row) => String(row.threadId || "").trim()).filter(Boolean))];
  const latestInboundRows = threadIds.length
    ? await db
        .select({
          threadId: threadMessages.threadId,
          createdAt: threadMessages.createdAt,
        })
        .from(threadMessages)
        .where(and(inArray(threadMessages.threadId, threadIds), eq(threadMessages.direction, "inbound")))
        .orderBy(desc(threadMessages.createdAt))
    : [];
  const latestInboundByThread = new Map<string, Date | string | null>();
  for (const row of latestInboundRows) {
    if (!latestInboundByThread.has(row.threadId)) {
      latestInboundByThread.set(row.threadId, row.createdAt);
    }
  }

  const identityIds = [...new Set(orderRows.map((row) => String(row.whatsappIdentityId || "").trim()).filter(Boolean))];
  const identityRows = identityIds.length
    ? await db
        .select({
          phoneNumberId: whatsappIdentities.phoneNumberId,
          displayPhoneNumber: whatsappIdentities.displayPhoneNumber,
        })
        .from(whatsappIdentities)
        .where(inArray(whatsappIdentities.phoneNumberId, identityIds))
    : [];
  const displayPhoneByIdentity = new Map(identityRows.map((row) => [row.phoneNumberId, row.displayPhoneNumber ?? null]));

  return orderRows.map((row) => {
    const latestPayment = latestPaymentByOrder.get(row.id) ?? null;
    const windowState = whatsappWindowState(row.threadId ? latestInboundByThread.get(row.threadId) : null);
    return {
      ...row,
      latestPayment,
      botDisplayPhoneNumber: row.whatsappIdentityId ? displayPhoneByIdentity.get(row.whatsappIdentityId) ?? null : null,
      ...windowState,
    };
  });
}

function latestSubmittedPaymentCondition() {
  return sql<boolean>`exists (
    select 1
    from ${orderPayments} op
    where op.business_id = ${orders.businessId}
      and op.order_id = ${orders.id}
      and lower(coalesce(op.status, '')) = 'submitted'
      and op.created_at = (
        select max(op2.created_at)
        from ${orderPayments} op2
        where op2.business_id = ${orders.businessId}
          and op2.order_id = ${orders.id}
      )
  )`;
}

function buildOrderAnalyticsConditions(params: {
  businessId: string;
  status?: string;
  methodFilter?: OrderAnalyticsMethodFilter;
  dateField?: OrderAnalyticsDateField;
  rangeDays?: number;
  search?: string;
  activeFilter?: OrderAnalyticsFilterKey;
}) {
  const conditions = buildOrderBaseConditions(params);
  const latestPaymentSubmitted = latestSubmittedPaymentCondition();

  switch (params.activeFilter) {
    case "needs_action":
      conditions.push(
        sql<boolean>`(
          lower(coalesce(${orders.status}, '')) in ('payment_submitted', 'payment_rejected')
          or lower(coalesce(${orders.fulfillmentStatus}, '')) in ('failed_delivery', 'returned')
          or (
            lower(coalesce(${orders.fulfillmentStatus}, '')) = 'packed'
            and coalesce(${orders.courierName}, '') = ''
            and coalesce(${orders.trackingNumber}, '') = ''
            and coalesce(${orders.dispatchReference}, '') = ''
          )
          or ${latestPaymentSubmitted}
        )`,
      );
      break;
    case "on_hold":
      conditions.push(eq(orders.fulfillmentStatus, "on_hold"));
      break;
    case "active":
      conditions.push(sql<boolean>`lower(coalesce(${orders.fulfillmentStatus}, '')) in ('queued', 'preparing', 'packed', 'dispatched', 'out_for_delivery')`);
      break;
    case "in_transit":
      conditions.push(sql<boolean>`lower(coalesce(${orders.fulfillmentStatus}, '')) in ('dispatched', 'out_for_delivery')`);
      break;
    case "delivered":
      conditions.push(eq(orders.fulfillmentStatus, "delivered"));
      break;
    case "exceptions":
      conditions.push(sql<boolean>`lower(coalesce(${orders.fulfillmentStatus}, '')) in ('failed_delivery', 'returned')`);
      break;
    case "refunds":
      conditions.push(sql<boolean>`lower(coalesce(${orders.status}, '')) in ('refund_pending', 'refunded')`);
      break;
    default:
      break;
  }

  return { conditions, latestPaymentSubmitted };
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
  return `${digits.slice(0, 2)}${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-2)}`;
}

type OrderCustomerContext = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  externalId: string | null;
  source: string | null;
  whatsappIdentityId: string | null;
};

type OrderThreadContext = {
  threadId: string;
  whatsappIdentityId: string | null;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  customerExternalId: string | null;
  customerSource: string | null;
};

async function lockWorkflowKey(tx: any, key: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}

async function flushBusinessOutbox(businessId: string) {
  await drainBusinessOutbox({ businessId, limit: 25 });
}

async function enforceOrderOperationThrottle(
  tx: any,
  ctx: {
    businessId: string;
    userId?: string | null;
    firebaseUid?: string | null;
    userEmail?: string | null;
  },
  action: keyof typeof ORDER_OPERATION_LIMITS,
  entityId: string,
) {
  const limits = ORDER_OPERATION_LIMITS[action];
  const actorKey = getStaffActorKey(ctx);
  await assertOperationThrottle(tx, {
    businessId: ctx.businessId,
    bucket: `order.${action}.actor`,
    scope: `${ctx.businessId}:${actorKey}`,
    max: limits.actorMax,
    windowMs: limits.actorWindowMs,
    message: limits.message,
  });
  await assertOperationThrottle(tx, {
    businessId: ctx.businessId,
    bucket: `order.${action}.business`,
    scope: ctx.businessId,
    max: limits.businessMax,
    windowMs: limits.businessWindowMs,
    message: limits.message,
  });
  await assertOperationThrottle(tx, {
    businessId: ctx.businessId,
    bucket: `order.${action}.entity`,
    scope: `${ctx.businessId}:${entityId}`,
    max: limits.entityMax,
    windowMs: limits.entityWindowMs,
    message: limits.message,
  });
}

async function getOrderCustomerContext(businessId: string, customerId: string | null | undefined): Promise<OrderCustomerContext | null> {
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

async function getOrderThreadContext(businessId: string, threadId: string | null | undefined): Promise<OrderThreadContext | null> {
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

async function resolveOrderNotificationContext(params: {
  businessId: string;
  customerId?: string | null;
  threadId?: string | null;
  whatsappIdentityId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
}) {
  const directCustomer = await getOrderCustomerContext(params.businessId, params.customerId);
  const threadContext = await getOrderThreadContext(params.businessId, params.threadId);

  const customerName = coalesceText(
    params.customerName,
    directCustomer?.name ?? null,
    threadContext?.customerName ?? null,
  );
  const customerEmail = coalesceText(
    params.customerEmail,
    directCustomer?.email ?? null,
  );
  const customerPhone = coalesceText(
    params.customerPhone,
    directCustomer?.phone ?? null,
    threadContext?.customerPhone ?? null,
    (directCustomer?.source ?? "").toLowerCase() === "whatsapp" ? directCustomer?.externalId ?? null : null,
  );
  const whatsappIdentityId = coalesceText(
    params.whatsappIdentityId,
    directCustomer?.whatsappIdentityId ?? null,
    threadContext?.whatsappIdentityId ?? null,
  );
  const recipient =
    preferredWhatsAppNumber("whatsapp", customerPhone) ??
    preferredWhatsAppNumber(directCustomer?.source, directCustomer?.phone, directCustomer?.externalId) ??
    preferredWhatsAppNumber(threadContext?.customerSource, threadContext?.customerPhone, threadContext?.customerExternalId);

  return {
    customerName,
    customerEmail,
    threadId: coalesceText(params.threadId, threadContext?.threadId ?? null),
    whatsappIdentityId,
    approvalRecipient: recipient ?? "",
    recipientSource:
      preferredWhatsAppNumber("whatsapp", customerPhone) != null
        ? "order.customer_phone"
        : preferredWhatsAppNumber(directCustomer?.source, directCustomer?.phone) != null
          ? "customer.phone"
          : preferredWhatsAppNumber(directCustomer?.source, directCustomer?.externalId) != null
            ? "customer.external_id"
            : preferredWhatsAppNumber(threadContext?.customerSource, threadContext?.customerPhone) != null
              ? "thread.customer.phone"
              : preferredWhatsAppNumber(threadContext?.customerSource, threadContext?.customerExternalId) != null
                ? "thread.customer.external_id"
                : null,
    whatsappIdentitySource: coalesceText(params.whatsappIdentityId)
      ? "order.whatsapp_identity_id"
      : coalesceText(directCustomer?.whatsappIdentityId ?? null)
        ? "customer.whatsapp_identity_id"
        : coalesceText(threadContext?.whatsappIdentityId ?? null)
          ? "thread.whatsapp_identity_id"
          : null,
  };
}

function buildPaymentReviewMessages(input: {
  action: "approve" | "reject";
  orderId: string;
  paymentReference?: string | null;
  paidAmount?: string | number | null;
  currency: string;
  notes?: string | null;
}): BotSendMessage[] {
  const ref = String(input.paymentReference || input.orderId.slice(0, 8).toUpperCase()).trim();
  if (input.action === "approve") {
    const lines = [
      `We have approved your payment for order reference ${ref}.`,
      input.paidAmount ? `Amount received: ${input.currency} ${String(input.paidAmount).trim()}.` : null,
      "Your order is now marked as paid and our team will continue processing it.",
    ].filter(Boolean);
    return [{ type: "text", text: lines.join("\n") }];
  }
  const lines = [
    `We reviewed the payment proof for order reference ${ref}, but we could not verify it yet.`,
    input.notes ? `Reason: ${String(input.notes).trim()}.` : null,
    "Please resend a clear payment slip in this chat after checking the transfer details.",
  ].filter(Boolean);
  return [{ type: "text", text: lines.join("\n") }];
}

function buildPaymentReviewEmail(input: {
  action: "approve" | "reject";
  orderId: string;
  paymentReference?: string | null;
  paidAmount?: string | number | null;
  currency: string;
  notes?: string | null;
}): OrderEmailMessage {
  const ref = String(input.paymentReference || input.orderId.slice(0, 8).toUpperCase()).trim();
  const approved = input.action === "approve";
  const subject = approved ? `Order confirmed: ${ref}` : `Payment needs attention: ${ref}`;
  const lines = approved
    ? [
        `We have approved your payment for order reference ${ref}.`,
        input.paidAmount ? `Amount received: ${input.currency} ${String(input.paidAmount).trim()}.` : null,
        "Your order is now confirmed and queued for fulfilment.",
      ]
    : [
        `We reviewed the payment proof for order reference ${ref}, but we could not verify it yet.`,
        input.notes ? `Reason: ${String(input.notes).trim()}.` : null,
        "Please resend a clear payment slip after checking the transfer details.",
      ];
  const text = lines.filter(Boolean).join("\n");
  return {
    subject,
    text,
    html: `<div style="font-family:Montserrat,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#0b1220;color:#e5edf6"><div style="border:1px solid #21324a;border-radius:18px;padding:24px;background:#122038"><div style="font-size:24px;font-weight:700;margin:0 0 12px">${subject}</div><pre style="margin:0;white-space:pre-wrap;font:14px/1.7 inherit;color:#f6fbff">${text}</pre></div></div>`,
  };
}

function buildRefundStatusMessages(input: {
  action: "mark_pending" | "mark_refunded" | "cancel";
  orderId: string;
  paymentReference?: string | null;
  refundAmount?: string | null;
  currency: string;
  reason?: string | null;
}): BotSendMessage[] {
  const ref = String(input.paymentReference || input.orderId.slice(0, 8).toUpperCase()).trim();
  if (input.action === "mark_pending") {
    const lines = [
      `We have started reviewing your refund for order reference ${ref}.`,
      input.reason ? `Reason noted: ${input.reason}.` : null,
      "We will update you again as soon as the refund is processed.",
    ].filter(Boolean);
    return [{ type: "text", text: lines.join("\n") }];
  }
  if (input.action === "mark_refunded") {
    const lines = [
      `Your refund for order reference ${ref} has been completed.`,
      input.refundAmount ? `Refunded amount: ${input.currency} ${input.refundAmount}.` : null,
    ].filter(Boolean);
    return [{ type: "text", text: lines.join("\n") }];
  }
  return [{ type: "text", text: `Your refund request for order reference ${ref} has been cancelled, and the order remains paid.` }];
}

export const ordersRouter = router({
  listOrders: businessProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(500).optional(),
          status: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const settings = await getBusinessOrderSettings(ctx.businessId);
      const filters = [eq(orders.businessId, ctx.businessId)];
      if (input?.status) filters.push(eq(orders.status, input.status));

      const orderRows = await db
        .select()
        .from(orders)
        .where(and(...filters))
        .orderBy(desc(orders.updatedAt), desc(orders.createdAt))
        .limit(input?.limit ?? 200);

      const orderIds = orderRows.map((row) => row.id);
      const paymentRows = orderIds.length
        ? await db
            .select()
            .from(orderPayments)
            .where(and(eq(orderPayments.businessId, ctx.businessId), inArray(orderPayments.orderId, orderIds)))
            .orderBy(desc(orderPayments.createdAt))
        : [];

      const latestPaymentByOrder = new Map<string, (typeof paymentRows)[number]>();
      for (const payment of paymentRows) {
        if (!latestPaymentByOrder.has(payment.orderId)) {
          latestPaymentByOrder.set(payment.orderId, payment);
        }
      }

      const threadIds = [...new Set(orderRows.map((row) => String(row.threadId || "").trim()).filter(Boolean))];
      const latestInboundRows = threadIds.length
        ? await db
            .select({
              threadId: threadMessages.threadId,
              createdAt: threadMessages.createdAt,
            })
            .from(threadMessages)
            .where(and(inArray(threadMessages.threadId, threadIds), eq(threadMessages.direction, "inbound")))
            .orderBy(desc(threadMessages.createdAt))
        : [];
      const latestInboundByThread = new Map<string, Date | string | null>();
      for (const row of latestInboundRows) {
        if (!latestInboundByThread.has(row.threadId)) {
          latestInboundByThread.set(row.threadId, row.createdAt);
        }
      }

      const identityIds = [...new Set(orderRows.map((row) => String(row.whatsappIdentityId || "").trim()).filter(Boolean))];
      const identityRows = identityIds.length
        ? await db
            .select({
              phoneNumberId: whatsappIdentities.phoneNumberId,
              displayPhoneNumber: whatsappIdentities.displayPhoneNumber,
            })
            .from(whatsappIdentities)
            .where(inArray(whatsappIdentities.phoneNumberId, identityIds))
        : [];
      const displayPhoneByIdentity = new Map(identityRows.map((row) => [row.phoneNumberId, row.displayPhoneNumber ?? null]));

      return {
        settings,
        items: orderRows.map((row) => {
          const latestPayment = latestPaymentByOrder.get(row.id) ?? null;
          const windowState = whatsappWindowState(row.threadId ? latestInboundByThread.get(row.threadId) : null);
          return {
            ...row,
            latestPayment,
            botDisplayPhoneNumber: row.whatsappIdentityId ? displayPhoneByIdentity.get(row.whatsappIdentityId) ?? null : null,
            ...windowState,
          };
        }),
      };
    }),

  listOrdersPage: businessProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
        search: z.string().optional(),
        activeFilter: z
          .enum(["all", "needs_action", "on_hold", "active", "in_transit", "delivered", "exceptions", "refunds"])
          .default("all"),
        dateField: z.enum(["updatedAt", "createdAt"]).default("updatedAt"),
        rangeDays: z.number().int().min(1).max(365).default(30),
        methodFilter: z.enum(["all", "manual", "bank_qr", "cod"]).default("all"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const settings = await getBusinessOrderSettings(ctx.businessId);
      const { conditions } = buildOrderAnalyticsConditions({
        businessId: ctx.businessId,
        methodFilter: input.methodFilter,
        dateField: input.dateField,
        rangeDays: input.rangeDays,
        search: input.search,
        activeFilter: input.activeFilter,
      });

      const [countRow] = await db
        .select({
          count: sql<number>`count(*)::int`,
        })
        .from(orders)
        .where(and(...conditions));

      const orderRows = await db
        .select()
        .from(orders)
        .where(and(...conditions))
        .orderBy(desc(orders.updatedAt), desc(orders.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const hydratedOrders = await hydrateOrderRows(ctx.businessId, orderRows);

      return {
        settings,
        totalCount: countRow?.count ?? 0,
        items: hydratedOrders,
      };
    }),

  getOverview: businessProcedure
    .input(
      z.object({
        dateField: z.enum(["updatedAt", "createdAt"]).default("updatedAt"),
        rangeDays: z.number().int().min(1).max(365).default(30),
        methodFilter: z.enum(["all", "manual", "bank_qr", "cod"]).default("all"),
        mode: z.enum(["orders", "revenue"]).default("orders"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const settings = await getBusinessOrderSettings(ctx.businessId);
      const { conditions, latestPaymentSubmitted } = buildOrderAnalyticsConditions({
        businessId: ctx.businessId,
        methodFilter: input.methodFilter,
        dateField: input.dateField,
        rangeDays: input.rangeDays,
      });

      const statusExpr = sql<string>`lower(coalesce(${orders.status}, ''))`;
      const fulfillmentExpr = sql<string>`lower(coalesce(${orders.fulfillmentStatus}, ''))`;
      const amountExpr = sql<number>`coalesce(${orders.paidAmount}, ${orders.refundAmount}, ${orders.expectedAmount}, 0)::numeric`;
      const paidExpr = sql<number>`coalesce(${orders.paidAmount}, ${orders.expectedAmount}, 0)::numeric`;
      const refundExpr = sql<number>`coalesce(${orders.refundAmount}, ${orders.paidAmount}, ${orders.expectedAmount}, 0)::numeric`;
      const needsActionExpr = sql<boolean>`(
        ${statusExpr} in ('payment_submitted', 'payment_rejected')
        or ${fulfillmentExpr} in ('failed_delivery', 'returned')
        or (
          ${fulfillmentExpr} = 'packed'
          and coalesce(${orders.courierName}, '') = ''
          and coalesce(${orders.trackingNumber}, '') = ''
          and coalesce(${orders.dispatchReference}, '') = ''
        )
        or ${latestPaymentSubmitted}
      )`;

      const [aggregateRow] = await db
        .select({
          scopedCount: sql<number>`count(*)::int`,
          needsAction: sql<number>`count(*) filter (where ${needsActionExpr})::int`,
          inFulfilment: sql<number>`count(*) filter (where ${fulfillmentExpr} in ('queued', 'preparing', 'packed', 'dispatched', 'out_for_delivery'))::int`,
          inTransit: sql<number>`count(*) filter (where ${fulfillmentExpr} in ('dispatched', 'out_for_delivery'))::int`,
          delivered: sql<number>`count(*) filter (where ${fulfillmentExpr} = 'delivered')::int`,
          exceptions: sql<number>`count(*) filter (where ${fulfillmentExpr} in ('failed_delivery', 'returned'))::int`,
          booked: sql<number>`coalesce(sum(${amountExpr}), 0)::float`,
          collected: sql<number>`coalesce(sum(case when ${statusExpr} = 'paid' then ${paidExpr} else 0 end), 0)::float`,
          pending: sql<number>`coalesce(sum(case when ${statusExpr} not in ('paid', 'refunded', 'refund_pending') then ${amountExpr} else 0 end), 0)::float`,
          refundExposure: sql<number>`coalesce(sum(case when ${statusExpr} in ('refunded', 'refund_pending') then ${refundExpr} else 0 end), 0)::float`,
          needsActionCount: sql<number>`count(*) filter (where ${needsActionExpr})::int`,
          onHoldCount: sql<number>`count(*) filter (where ${fulfillmentExpr} = 'on_hold')::int`,
          activeCount: sql<number>`count(*) filter (where ${fulfillmentExpr} in ('queued', 'preparing', 'packed', 'dispatched', 'out_for_delivery'))::int`,
          inTransitCount: sql<number>`count(*) filter (where ${fulfillmentExpr} in ('dispatched', 'out_for_delivery'))::int`,
          deliveredCount: sql<number>`count(*) filter (where ${fulfillmentExpr} = 'delivered')::int`,
          exceptionsCount: sql<number>`count(*) filter (where ${fulfillmentExpr} in ('failed_delivery', 'returned'))::int`,
          refundsCount: sql<number>`count(*) filter (where ${statusExpr} in ('refund_pending', 'refunded'))::int`,
          awaitingCount: sql<number>`count(*) filter (where ${statusExpr} not in ('paid', 'payment_submitted', 'refund_pending', 'refunded', 'payment_rejected', 'denied'))::int`,
          reviewCount: sql<number>`count(*) filter (where ${statusExpr} = 'payment_submitted')::int`,
          collectedCount: sql<number>`count(*) filter (where ${statusExpr} = 'paid')::int`,
          refundsMixCount: sql<number>`count(*) filter (where ${statusExpr} in ('refund_pending', 'refunded'))::int`,
          exceptionsMixCount: sql<number>`count(*) filter (where ${statusExpr} in ('payment_rejected', 'denied'))::int`,
        })
        .from(orders)
        .where(and(...conditions));

      const trendColumn = input.dateField === "createdAt" ? orders.createdAt : orders.updatedAt;
      const trendRows = await db
        .select({
          day: sql<Date>`date_trunc('day', ${trendColumn})`,
          expected: sql<number>`coalesce(sum(${amountExpr}), 0)::float`,
          collected: sql<number>`coalesce(sum(case when ${statusExpr} = 'paid' then ${paidExpr} else 0 end), 0)::float`,
        })
        .from(orders)
        .where(and(...conditions))
        .groupBy(sql`date_trunc('day', ${trendColumn})`)
        .orderBy(sql`date_trunc('day', ${trendColumn}) asc`);

      const trendData = trendRows
        .map((row) => ({
          sortKey: new Date(row.day).getTime(),
          label: new Date(row.day).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
          expected: Number(row.expected ?? 0),
          collected: Number(row.collected ?? 0),
        }))
        .sort((a, b) => a.sortKey - b.sortKey)
        .slice(-Math.min(input.rangeDays, 14));

      const metrics = {
        needsAction: Number(aggregateRow?.needsAction ?? 0),
        inFulfilment: Number(aggregateRow?.inFulfilment ?? 0),
        inTransit: Number(aggregateRow?.inTransit ?? 0),
        delivered: Number(aggregateRow?.delivered ?? 0),
        exceptions: Number(aggregateRow?.exceptions ?? 0),
      };

      const mixData = input.mode === "revenue"
        ? [
            { name: "Awaiting", value: Number(aggregateRow?.awaitingCount ?? 0) },
            { name: "Review", value: Number(aggregateRow?.reviewCount ?? 0) },
            { name: "Collected", value: Number(aggregateRow?.collectedCount ?? 0) },
            { name: "Refunds", value: Number(aggregateRow?.refundsMixCount ?? 0) },
            { name: "Exceptions", value: Number(aggregateRow?.exceptionsMixCount ?? 0) },
          ].filter((entry) => entry.value > 0)
        : [
            { name: "Needs Action", value: metrics.needsAction },
            { name: "In Fulfilment", value: metrics.inFulfilment },
            { name: "In Transit", value: metrics.inTransit },
            { name: "Delivered", value: metrics.delivered },
            { name: "Exceptions", value: metrics.exceptions },
          ].filter((entry) => entry.value > 0);

      return {
        settings,
        scopedCount: Number(aggregateRow?.scopedCount ?? 0),
        metrics,
        financeTotals: {
          booked: Number(aggregateRow?.booked ?? 0),
          collected: Number(aggregateRow?.collected ?? 0),
          pending: Number(aggregateRow?.pending ?? 0),
          refundExposure: Number(aggregateRow?.refundExposure ?? 0),
        },
        filterCounts: {
          all: Number(aggregateRow?.scopedCount ?? 0),
          needs_action: Number(aggregateRow?.needsActionCount ?? 0),
          on_hold: Number(aggregateRow?.onHoldCount ?? 0),
          active: Number(aggregateRow?.activeCount ?? 0),
          in_transit: Number(aggregateRow?.inTransitCount ?? 0),
          delivered: Number(aggregateRow?.deliveredCount ?? 0),
          exceptions: Number(aggregateRow?.exceptionsCount ?? 0),
          refunds: Number(aggregateRow?.refundsCount ?? 0),
        },
        trendData,
        mixData,
      };
    }),

  getOrderById: businessProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select()
        .from(orders)
        .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
        .limit(1);
      if (!rows.length) return null;
      const [hydrated] = await hydrateOrderRows(ctx.businessId, rows);
      return hydrated ?? null;
    }),

  getStats: businessProcedure.query(async ({ ctx }) => {
    const settings = await getBusinessOrderSettings(ctx.businessId);
    const rows = await db.select().from(orders).where(eq(orders.businessId, ctx.businessId));
    const orderIds = rows.map((row) => row.id);
    const payments = orderIds.length
      ? await db
          .select()
          .from(orderPayments)
          .where(and(eq(orderPayments.businessId, ctx.businessId), inArray(orderPayments.orderId, orderIds)))
          .orderBy(desc(orderPayments.createdAt))
      : [];

    const latestPaymentByOrder = new Map<string, (typeof payments)[number]>();
    for (const payment of payments) {
      if (!latestPaymentByOrder.has(payment.orderId)) {
        latestPaymentByOrder.set(payment.orderId, payment);
      }
    }

    let pendingPaymentCount = 0;
    let paymentSubmittedCount = 0;
    let paidCount = 0;
    let refundPendingCount = 0;
    let refundedCount = 0;
    let approvedAmount = 0;
    let grossCollectedAmount = 0;
    let refundPendingAmount = 0;
    let refundedAmount = 0;

    for (const row of rows) {
      const latestPayment = latestPaymentByOrder.get(row.id);
      const amount = resolveOrderLedgerAmount(row, latestPayment);
      if (row.status === "awaiting_payment") pendingPaymentCount += 1;
      if (row.status === "payment_submitted") paymentSubmittedCount += 1;
      if (row.status === "paid") {
        paidCount += 1;
        approvedAmount += amount;
        grossCollectedAmount += amount;
      }
      if (row.status === "refund_pending") {
        refundPendingCount += 1;
        refundPendingAmount += amount;
        grossCollectedAmount += amount;
      }
      if (row.status === "refunded") {
        refundedCount += 1;
        refundedAmount += amount;
        grossCollectedAmount += amount;
      }
    }

    return {
      settings,
      totalOrders: rows.length,
      pendingPaymentCount,
      paymentSubmittedCount,
      paidCount,
      refundPendingCount,
      refundedCount,
      approvedAmount: approvedAmount.toFixed(2),
      grossCollectedAmount: grossCollectedAmount.toFixed(2),
      refundPendingAmount: refundPendingAmount.toFixed(2),
      refundedAmount: refundedAmount.toFixed(2),
    };
  }),

  getOrderPayments: businessProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return db
        .select()
        .from(orderPayments)
        .where(and(eq(orderPayments.businessId, ctx.businessId), eq(orderPayments.orderId, input.orderId)))
        .orderBy(desc(orderPayments.createdAt));
    }),

  getOrderEvents: businessProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return db
        .select()
        .from(orderEvents)
        .where(and(eq(orderEvents.businessId, ctx.businessId), eq(orderEvents.orderId, input.orderId)))
        .orderBy(desc(orderEvents.createdAt));
    }),

  sendPaymentDetails: businessProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const settings = await getBusinessOrderSettings(ctx.businessId);
      if (!settings.ticketToOrderEnabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket-to-order flow is disabled for this business." });
      }
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        await lockWorkflowKey(tx, `${ctx.businessId}::order::${input.orderId}`);
        await enforceOrderOperationThrottle(tx, ctx, "sendPaymentDetails", input.orderId);

        const [orderRow] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
          .limit(1);
        if (!orderRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
        }
        if (String(orderRow.paymentMethod || "").trim().toLowerCase() !== "bank_qr") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Payment details can only be sent for Bank / QR orders." });
        }
        if (!["awaiting_payment", "payment_rejected"].includes(String(orderRow.status || "").trim().toLowerCase())) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Payment details can only be resent while the order is awaiting payment." });
        }

        const lastInboundRows = orderRow.threadId
          ? await tx
              .select({ createdAt: threadMessages.createdAt })
              .from(threadMessages)
              .where(and(eq(threadMessages.threadId, orderRow.threadId), eq(threadMessages.direction, "inbound")))
              .orderBy(desc(threadMessages.createdAt))
              .limit(1)
          : [];
        const lastInboundAt = lastInboundRows[0]?.createdAt ?? null;
        const windowState = whatsappWindowState(lastInboundAt);
        if (!windowState.whatsappWindowOpen) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The WhatsApp 24-hour window is closed for this customer." });
        }

        const contactContext = await resolveOrderNotificationContext({
          businessId: ctx.businessId,
          customerId: orderRow.customerId ?? null,
          threadId: orderRow.threadId ?? null,
          whatsappIdentityId: orderRow.whatsappIdentityId ?? null,
          customerName: orderRow.customerName ?? null,
          customerEmail: orderRow.customerEmail ?? null,
          customerPhone: orderRow.customerPhone ?? null,
        });
        if (!contactContext.whatsappIdentityId || !sanitizePhoneDigits(contactContext.approvalRecipient)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This order is missing WhatsApp routing details." });
        }

        const orderSettings = buildStoredOrderFlowSettings(orderRow);
        const snapshot = asRecord(orderRow.ticketSnapshot);
        const messages = buildOrderApprovalMessages({
          orderId: orderRow.id,
          customerName: contactContext.customerName ?? orderRow.customerName,
          itemsSummary: formatOrderItemsSummary(snapshot),
          expectedAmount: orderRow.expectedAmount?.toString() ?? null,
          paymentReference: orderRow.paymentReference,
          orderSettings,
        });
        const notification = await enqueueWhatsAppOutboxMessages(tx, {
          businessId: ctx.businessId,
          entityType: "order",
          entityId: orderRow.id,
          customerId: orderRow.customerId ?? null,
          threadId: contactContext.threadId ?? null,
          whatsappIdentityId: contactContext.whatsappIdentityId ?? null,
          recipient: contactContext.approvalRecipient,
          recipientSource: contactContext.recipientSource,
          whatsappIdentitySource: contactContext.whatsappIdentitySource,
          source: "order_payment_details_manual_send",
          idempotencyBaseKey: `order:${orderRow.id}:payment_details_manual_send:${now.toISOString()}`,
          messages,
        });

        return {
          orderRow,
          notification,
          windowState,
          botDisplayPhoneNumber: contactContext.whatsappIdentityId,
        };
      });

      let delivery = {
        ok: true,
        error: null as string | null,
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

      await logOrderEvent({
        businessId: ctx.businessId,
        orderId: result.orderRow.id,
        eventType: "payment_details_sent",
        actorType: "user",
        actorId: ctx.userId ?? ctx.firebaseUid ?? null,
        actorLabel: ctx.userEmail ?? "user",
        payload: {
          recipient: maskPhoneNumber(result.orderRow.customerPhone ?? null),
          recipientSource: delivery.recipientSource,
          whatsappIdentitySource: delivery.whatsappIdentitySource,
          windowExpiresAt: result.windowState.whatsappWindowExpiresAt?.toISOString() ?? null,
        },
      });

      recordBusinessEvent({
        event: "order.payment_details_sent",
        action: "sendPaymentDetails",
        area: "order",
        businessId: ctx.businessId,
        entity: "order",
        entityId: result.orderRow.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: delivery.ok ? "success" : "degraded",
        status: result.orderRow.status,
        attributes: {
          delivery_ok: delivery.ok,
          delivery_phone_source: delivery.recipientSource,
          delivery_identity_source: delivery.whatsappIdentitySource,
        },
      });

      return {
        ok: delivery.ok,
        error: delivery.error,
        orderId: result.orderRow.id,
        windowExpiresAt: result.windowState.whatsappWindowExpiresAt,
      };
    }),

  reviewPayment: businessProcedure
    .input(
      z.object({
        paymentId: z.string().min(1),
        action: reviewActionSchema,
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const settings = await getBusinessOrderSettings(ctx.businessId);
      if (!settings.ticketToOrderEnabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket-to-order flow is disabled for this business." });
      }
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        const [paymentRow] = await tx
          .select()
          .from(orderPayments)
          .where(and(eq(orderPayments.businessId, ctx.businessId), eq(orderPayments.id, input.paymentId)))
          .limit(1);
        if (!paymentRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order payment not found." });
        }

        await lockWorkflowKey(tx, `${ctx.businessId}::order::${paymentRow.orderId}`);
        await enforceOrderOperationThrottle(tx, ctx, "reviewPayment", paymentRow.orderId);

        const [orderRow] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, paymentRow.orderId)))
          .limit(1);
        if (!orderRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
        }
        if (String(paymentRow.status || "").trim().toLowerCase() !== "submitted") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only submitted payments can be reviewed." });
        }
        if (String(orderRow.status || "").trim().toLowerCase() !== "payment_submitted") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only payment-submitted orders can be reviewed." });
        }
        const [latestPayment] = await tx
          .select({
            id: orderPayments.id,
            status: orderPayments.status,
          })
          .from(orderPayments)
          .where(and(eq(orderPayments.businessId, ctx.businessId), eq(orderPayments.orderId, paymentRow.orderId)))
          .orderBy(desc(orderPayments.createdAt), desc(orderPayments.id))
          .limit(1);
        if (!latestPayment || latestPayment.id !== paymentRow.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only the latest payment submission can be reviewed." });
        }

        const nextPaymentStatus = input.action === "approve" ? "approved_manual" : "rejected";
        const nextOrderStatus = input.action === "approve" ? "paid" : "payment_rejected";
        const nextFulfillmentStatus =
          input.action === "approve" && normalizeOrderFulfillmentStatus(orderRow.fulfillmentStatus) === "on_hold"
            ? "queued"
            : normalizeOrderFulfillmentStatus(orderRow.fulfillmentStatus);

        const [updatedPayment] = await tx
          .update(orderPayments)
          .set({
            status: nextPaymentStatus,
            aiCheckNotes: input.notes?.trim() || paymentRow.aiCheckNotes,
            updatedAt: now,
          })
          .where(eq(orderPayments.id, paymentRow.id))
          .returning();

        const [updatedOrder] = await tx
          .update(orders)
          .set({
            status: nextOrderStatus,
            fulfillmentStatus: nextFulfillmentStatus,
            fulfillmentUpdatedAt:
              input.action === "approve" && normalizeOrderFulfillmentStatus(orderRow.fulfillmentStatus) === "on_hold"
                ? now
                : orderRow.fulfillmentUpdatedAt,
            paidAmount: paymentRow.paidAmount ?? orderRow.paidAmount,
            paymentApprovedAt: input.action === "approve" ? now : null,
            paymentRejectedAt: input.action === "reject" ? now : null,
            updatedAt: now,
          })
          .where(eq(orders.id, orderRow.id))
          .returning();

        if (!updatedPayment || !updatedOrder) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to review payment." });
        }

        const contactContext = await resolveOrderNotificationContext({
          businessId: ctx.businessId,
          customerId: updatedOrder.customerId ?? null,
          threadId: updatedOrder.threadId ?? null,
          whatsappIdentityId: updatedOrder.whatsappIdentityId ?? null,
          customerName: updatedOrder.customerName ?? null,
          customerEmail: updatedOrder.customerEmail ?? null,
          customerPhone: updatedOrder.customerPhone ?? null,
        });
        const notification = await enqueueWhatsAppOutboxMessages(tx, {
          businessId: ctx.businessId,
          entityType: "order",
          entityId: updatedOrder.id,
          customerId: updatedOrder.customerId ?? null,
          threadId: contactContext.threadId ?? null,
          whatsappIdentityId: contactContext.whatsappIdentityId ?? null,
          recipient: contactContext.approvalRecipient,
          recipientSource: contactContext.recipientSource,
          whatsappIdentitySource: contactContext.whatsappIdentitySource,
          source: input.action === "approve" ? "order_payment_approved" : "order_payment_rejected",
          idempotencyBaseKey: `order:${updatedOrder.id}:payment_review:${paymentRow.id}:${input.action}`,
          messages: buildPaymentReviewMessages({
            action: input.action,
            orderId: updatedOrder.id,
            paymentReference: updatedOrder.paymentReference,
            paidAmount: updatedPayment.paidAmount ?? updatedOrder.paidAmount,
            currency: String(updatedOrder.currency || "LKR").trim() || "LKR",
            notes: input.notes?.trim() || null,
          }),
        });
        const emailNotification = contactContext.customerEmail
          && input.action === "approve"
          ? await enqueueEmailOutboxMessages(tx, {
              businessId: ctx.businessId,
              entityType: "order",
              entityId: updatedOrder.id,
              customerId: updatedOrder.customerId ?? null,
              recipientEmail: contactContext.customerEmail,
              source: "order_payment_approved_email",
              idempotencyBaseKey: `order:${updatedOrder.id}:payment_review_email:${paymentRow.id}:approve`,
              messages: [
                buildPaymentReviewEmail({
                  action: "approve",
                  orderId: updatedOrder.id,
                  paymentReference: updatedOrder.paymentReference,
                  paidAmount: updatedPayment.paidAmount ?? updatedOrder.paidAmount,
                  currency: String(updatedOrder.currency || "LKR").trim() || "LKR",
                  notes: input.notes?.trim() || null,
                }),
              ],
            })
          : { ok: true as const, error: null, idempotencyKeys: [] as string[] };

        return {
          paymentRow,
          orderRow,
          updatedPayment,
          updatedOrder,
          nextPaymentStatus,
          nextOrderStatus,
          nextFulfillmentStatus,
          notification,
          emailNotification,
        };
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
      if (result.emailNotification.ok && result.emailNotification.idempotencyKeys.length) {
        await drainBusinessOutbox({
          businessId: ctx.businessId,
          idempotencyKeys: result.emailNotification.idempotencyKeys,
          limit: result.emailNotification.idempotencyKeys.length,
        });
      }
      await flushBusinessOutbox(ctx.businessId);

      await logOrderEvent({
        businessId: ctx.businessId,
        orderId: result.updatedOrder.id,
        eventType: input.action === "approve" ? "payment_approved" : "payment_rejected",
        actorType: "user",
        actorId: ctx.userId ?? ctx.firebaseUid ?? null,
        actorLabel: ctx.userEmail ?? "user",
        payload: {
          notes: input.notes?.trim() || null,
          paymentId: result.paymentRow.id,
          paymentStatus: result.nextPaymentStatus,
          fulfillmentStatus: result.nextFulfillmentStatus,
        },
      });
      if (input.action === "approve" && normalizeOrderFulfillmentStatus(result.orderRow.fulfillmentStatus) === "on_hold") {
        await logOrderEvent({
          businessId: ctx.businessId,
          orderId: result.updatedOrder.id,
          eventType: "fulfillment_released",
          actorType: "system",
          actorLabel: "system",
          payload: {
            from: result.orderRow.fulfillmentStatus,
            to: result.nextFulfillmentStatus,
          },
        });
      }
      if (!delivery.ok) {
        await logOrderEvent({
          businessId: ctx.businessId,
          orderId: result.updatedOrder.id,
          eventType: "payment_review_notification_failed",
          actorType: "system",
          actorLabel: "bot",
          payload: {
            action: input.action,
            error: delivery.error,
          },
        });
      }

      await publishPortalEvent({
        businessId: ctx.businessId,
        entity: "order",
        op: "upsert",
        entityId: result.updatedOrder.id,
        payload: {
          order: {
            ...result.updatedOrder,
            latestPayment: result.updatedPayment,
          } as any,
        },
        createdAt: result.updatedOrder.updatedAt ?? result.updatedOrder.createdAt ?? now,
      });

      recordBusinessEvent({
        event: "order.payment_reviewed",
        action: "reviewPayment",
        area: "order",
        businessId: ctx.businessId,
        entity: "order_payment",
        entityId: result.paymentRow.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: delivery.ok ? "success" : "degraded",
        status: result.nextPaymentStatus,
        attributes: {
          action: input.action,
          order_id: result.updatedOrder.id,
          delivery_ok: delivery.ok,
          delivery_phone_source: delivery.recipientSource,
          delivery_identity_source: delivery.whatsappIdentitySource,
        },
      });

      return {
        order: result.updatedOrder,
        payment: result.updatedPayment,
        delivery,
      };
    }),

  updateFulfillment: businessProcedure
    .input(
      z.object({
        orderId: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        fulfillmentStatus: fulfillmentStatusSchema.optional(),
        recipientName: z.string().optional().nullable(),
        recipientPhone: z.string().optional().nullable(),
        shippingAddress: z.string().optional().nullable(),
        deliveryArea: z.string().optional().nullable(),
        deliveryNotes: z.string().optional().nullable(),
        courierName: z.string().optional().nullable(),
        trackingNumber: z.string().optional().nullable(),
        trackingUrl: z.string().optional().nullable(),
        dispatchReference: z.string().optional().nullable(),
        scheduledDeliveryAt: z.string().optional().nullable(),
        fulfillmentNotes: z.string().optional().nullable(),
        notifyCustomer: z.boolean().optional(),
        customerMessage: z.string().optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const settings = await getBusinessOrderSettings(ctx.businessId);
      if (!settings.ticketToOrderEnabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket-to-order flow is disabled for this business." });
      }
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        await lockWorkflowKey(tx, `${ctx.businessId}::order::${input.orderId}`);
        await enforceOrderOperationThrottle(tx, ctx, "updateFulfillment", input.orderId);

        const [orderRow] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
          .limit(1);
        if (!orderRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
        }
        assertExpectedUpdatedAt({
          entityLabel: "order",
          expectedUpdatedAt: input.expectedUpdatedAt,
          actualUpdatedAt: orderRow.updatedAt,
        });

        const nextFulfillmentStatus = input.fulfillmentStatus
          ? normalizeOrderFulfillmentStatus(input.fulfillmentStatus)
          : normalizeOrderFulfillmentStatus(orderRow.fulfillmentStatus);
        const nextRecipientName = cleanOptionalText(
          input.recipientName === undefined ? orderRow.recipientName : input.recipientName,
          160,
        );
        const nextRecipientPhone = cleanOptionalText(
          input.recipientPhone === undefined ? orderRow.recipientPhone : input.recipientPhone,
          50,
        );
        const nextShippingAddress = cleanOptionalText(
          input.shippingAddress === undefined ? orderRow.shippingAddress : input.shippingAddress,
          1200,
        );
        const nextDeliveryArea = cleanOptionalText(
          input.deliveryArea === undefined ? orderRow.deliveryArea : input.deliveryArea,
          200,
        );
        const nextDeliveryNotes = cleanOptionalText(
          input.deliveryNotes === undefined ? orderRow.deliveryNotes : input.deliveryNotes,
          1200,
        );
        const nextCourierName = cleanOptionalText(
          input.courierName === undefined ? orderRow.courierName : input.courierName,
          160,
        );
        const nextTrackingNumber = cleanOptionalText(
          input.trackingNumber === undefined ? orderRow.trackingNumber : input.trackingNumber,
          160,
        );
        const nextTrackingUrl = cleanOptionalUrl(
          input.trackingUrl === undefined ? orderRow.trackingUrl : input.trackingUrl,
        );
        const nextDispatchReference = cleanOptionalText(
          input.dispatchReference === undefined ? orderRow.dispatchReference : input.dispatchReference,
          200,
        );
        const nextScheduledDeliveryAt =
          input.scheduledDeliveryAt === undefined
            ? orderRow.scheduledDeliveryAt
            : parseOptionalDate(input.scheduledDeliveryAt);
        const nextFulfillmentNotes = cleanOptionalText(
          input.fulfillmentNotes === undefined ? orderRow.fulfillmentNotes : input.fulfillmentNotes,
          1200,
        );

        if (requiresDispatchData(nextFulfillmentStatus) && !coalesceText(nextCourierName, nextTrackingNumber, nextDispatchReference)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Add courier name, tracking number, or dispatch reference before moving an order into transit.",
          });
        }
        if (requiresDispatchData(nextFulfillmentStatus) && !nextShippingAddress) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Add the delivery address before dispatching the order.",
          });
        }
        if (requiresDispatchData(nextFulfillmentStatus) && !coalesceText(nextRecipientPhone, orderRow.customerPhone)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Add the recipient phone before dispatching the order.",
          });
        }
        if (nextFulfillmentStatus === "delivered" && !coalesceText(nextRecipientName, orderRow.customerName)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Add the recipient name before marking the order delivered.",
          });
        }

        const statusChanged =
          normalizeOrderFulfillmentStatus(orderRow.fulfillmentStatus) !== nextFulfillmentStatus;
        const nextTimestamps = nextFulfillmentTimestamps({
          currentStatus: orderRow.fulfillmentStatus,
          nextStatus: nextFulfillmentStatus,
          now,
          existing: orderRow,
        });

        const [updatedOrder] = await tx
          .update(orders)
          .set({
            fulfillmentStatus: nextFulfillmentStatus,
            fulfillmentUpdatedAt: nextTimestamps.fulfillmentUpdatedAt ?? orderRow.fulfillmentUpdatedAt,
            recipientName: nextRecipientName,
            recipientPhone: nextRecipientPhone,
            shippingAddress: nextShippingAddress,
            deliveryArea: nextDeliveryArea,
            deliveryNotes: nextDeliveryNotes,
            courierName: nextCourierName,
            trackingNumber: nextTrackingNumber,
            trackingUrl: nextTrackingUrl,
            dispatchReference: nextDispatchReference,
            scheduledDeliveryAt: nextScheduledDeliveryAt,
            fulfillmentNotes: nextFulfillmentNotes,
            packedAt: nextTimestamps.packedAt,
            dispatchedAt: nextTimestamps.dispatchedAt,
            outForDeliveryAt: nextTimestamps.outForDeliveryAt,
            deliveredAt: nextTimestamps.deliveredAt,
            failedDeliveryAt: nextTimestamps.failedDeliveryAt,
            returnedAt: nextTimestamps.returnedAt,
            updatedAt: now,
          })
          .where(and(eq(orders.id, orderRow.id), eq(orders.updatedAt, orderRow.updatedAt)))
          .returning();

        if (!updatedOrder) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This order was updated by another staff member. Refresh and try again.",
          });
        }

        const shouldNotifyCustomer = Boolean(input.notifyCustomer) && statusChanged;
        let notification: {
          ok: boolean;
          error: string | null;
          recipientSource: string | null;
          whatsappIdentitySource: string | null;
          idempotencyKeys: string[];
        } = {
          ok: true,
          error: null as string | null,
          recipientSource: null as string | null,
          whatsappIdentitySource: null as string | null,
          idempotencyKeys: [] as string[],
        };
        const emailNotification: {
          ok: boolean;
          error: string | null;
          idempotencyKeys: string[];
        } = {
          ok: true,
          error: null as string | null,
          idempotencyKeys: [] as string[],
        };
        if (shouldNotifyCustomer) {
          const contactContext = await resolveOrderNotificationContext({
            businessId: ctx.businessId,
            customerId: updatedOrder.customerId ?? null,
            threadId: updatedOrder.threadId ?? null,
            whatsappIdentityId: updatedOrder.whatsappIdentityId ?? null,
            customerName: updatedOrder.customerName ?? null,
            customerEmail: updatedOrder.customerEmail ?? null,
            customerPhone: updatedOrder.customerPhone ?? null,
          });
          if (shouldNotifyCustomer) {
            notification = await enqueueWhatsAppOutboxMessages(tx, {
              businessId: ctx.businessId,
              entityType: "order",
              entityId: updatedOrder.id,
              customerId: updatedOrder.customerId ?? null,
              threadId: contactContext.threadId ?? null,
              whatsappIdentityId: contactContext.whatsappIdentityId ?? null,
              recipient: contactContext.approvalRecipient,
              recipientSource: contactContext.recipientSource,
              whatsappIdentitySource: contactContext.whatsappIdentitySource,
              source: "order_fulfillment_update",
              idempotencyBaseKey: `order:${updatedOrder.id}:fulfillment:${nextFulfillmentStatus}:${String(updatedOrder.updatedAt ?? now.toISOString())}`,
              messages: input.customerMessage?.trim()
                ? [{ type: "text", text: input.customerMessage.trim() }]
                : buildFulfillmentStatusMessages({
                    customerName: updatedOrder.customerName,
                    orderId: updatedOrder.id,
                    fulfillmentStatus: nextFulfillmentStatus,
                    courierName: nextCourierName,
                    trackingNumber: nextTrackingNumber,
                    trackingUrl: nextTrackingUrl,
                    scheduledDeliveryAt: nextScheduledDeliveryAt,
                    note: nextFulfillmentStatus === "failed_delivery" ? nextFulfillmentNotes : null,
                  }),
            });
          }
        }

        return {
          orderRow,
          updatedOrder,
          nextFulfillmentStatus,
          nextRecipientName,
          nextCourierName,
          nextTrackingNumber,
          nextDispatchReference,
          nextScheduledDeliveryAt,
          statusChanged,
          shouldNotifyCustomer,
          notification,
          emailNotification,
        };
      });

      await logOrderEvent({
        businessId: ctx.businessId,
        orderId: result.updatedOrder.id,
        eventType: result.statusChanged ? "fulfillment_status_changed" : "fulfillment_details_updated",
        actorType: "user",
        actorId: ctx.userId ?? ctx.firebaseUid ?? null,
        actorLabel: ctx.userEmail ?? "user",
        payload: {
          previousStatus: result.orderRow.fulfillmentStatus,
          nextStatus: result.nextFulfillmentStatus,
          courierName: result.nextCourierName,
          trackingNumber: result.nextTrackingNumber,
          dispatchReference: result.nextDispatchReference,
          scheduledDeliveryAt: result.nextScheduledDeliveryAt ? new Date(result.nextScheduledDeliveryAt).toISOString() : null,
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
      if (result.emailNotification.ok && result.emailNotification.idempotencyKeys.length) {
        await drainBusinessOutbox({
          businessId: ctx.businessId,
          idempotencyKeys: result.emailNotification.idempotencyKeys,
          limit: result.emailNotification.idempotencyKeys.length,
        });
      }
      await flushBusinessOutbox(ctx.businessId);
      if (result.shouldNotifyCustomer && !delivery.ok) {
        await logOrderEvent({
          businessId: ctx.businessId,
          orderId: result.updatedOrder.id,
          eventType: "fulfillment_notification_failed",
          actorType: "system",
          actorLabel: "bot",
          payload: {
            fulfillmentStatus: result.nextFulfillmentStatus,
            error: delivery.error,
          },
        });
      }

      await publishPortalEvent({
        businessId: ctx.businessId,
        entity: "order",
        op: "upsert",
        entityId: result.updatedOrder.id,
        payload: { order: result.updatedOrder as any },
        createdAt: result.updatedOrder.updatedAt ?? now,
      });

      recordBusinessEvent({
        event: "order.fulfillment_updated",
        action: "updateFulfillment",
        area: "order",
        businessId: ctx.businessId,
        entity: "order",
        entityId: result.updatedOrder.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: delivery.ok ? "success" : "degraded",
        status: result.nextFulfillmentStatus,
        attributes: {
          previous_status: result.orderRow.fulfillmentStatus,
          courier_name_present: Boolean(result.nextCourierName),
          tracking_number_present: Boolean(result.nextTrackingNumber),
          notify_customer: result.shouldNotifyCustomer,
          delivery_ok: delivery.ok,
        },
      });

      return { order: result.updatedOrder, delivery };
    }),

  captureManualPayment: businessProcedure
    .input(
      z.object({
        orderId: z.string().min(1),
        amount: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const settings = await getBusinessOrderSettings(ctx.businessId);
      if (!settings.ticketToOrderEnabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket-to-order flow is disabled for this business." });
      }
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        await lockWorkflowKey(tx, `${ctx.businessId}::order::${input.orderId}`);
        await enforceOrderOperationThrottle(tx, ctx, "captureManualPayment", input.orderId);

        const [orderRow] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
          .limit(1);
        if (!orderRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
        }
        if (!canCaptureManualPayment(orderRow)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only manual or cash-on-delivery orders awaiting collection can be marked as paid.",
          });
        }

        const paidAmount = resolveRefundAmount(input.amount, orderRow) ?? orderRow.expectedAmount?.toString() ?? null;
        const [updatedOrder] = await tx
          .update(orders)
          .set({
            status: "paid",
            paidAmount,
            paymentApprovedAt: now,
            updatedAt: now,
          })
          .where(eq(orders.id, orderRow.id))
          .returning();

        if (!updatedOrder) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to record manual payment." });
        }

        const contactContext = await resolveOrderNotificationContext({
          businessId: ctx.businessId,
          customerId: updatedOrder.customerId ?? null,
          threadId: updatedOrder.threadId ?? null,
          whatsappIdentityId: updatedOrder.whatsappIdentityId ?? null,
          customerName: updatedOrder.customerName ?? null,
          customerEmail: updatedOrder.customerEmail ?? null,
          customerPhone: updatedOrder.customerPhone ?? null,
        });
        const notification = await enqueueWhatsAppOutboxMessages(tx, {
          businessId: ctx.businessId,
          entityType: "order",
          entityId: updatedOrder.id,
          customerId: updatedOrder.customerId ?? null,
          threadId: contactContext.threadId ?? null,
          whatsappIdentityId: contactContext.whatsappIdentityId ?? null,
          recipient: contactContext.approvalRecipient,
          recipientSource: contactContext.recipientSource,
          whatsappIdentitySource: contactContext.whatsappIdentitySource,
          source: "order_manual_payment_collected",
          idempotencyBaseKey: `order:${updatedOrder.id}:manual_payment:${String(updatedOrder.paymentApprovedAt ?? now.toISOString())}`,
          messages: buildManualCollectionMessages({
            customerName: updatedOrder.customerName,
            orderId: updatedOrder.id,
            currency: String(updatedOrder.currency || "LKR").trim() || "LKR",
            paidAmount,
          }),
        });
        return { orderRow, updatedOrder, paidAmount, notification };
      });

      await logOrderEvent({
        businessId: ctx.businessId,
        orderId: result.updatedOrder.id,
        eventType: "manual_payment_collected",
        actorType: "user",
        actorId: ctx.userId ?? ctx.firebaseUid ?? null,
        actorLabel: ctx.userEmail ?? "user",
        payload: {
          amount: result.paidAmount,
          note: cleanOptionalText(input.note, 400),
          paymentMethod: result.updatedOrder.paymentMethod,
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
        await logOrderEvent({
          businessId: ctx.businessId,
          orderId: result.updatedOrder.id,
          eventType: "manual_payment_notification_failed",
          actorType: "system",
          actorLabel: "bot",
          payload: {
            error: delivery.error,
          },
        });
      }

      await publishPortalEvent({
        businessId: ctx.businessId,
        entity: "order",
        op: "upsert",
        entityId: result.updatedOrder.id,
        payload: { order: result.updatedOrder as any },
        createdAt: result.updatedOrder.updatedAt ?? now,
      });

      recordBusinessEvent({
        event: "order.manual_payment_collected",
        action: "captureManualPayment",
        area: "order",
        businessId: ctx.businessId,
        entity: "order",
        entityId: result.updatedOrder.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: delivery.ok ? "success" : "degraded",
        status: result.updatedOrder.status,
        attributes: {
          payment_method: result.updatedOrder.paymentMethod,
          delivery_ok: delivery.ok,
        },
      });

      return { order: result.updatedOrder, delivery };
    }),

  updateRefundStatus: businessProcedure
    .input(
      z.object({
        orderId: z.string().min(1),
        action: refundActionSchema,
        amount: z.string().optional(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const settings = await getBusinessOrderSettings(ctx.businessId);
      if (!settings.ticketToOrderEnabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket-to-order flow is disabled for this business." });
      }
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        await lockWorkflowKey(tx, `${ctx.businessId}::order::${input.orderId}`);
        await enforceOrderOperationThrottle(tx, ctx, "updateRefundStatus", input.orderId);

        const [orderRow] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
          .limit(1);
        if (!orderRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
        }

        const nextRefundAmount = resolveRefundAmount(input.amount, orderRow);
        const nextRefundReason = input.reason?.trim() || orderRow.refundReason || null;

        if (input.action === "mark_pending" && orderRow.status !== "paid") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only paid orders can be moved into refund pending." });
        }
        if (input.action === "mark_refunded" && !["paid", "refund_pending"].includes(String(orderRow.status || ""))) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only paid or refund-pending orders can be marked refunded." });
        }
        if (input.action === "cancel" && orderRow.status !== "refund_pending") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only refund-pending orders can cancel the refund flow." });
        }

        const nextStatus =
          input.action === "mark_pending"
            ? "refund_pending"
            : input.action === "mark_refunded"
              ? "refunded"
              : "paid";
        const eventType =
          input.action === "mark_pending"
            ? "refund_pending"
            : input.action === "mark_refunded"
              ? "refund_completed"
              : "refund_cancelled";

        const [updatedOrder] = await tx
          .update(orders)
          .set({
            status: nextStatus,
            refundAmount: input.action === "cancel" ? null : nextRefundAmount,
            refundReason: input.action === "cancel" ? null : nextRefundReason,
            refundRequestedAt:
              input.action === "mark_pending"
                ? now
                : input.action === "mark_refunded"
                  ? orderRow.refundRequestedAt ?? now
                  : null,
            refundedAt: input.action === "mark_refunded" ? now : null,
            updatedAt: now,
          })
          .where(eq(orders.id, orderRow.id))
          .returning();

        if (!updatedOrder) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to update refund status." });
        }

        const contactContext = await resolveOrderNotificationContext({
          businessId: ctx.businessId,
          customerId: updatedOrder.customerId ?? null,
          threadId: updatedOrder.threadId ?? null,
          whatsappIdentityId: updatedOrder.whatsappIdentityId ?? null,
          customerName: updatedOrder.customerName ?? null,
          customerEmail: updatedOrder.customerEmail ?? null,
          customerPhone: updatedOrder.customerPhone ?? null,
        });
        const notification = await enqueueWhatsAppOutboxMessages(tx, {
          businessId: ctx.businessId,
          entityType: "order",
          entityId: updatedOrder.id,
          customerId: updatedOrder.customerId ?? null,
          threadId: contactContext.threadId ?? null,
          whatsappIdentityId: contactContext.whatsappIdentityId ?? null,
          recipient: contactContext.approvalRecipient,
          recipientSource: contactContext.recipientSource,
          whatsappIdentitySource: contactContext.whatsappIdentitySource,
          source:
            input.action === "mark_pending"
              ? "order_refund_pending"
              : input.action === "mark_refunded"
                ? "order_refund_completed"
                : "order_refund_cancelled",
          idempotencyBaseKey: `order:${updatedOrder.id}:refund:${input.action}:${String(updatedOrder.updatedAt ?? now.toISOString())}`,
          messages: buildRefundStatusMessages({
            action: input.action,
            orderId: updatedOrder.id,
            paymentReference: updatedOrder.paymentReference,
            refundAmount: input.action === "cancel" ? null : nextRefundAmount,
            currency: String(updatedOrder.currency || "LKR").trim() || "LKR",
            reason: input.action === "cancel" ? null : nextRefundReason,
          }),
        });
        return { orderRow, updatedOrder, nextRefundAmount, nextRefundReason, nextStatus, eventType, notification };
      });

      await logOrderEvent({
        businessId: ctx.businessId,
        orderId: result.updatedOrder.id,
        eventType: result.eventType,
        actorType: "user",
        actorId: ctx.userId ?? ctx.firebaseUid ?? null,
        actorLabel: ctx.userEmail ?? "user",
        payload: {
          reason: input.action === "cancel" ? null : result.nextRefundReason,
          refundAmount: input.action === "cancel" ? null : result.nextRefundAmount,
          previousStatus: result.orderRow.status,
          nextStatus: result.nextStatus,
        },
      });

      await publishPortalEvent({
        businessId: ctx.businessId,
        entity: "order",
        op: "upsert",
        entityId: result.updatedOrder.id,
        payload: { order: result.updatedOrder as any },
        createdAt: result.updatedOrder.updatedAt ?? result.updatedOrder.createdAt ?? now,
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
        await logOrderEvent({
          businessId: ctx.businessId,
          orderId: result.updatedOrder.id,
          eventType: "refund_notification_failed",
          actorType: "system",
          actorLabel: "bot",
          payload: {
            action: input.action,
            error: delivery.error,
          },
        });
      }

      recordBusinessEvent({
        event: "order.refund_status_updated",
        action: "updateRefundStatus",
        area: "order",
        businessId: ctx.businessId,
        entity: "order",
        entityId: result.updatedOrder.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: delivery.ok ? "success" : "degraded",
        status: result.nextStatus,
        attributes: {
          previous_status: result.orderRow.status,
          refund_action: input.action,
          refund_amount: input.action === "cancel" ? null : result.nextRefundAmount,
          delivery_ok: delivery.ok,
          delivery_phone_source: delivery.recipientSource,
          delivery_identity_source: delivery.whatsappIdentitySource,
        },
      });

      return { order: result.updatedOrder, delivery };
    }),
});
