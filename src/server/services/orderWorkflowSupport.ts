/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { normalizeOrderFlowSettings } from "@/lib/order-settings";
import { buildPrivateBlobReadUrl } from "@/lib/storage";
import {
  normalizeOrderFulfillmentStatus,
  type OrderFulfillmentStatus,
} from "@/lib/order-operations";
import { assertOperationThrottle, getStaffActorKey } from "@/server/operationalHardening";
import { drainBusinessOutbox } from "@/server/services/messageOutbox";
import { db } from "@/server/db/client";
import {
  businesses,
  customers,
  messageThreads,
  orderPayments,
  orders,
  threadMessages,
  whatsappIdentities,
} from "../../../drizzle/schema";
import { type BotSendMessage } from "@/server/services/botApi";
import type { OrderEmailMessage } from "@/server/services/orderFlow";
import { sanitizePhoneDigits } from "@/server/services/orderFlow";

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

export const ORDER_WORKSPACE_MODES = ["payments", "status", "revenue"] as const;
export type OrderWorkspaceMode = (typeof ORDER_WORKSPACE_MODES)[number];
export type OrderAnalyticsDateField = "updatedAt" | "createdAt";
export type OrderAnalyticsMethodFilter = "all" | "manual" | "bank_qr" | "cod";
export type PaymentQueueFilter = "all" | "pending" | "approved" | "denied";
export type OrderStatusQueueFilter = "all" | "pending" | "out_for_delivery" | "completed";
export type RevenueQueueFilter = "all" | "realized" | "unrealized";
export type OrderWorkspaceFilter = PaymentQueueFilter | OrderStatusQueueFilter | RevenueQueueFilter;

const PAYMENT_SETUP_EDITABLE_ORDER_STATUSES = new Set([
  "approved",
  "awaiting_payment",
  "payment_rejected",
]);
const FULFILLMENT_MUTABLE_ORDER_STATUSES = new Set(["paid", "refund_pending", "refunded"]);

export function canResendPaymentDetails(orderRow: {
  paymentMethod?: string | null;
  status?: string | null;
}): boolean {
  const method = String(orderRow.paymentMethod || "").trim().toLowerCase();
  const status = String(orderRow.status || "").trim().toLowerCase();
  return method === "bank_qr" && ["awaiting_payment", "payment_submitted", "payment_rejected"].includes(status);
}

export function canReopenPaidOrderForPaymentReview(orderRow: {
  status?: string | null;
  fulfillmentStatus?: string | null;
}): boolean {
  const status = String(orderRow.status || "").trim().toLowerCase();
  if (status !== "paid") return false;
  const fulfillment = normalizeOrderFulfillmentStatus(orderRow.fulfillmentStatus);
  return !["dispatched", "out_for_delivery", "delivered", "failed_delivery", "returned"].includes(fulfillment);
}

export function resolveOrderLedgerAmount(
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

export function resolveRefundAmount(
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

export async function getBusinessOrderSettings(businessId: string) {
  const [biz] = await db
    .select({ settings: businesses.settings })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  return normalizeOrderFlowSettings(biz?.settings);
}

export function cleanOptionalText(value: string | null | undefined, max = 500): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

export function cleanOptionalUrl(value: string | null | undefined): string | null {
  const normalized = cleanOptionalText(value, 1000);
  if (!normalized) return null;
  return /^https?:\/\//i.test(normalized) ? normalized : null;
}

export function parseOptionalDate(value: string | null | undefined): Date | null {
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

export function nextFulfillmentTimestamps(input: {
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

export function requiresDispatchData(status: OrderFulfillmentStatus): boolean {
  return status === "dispatched" || status === "out_for_delivery";
}

export function canCaptureManualPayment(orderRow: {
  paymentMethod?: string | null;
  status?: string | null;
}): boolean {
  const status = String(orderRow.status || "").trim().toLowerCase();
  return ["approved", "awaiting_payment", "payment_rejected"].includes(status);
}

export function assertPaymentSetupEditable(orderRow: {
  status?: string | null;
}) {
  const status = String(orderRow.status || "").trim().toLowerCase();
  if (PAYMENT_SETUP_EDITABLE_ORDER_STATUSES.has(status)) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "Payment details can only be edited before the payment is approved.",
  });
}

export function assertOrderAllowsFulfillmentUpdates(orderRow: {
  status?: string | null;
}) {
  const status = String(orderRow.status || "").trim().toLowerCase();
  if (FULFILLMENT_MUTABLE_ORDER_STATUSES.has(status)) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "Only paid or refund-tracked orders can be updated in order status.",
  });
}

export function assertPaymentReviewAllowed(params: {
  orderRow: {
    paymentMethod?: string | null;
  };
  paymentRow: {
    aiCheckStatus?: string | null;
  };
  action: "approve" | "reject";
}) {
  void params;
}

export function coalesceText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return null;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readStoredBlobPath(value: unknown): string | null {
  const storage = asRecord(asRecord(value).storage);
  const blobPath = String(storage.blobPath || "").trim();
  return blobPath || null;
}

export function refreshOrderPaymentProofUrl(paymentRow: typeof orderPayments.$inferSelect | null | undefined): string | null {
  if (!paymentRow) return null;
  const blobPath = readStoredBlobPath(paymentRow.details);
  return buildPrivateBlobReadUrl(blobPath || "", 24 * 30) || cleanOptionalText(paymentRow.proofUrl, 2000);
}

export function refreshOrderInvoiceUrl(orderRow: typeof orders.$inferSelect | null | undefined): string | null {
  if (!orderRow) return null;
  return buildPrivateBlobReadUrl(String(orderRow.invoiceStoragePath || "").trim(), 24 * 30)
    || cleanOptionalText(orderRow.invoiceUrl, 2000);
}

export function buildStoredOrderFlowSettings(orderRow: {
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

export function whatsappWindowState(lastInboundAt: Date | string | null | undefined) {
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

export function buildOrderBaseConditions(params: {
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

export async function hydrateOrderRows(businessId: string, orderRows: Array<typeof orders.$inferSelect>) {
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
      invoiceUrl: refreshOrderInvoiceUrl(row),
      latestPayment: latestPayment
        ? {
            ...latestPayment,
            proofUrl: refreshOrderPaymentProofUrl(latestPayment),
          }
        : null,
      botDisplayPhoneNumber: row.whatsappIdentityId ? displayPhoneByIdentity.get(row.whatsappIdentityId) ?? null : null,
      ...windowState,
    };
  });
}

function simpleFulfillmentBucketExpr() {
  return sql<string>`case
    when lower(coalesce(${orders.fulfillmentStatus}, '')) = 'delivered' then 'completed'
    when lower(coalesce(${orders.fulfillmentStatus}, '')) in ('dispatched', 'out_for_delivery') then 'out_for_delivery'
    else 'pending'
  end`;
}

export function buildWorkspaceConditions(params: {
  businessId: string;
  mode: OrderWorkspaceMode;
  queueFilter: OrderWorkspaceFilter;
  methodFilter?: OrderAnalyticsMethodFilter;
  dateField?: OrderAnalyticsDateField;
  rangeDays?: number;
  search?: string;
}) {
  const statusExpr = sql<string>`lower(coalesce(${orders.status}, ''))`;
  const fulfillmentBucket = simpleFulfillmentBucketExpr();
  const conditions = buildOrderBaseConditions({
    businessId: params.businessId,
    methodFilter: params.methodFilter,
    dateField: params.dateField,
    rangeDays: params.rangeDays,
    search: params.search,
  });

  if (params.mode === "payments") {
    if (params.queueFilter === "pending") {
      conditions.push(sql<boolean>`${statusExpr} in ('approved', 'awaiting_payment', 'payment_submitted')`);
    } else if (params.queueFilter === "approved") {
      conditions.push(sql<boolean>`${statusExpr} in ('paid', 'refund_pending', 'refunded')`);
    } else if (params.queueFilter === "denied") {
      conditions.push(sql<boolean>`${statusExpr} in ('payment_rejected', 'denied')`);
    } else {
      conditions.push(
        sql<boolean>`${statusExpr} in ('approved', 'awaiting_payment', 'payment_submitted', 'payment_rejected', 'denied', 'paid', 'refund_pending', 'refunded')`,
      );
    }
  } else if (params.mode === "status") {
    conditions.push(sql<boolean>`${statusExpr} in ('paid', 'refund_pending', 'refunded')`);
    if (params.queueFilter === "pending") {
      conditions.push(sql<boolean>`${fulfillmentBucket} = 'pending'`);
    } else if (params.queueFilter === "out_for_delivery") {
      conditions.push(sql<boolean>`${fulfillmentBucket} = 'out_for_delivery'`);
    } else if (params.queueFilter === "completed") {
      conditions.push(sql<boolean>`${fulfillmentBucket} = 'completed'`);
    }
  } else {
    if (params.queueFilter === "realized") {
      conditions.push(sql<boolean>`${statusExpr} in ('paid', 'refund_pending', 'refunded')`);
    } else if (params.queueFilter === "unrealized") {
      conditions.push(sql<boolean>`false`);
    } else {
      conditions.push(sql<boolean>`${statusExpr} in ('paid', 'refund_pending', 'refunded')`);
    }
  }

  return { conditions, statusExpr, fulfillmentBucket };
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

export async function lockWorkflowKey(tx: any, key: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}

export async function flushBusinessOutbox(businessId: string) {
  await drainBusinessOutbox({ businessId, limit: 25 });
}

export async function enforceOrderOperationThrottle(
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

export async function resolveOrderNotificationContext(params: {
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

export function buildPaymentReviewMessages(input: {
  action: "approve" | "reject";
  orderId: string;
  paymentReference?: string | null;
  paidAmount?: string | number | null;
  currency: string;
  notes?: string | null;
  invoiceUrl?: string | null;
}): BotSendMessage[] {
  const ref = String(input.paymentReference || input.orderId.slice(0, 8).toUpperCase()).trim();
  if (input.action === "approve") {
    const lines = [
      `We have approved your payment for order number ${ref}.`,
      input.paidAmount ? `Amount received: ${input.currency} ${String(input.paidAmount).trim()}.` : null,
      "Your order is now marked as paid and our team will continue processing it.",
    ].filter(Boolean);
    const messages: BotSendMessage[] = [{ type: "text", text: lines.join("\n") }];
    if (String(input.invoiceUrl || "").trim()) {
      messages.push({
        type: "document",
        documentUrl: String(input.invoiceUrl).trim(),
        filename: `invoice-${ref}.pdf`,
        caption: `Invoice for order ${ref}`,
      });
    }
    return messages;
  }
  const lines = [
    `We could not confirm the payment for order number ${ref}, so this order has now been closed.`,
    input.notes ? `Reason: ${String(input.notes).trim()}.` : null,
    "If you still want this item, please message us again and we can start a fresh order.",
  ].filter(Boolean);
  return [{ type: "text", text: lines.join("\n") }];
}

export function buildPaymentReviewEmail(input: {
  action: "approve" | "reject";
  orderId: string;
  paymentReference?: string | null;
  paidAmount?: string | number | null;
  currency: string;
  notes?: string | null;
  invoiceUrl?: string | null;
}): OrderEmailMessage {
  const ref = String(input.paymentReference || input.orderId.slice(0, 8).toUpperCase()).trim();
  const approved = input.action === "approve";
  const subject = approved ? `Order confirmed: ${ref}` : `Payment needs attention: ${ref}`;
  const lines = approved
    ? [
        `We have approved your payment for order number ${ref}.`,
        input.paidAmount ? `Amount received: ${input.currency} ${String(input.paidAmount).trim()}.` : null,
        "Your order is now confirmed and queued for fulfilment.",
        input.invoiceUrl ? `Invoice link: ${input.invoiceUrl}` : null,
      ]
    : [
        `We could not confirm the payment for order number ${ref}, so this order has now been closed.`,
        input.notes ? `Reason: ${String(input.notes).trim()}.` : null,
        "If you still want this item, reply again and we can start a fresh order.",
      ];
  const text = lines.filter(Boolean).join("\n");
  return {
    subject,
    text,
    html: `<div style="font-family:Montserrat,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#0b1220;color:#e5edf6"><div style="border:1px solid #21324a;border-radius:18px;padding:24px;background:#122038"><div style="font-size:24px;font-weight:700;margin:0 0 12px">${subject}</div><pre style="margin:0;white-space:pre-wrap;font:14px/1.7 inherit;color:#f6fbff">${text}</pre></div></div>`,
  };
}

export function buildRefundStatusMessages(input: {
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
      `We have started reviewing your refund for order number ${ref}.`,
      input.reason ? `Reason noted: ${input.reason}.` : null,
      "We will update you again as soon as the refund is processed.",
    ].filter(Boolean);
    return [{ type: "text", text: lines.join("\n") }];
  }
  if (input.action === "mark_refunded") {
    const lines = [
      `Your refund for order number ${ref} has been completed.`,
      input.refundAmount ? `Refunded amount: ${input.currency} ${input.refundAmount}.` : null,
    ].filter(Boolean);
    return [{ type: "text", text: lines.join("\n") }];
  }
  return [{ type: "text", text: `Your refund request for order number ${ref} has been cancelled, and the order remains paid.` }];
}
