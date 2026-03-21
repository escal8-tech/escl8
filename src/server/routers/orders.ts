/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { normalizeOrderFlowSettings } from "@/lib/order-settings";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import { db } from "../db/client";
import { businessProcedure, router } from "../trpc";
import { businesses, orderEvents, orderPayments, orders } from "../../../drizzle/schema";
import { logOrderEvent } from "../services/orderFlow";

const reviewActionSchema = z.enum(["approve", "reject"]);
const refundActionSchema = z.enum(["mark_pending", "mark_refunded", "cancel"]);

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
        .orderBy(desc(orders.createdAt))
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

      return {
        settings,
        items: orderRows.map((row) => {
          const latestPayment = latestPaymentByOrder.get(row.id) ?? null;
          return {
            ...row,
            latestPayment,
          };
        }),
      };
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

      const [paymentRow] = await db
        .select()
        .from(orderPayments)
        .where(and(eq(orderPayments.businessId, ctx.businessId), eq(orderPayments.id, input.paymentId)))
        .limit(1);
      if (!paymentRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order payment not found." });
      }

      const [orderRow] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, paymentRow.orderId)))
        .limit(1);
      if (!orderRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
      }

      const now = new Date();
      const nextPaymentStatus = input.action === "approve" ? "approved_manual" : "rejected";
      const nextOrderStatus = input.action === "approve" ? "paid" : "payment_rejected";

      const [updatedPayment] = await db
        .update(orderPayments)
        .set({
          status: nextPaymentStatus,
          aiCheckNotes: input.notes?.trim() || paymentRow.aiCheckNotes,
          updatedAt: now,
        })
        .where(eq(orderPayments.id, paymentRow.id))
        .returning();

      const [updatedOrder] = await db
        .update(orders)
        .set({
          status: nextOrderStatus,
          paidAmount: paymentRow.paidAmount ?? orderRow.paidAmount,
          paymentApprovedAt: input.action === "approve" ? now : orderRow.paymentApprovedAt,
          paymentRejectedAt: input.action === "reject" ? now : orderRow.paymentRejectedAt,
          updatedAt: now,
        })
        .where(eq(orders.id, orderRow.id))
        .returning();

      if (updatedOrder) {
        await logOrderEvent({
          businessId: ctx.businessId,
          orderId: updatedOrder.id,
          eventType: input.action === "approve" ? "payment_approved" : "payment_rejected",
          actorType: "user",
          actorId: ctx.userId ?? ctx.firebaseUid ?? null,
          actorLabel: ctx.userEmail ?? "user",
          payload: {
            notes: input.notes?.trim() || null,
            paymentId: paymentRow.id,
            paymentStatus: nextPaymentStatus,
          },
        });

        await publishPortalEvent({
          businessId: ctx.businessId,
          entity: "order",
          op: "upsert",
          entityId: updatedOrder.id,
          payload: {
            order: {
              ...updatedOrder,
              latestPayment: updatedPayment ?? paymentRow,
            } as any,
          },
          createdAt: updatedOrder.updatedAt ?? updatedOrder.createdAt ?? now,
        });

        recordBusinessEvent({
          event: "order.payment_reviewed",
          action: "reviewPayment",
          area: "order",
          businessId: ctx.businessId,
          entity: "order_payment",
          entityId: paymentRow.id,
          userId: ctx.userId,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
          actorType: "user",
          outcome: "success",
          status: nextPaymentStatus,
          attributes: {
            action: input.action,
            order_id: updatedOrder.id,
          },
        });
      }

      return {
        order: updatedOrder ?? null,
        payment: updatedPayment ?? null,
      };
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

      const [orderRow] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
        .limit(1);
      if (!orderRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
      }

      const now = new Date();
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

      const [updatedOrder] = await db
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

      await logOrderEvent({
        businessId: ctx.businessId,
        orderId: updatedOrder.id,
        eventType,
        actorType: "user",
        actorId: ctx.userId ?? ctx.firebaseUid ?? null,
        actorLabel: ctx.userEmail ?? "user",
        payload: {
          reason: input.action === "cancel" ? null : nextRefundReason,
          refundAmount: input.action === "cancel" ? null : nextRefundAmount,
          previousStatus: orderRow.status,
          nextStatus,
        },
      });

      await publishPortalEvent({
        businessId: ctx.businessId,
        entity: "order",
        op: "upsert",
        entityId: updatedOrder.id,
        payload: { order: updatedOrder as any },
        createdAt: updatedOrder.updatedAt ?? updatedOrder.createdAt ?? now,
      });

      recordBusinessEvent({
        event: "order.refund_status_updated",
        action: "updateRefundStatus",
        area: "order",
        businessId: ctx.businessId,
        entity: "order",
        entityId: updatedOrder.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: "success",
        status: nextStatus,
        attributes: {
          previous_status: orderRow.status,
          refund_action: input.action,
          refund_amount: input.action === "cancel" ? null : nextRefundAmount,
        },
      });

      return { order: updatedOrder };
    }),
});
