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
    let approvedAmount = 0;

    for (const row of rows) {
      const latestPayment = latestPaymentByOrder.get(row.id);
      if (row.status === "awaiting_payment") pendingPaymentCount += 1;
      if (row.status === "payment_submitted") paymentSubmittedCount += 1;
      if (row.status === "paid") {
        paidCount += 1;
        approvedAmount += Number(row.paidAmount ?? latestPayment?.paidAmount ?? row.expectedAmount ?? 0);
      }
    }

    return {
      settings,
      totalOrders: rows.length,
      pendingPaymentCount,
      paymentSubmittedCount,
      paidCount,
      approvedAmount: approvedAmount.toFixed(2),
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
});
