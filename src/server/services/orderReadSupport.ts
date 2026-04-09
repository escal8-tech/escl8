import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { orderEvents, orderPayments, orders, threadMessages, whatsappIdentities } from "@/../drizzle/schema";
import {
  ORDER_WORKSPACE_MODES,
  buildWorkspaceConditions,
  getBusinessOrderSettings,
  hydrateOrderRows,
  refreshOrderPaymentProofUrl,
  resolveOrderLedgerAmount,
  whatsappWindowState,
} from "@/server/services/orderWorkflowSupport";

export async function listOrdersForBusiness(args: {
  businessId: string;
  limit?: number;
  status?: string;
}) {
  const settings = await getBusinessOrderSettings(args.businessId);
  const filters = [eq(orders.businessId, args.businessId)];
  if (args.status) filters.push(eq(orders.status, args.status));

  const orderRows = await db
    .select()
    .from(orders)
    .where(and(...filters))
    .orderBy(desc(orders.updatedAt), desc(orders.createdAt))
    .limit(args.limit ?? 200);

  const orderIds = orderRows.map((row) => row.id);
  const paymentRows = orderIds.length
    ? await db
        .select()
        .from(orderPayments)
        .where(and(eq(orderPayments.businessId, args.businessId), inArray(orderPayments.orderId, orderIds)))
        .orderBy(desc(orderPayments.createdAt))
    : [];

  const latestPaymentByOrder = new Map<string, (typeof paymentRows)[number]>();
  for (const payment of paymentRows) {
    if (!latestPaymentByOrder.has(payment.orderId)) latestPaymentByOrder.set(payment.orderId, payment);
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
    if (!latestInboundByThread.has(row.threadId)) latestInboundByThread.set(row.threadId, row.createdAt);
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
}

export async function listOrdersPageForBusiness(args: {
  businessId: string;
  limit: number;
  offset: number;
  search?: string;
  mode: (typeof ORDER_WORKSPACE_MODES)[number];
  queueFilter: "all" | "pending" | "approved" | "denied" | "out_for_delivery" | "completed" | "realized" | "unrealized";
  dateField: "updatedAt" | "createdAt";
  rangeDays: number;
  methodFilter: "all" | "manual" | "bank_qr" | "cod";
}) {
  const settings = await getBusinessOrderSettings(args.businessId);
  const { conditions } = buildWorkspaceConditions(args);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(...conditions));

  const orderRows = await db
    .select()
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.updatedAt), desc(orders.createdAt))
    .limit(args.limit)
    .offset(args.offset);

  return {
    settings,
    totalCount: countRow?.count ?? 0,
    items: await hydrateOrderRows(args.businessId, orderRows),
  };
}

export async function getOrderWorkspaceOverviewForBusiness(args: {
  businessId: string;
  mode: (typeof ORDER_WORKSPACE_MODES)[number];
  queueFilter: "all" | "pending" | "approved" | "denied" | "out_for_delivery" | "completed" | "realized" | "unrealized";
  dateField: "updatedAt" | "createdAt";
  rangeDays: number;
  methodFilter: "all" | "manual" | "bank_qr" | "cod";
}) {
  const settings = await getBusinessOrderSettings(args.businessId);
  const { conditions, statusExpr, fulfillmentBucket } = buildWorkspaceConditions(args);
  const amountExpr = sql<number>`coalesce(${orders.paidAmount}, ${orders.refundAmount}, ${orders.expectedAmount}, 0)::numeric`;
  const paidExpr = sql<number>`coalesce(${orders.paidAmount}, ${orders.expectedAmount}, 0)::numeric`;
  const refundExpr = sql<number>`coalesce(${orders.refundAmount}, ${orders.paidAmount}, ${orders.expectedAmount}, 0)::numeric`;

  const [aggregateRow] = await db
    .select({
      scopedCount: sql<number>`count(*)::int`,
      paymentPendingCount: sql<number>`count(*) filter (where ${statusExpr} in ('pending_approval', 'edit_required', 'approved', 'awaiting_payment', 'payment_submitted'))::int`,
      paymentApprovedCount: sql<number>`count(*) filter (where ${statusExpr} in ('paid', 'refund_pending', 'refunded'))::int`,
      paymentDeniedCount: sql<number>`count(*) filter (where ${statusExpr} in ('payment_rejected', 'denied'))::int`,
      paymentReviewCount: sql<number>`count(*) filter (where ${statusExpr} = 'payment_submitted')::int`,
      orderPendingCount: sql<number>`count(*) filter (where ${statusExpr} in ('paid', 'refund_pending', 'refunded') and ${fulfillmentBucket} = 'pending')::int`,
      orderOutForDeliveryCount: sql<number>`count(*) filter (where ${statusExpr} in ('paid', 'refund_pending', 'refunded') and ${fulfillmentBucket} = 'out_for_delivery')::int`,
      orderCompletedCount: sql<number>`count(*) filter (where ${statusExpr} in ('paid', 'refund_pending', 'refunded') and ${fulfillmentBucket} = 'completed')::int`,
      booked: sql<number>`coalesce(sum(${amountExpr}), 0)::float`,
      collected: sql<number>`coalesce(sum(case when ${statusExpr} in ('paid', 'refund_pending', 'refunded') then ${paidExpr} else 0 end), 0)::float`,
      pending: sql<number>`coalesce(sum(case when ${statusExpr} not in ('paid', 'refunded', 'refund_pending') then ${amountExpr} else 0 end), 0)::float`,
      refundExposure: sql<number>`coalesce(sum(case when ${statusExpr} in ('refunded', 'refund_pending') then ${refundExpr} else 0 end), 0)::float`,
    })
    .from(orders)
    .where(and(...conditions));

  return {
    settings,
    scopedCount: Number(aggregateRow?.scopedCount ?? 0),
    metrics: {
      paymentPending: Number(aggregateRow?.paymentPendingCount ?? 0),
      paymentApproved: Number(aggregateRow?.paymentApprovedCount ?? 0),
      paymentDenied: Number(aggregateRow?.paymentDeniedCount ?? 0),
      paymentReview: Number(aggregateRow?.paymentReviewCount ?? 0),
      orderPending: Number(aggregateRow?.orderPendingCount ?? 0),
      orderOutForDelivery: Number(aggregateRow?.orderOutForDeliveryCount ?? 0),
      orderCompleted: Number(aggregateRow?.orderCompletedCount ?? 0),
    },
    financeTotals: {
      booked: Number(aggregateRow?.booked ?? 0),
      collected: Number(aggregateRow?.collected ?? 0),
      pending: Number(aggregateRow?.pending ?? 0),
      refundExposure: Number(aggregateRow?.refundExposure ?? 0),
    },
    trendData: [],
    mixData: [],
  };
}

export async function getOrderByIdForBusiness(args: { businessId: string; orderId: string }) {
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.businessId, args.businessId), eq(orders.id, args.orderId)))
    .limit(1);
  if (!rows.length) return null;
  const [hydrated] = await hydrateOrderRows(args.businessId, rows);
  return hydrated ?? null;
}

export async function getOrderStatsForBusiness(businessId: string) {
  const settings = await getBusinessOrderSettings(businessId);
  const rows = await db.select().from(orders).where(eq(orders.businessId, businessId));
  const orderIds = rows.map((row) => row.id);
  const payments = orderIds.length
    ? await db
        .select()
        .from(orderPayments)
        .where(and(eq(orderPayments.businessId, businessId), inArray(orderPayments.orderId, orderIds)))
        .orderBy(desc(orderPayments.createdAt))
    : [];

  const latestPaymentByOrder = new Map<string, (typeof payments)[number]>();
  for (const payment of payments) {
    if (!latestPaymentByOrder.has(payment.orderId)) latestPaymentByOrder.set(payment.orderId, payment);
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
    if (row.status === "awaiting_payment" || row.status === "edit_required") pendingPaymentCount += 1;
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
}

export async function listOrderPaymentsForBusiness(args: { businessId: string; orderId: string }) {
  const rows = await db
    .select()
    .from(orderPayments)
    .where(and(eq(orderPayments.businessId, args.businessId), eq(orderPayments.orderId, args.orderId)))
    .orderBy(desc(orderPayments.createdAt));
  return rows.map((row) => ({
    ...row,
    proofUrl: refreshOrderPaymentProofUrl(row),
  }));
}

export async function listOrderEventsForBusiness(args: { businessId: string; orderId: string }) {
  return db
    .select()
    .from(orderEvents)
    .where(and(eq(orderEvents.businessId, args.businessId), eq(orderEvents.orderId, args.orderId)))
    .orderBy(desc(orderEvents.createdAt));
}
