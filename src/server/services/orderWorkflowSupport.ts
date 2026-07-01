/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { normalizeOrderFlowSettings } from "@/lib/order-settings";
import { buildPrivateBlobReadUrl } from "@/lib/storage";
import {
  normalizeOrderFulfillmentStatus,
} from "@/lib/order-operations";
import { assertOperationThrottle, getStaffActorKey } from "@/server/operationalHardening";
import { getBusinessOrderSettingsRecord } from "@/server/services/businessSettingsStore";
import { drainBusinessOutbox } from "@/server/services/messageOutbox";
import { db } from "@/server/db/client";
import {
  businesses,
  channelIdentities,
  orderPayments,
  orders,
  threadMessages,
  whatsappIdentityDetails,
} from "../../../drizzle/schema";
import { missingRequiredOrderDeliveryFields } from "@/server/services/orderFlow";

export * from "./orderBaseSupport";
export * from "./orderNotificationSupport";
export * from "./orderQueryUtils";
export * from "./orderFulfillmentUtils";

import { cleanOptionalText } from "./orderBaseSupport";

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

export const PAYMENT_PENDING_WORKSPACE_STATUSES = [
  "pending_approval",
  "edit_required",
  "approved",
  "awaiting_payment",
  "payment_submitted",
] as const;

export const PAYMENT_ALL_WORKSPACE_STATUSES = [
  ...PAYMENT_PENDING_WORKSPACE_STATUSES,
  "payment_rejected",
  "denied",
  "paid",
  "refund_pending",
  "refunded",
] as const;

const PAYMENT_SETUP_EDITABLE_ORDER_STATUSES = new Set([
  "approved",
  "awaiting_payment",
  "payment_rejected",
]);

export function canResendPaymentDetails(orderRow: {
  paymentMethod?: string | null;
  status?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  shippingAddress?: string | null;
}): boolean {
  const method = String(orderRow.paymentMethod || "").trim().toLowerCase();
  const status = String(orderRow.status || "").trim().toLowerCase();
  if (method !== "bank_qr") return false;
  if (["awaiting_payment", "payment_submitted", "payment_rejected"].includes(status)) return true;
  if (status !== "approved") return false;
  return missingRequiredOrderDeliveryFields({
    recipientName: orderRow.recipientName,
    recipientPhone: orderRow.recipientPhone,
    shippingAddress: orderRow.shippingAddress,
  }).length === 0;
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
  return getBusinessOrderSettingsRecord(businessId, biz?.settings);
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

function readStoredBlobPath(value: unknown): string | null {
  const storage = (value as any)?.storage;
  const blobPath = String(storage?.blobPath || "").trim();
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
  const snapshot = orderRow.paymentConfigSnapshot as any || {};
  return normalizeOrderFlowSettings({
    orderFlow: {
      ticketToOrderEnabled: true,
      paymentMethod: snapshot.paymentMethod ?? orderRow.paymentMethod ?? "manual",
      currency: snapshot.currency ?? orderRow.currency ?? "LKR",
      bankQr: snapshot.bankQr || {},
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

export async function hydrateOrderRows(businessId: string, orderRows: Array<typeof orders.$inferSelect>) {
  const orderIds = orderRows.map((row) => row.id);
  const threadIds = [...new Set(orderRows.map((row) => String(row.threadId || "").trim()).filter(Boolean))];
  const identityIds = [...new Set(orderRows.map((row) => String(row.channelIdentityId || "").trim()).filter(Boolean))];

  const [paymentRows, latestInboundRows, identityRows] = await Promise.all([
    orderIds.length
      ? db
          .select()
          .from(orderPayments)
          .where(and(eq(orderPayments.businessId, businessId), inArray(orderPayments.orderId, orderIds)))
          .orderBy(desc(orderPayments.createdAt))
      : Promise.resolve([]),
    threadIds.length
      ? db
          .select({
            threadId: threadMessages.threadId,
            createdAt: sql<Date>`max(${threadMessages.createdAt})`,
          })
          .from(threadMessages)
          .where(and(inArray(threadMessages.threadId, threadIds), eq(threadMessages.direction, "inbound")))
          .groupBy(threadMessages.threadId)
      : Promise.resolve([]),
    identityIds.length
      ? db
          .select({
            channelIdentityId: channelIdentities.id,
            phoneNumberId: whatsappIdentityDetails.phoneNumberId,
            displayPhoneNumber: whatsappIdentityDetails.displayPhoneNumber,
          })
          .from(channelIdentities)
          .innerJoin(whatsappIdentityDetails, eq(channelIdentities.id, whatsappIdentityDetails.channelIdentityId))
          .where(inArray(channelIdentities.id, identityIds))
      : Promise.resolve([]),
  ]);

  const latestPaymentByOrder = new Map<string, (typeof paymentRows)[number]>();
  for (const payment of paymentRows) {
    if (!latestPaymentByOrder.has(payment.orderId)) {
      latestPaymentByOrder.set(payment.orderId, payment);
    }
  }

  const latestInboundByThread = new Map<string, Date | string | null>();
  for (const row of latestInboundRows) {
    if (!latestInboundByThread.has(row.threadId)) {
      latestInboundByThread.set(row.threadId, row.createdAt);
    }
  }

  const displayPhoneByIdentity = new Map(identityRows.map((row) => [row.channelIdentityId, row.displayPhoneNumber ?? null]));

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
      botDisplayPhoneNumber: row.channelIdentityId ? displayPhoneByIdentity.get(row.channelIdentityId) ?? null : null,
      ...windowState,
    };
  });
}

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
