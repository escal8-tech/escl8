/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  ORDER_FULFILLMENT_STATUSES,
  normalizeOrderFulfillmentStatus,
} from "@/lib/order-operations";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import { drainBusinessOutbox, enqueueEmailOutboxMessages, enqueueWhatsAppOutboxMessages } from "@/server/services/messageOutbox";
import {
  buildOrderInvoiceEmailMessage,
  createOrderInvoiceForOrder,
  markOrderInvoiceDelivered,
} from "@/server/services/orderInvoice";
import { db } from "../db/client";
import { businessProcedure, router } from "../trpc";
import { customers, orderPayments, orders, supportTickets } from "../../../drizzle/schema";
import {
  logOrderEvent,
} from "../services/orderFlow";
import {
  ORDER_WORKSPACE_MODES,
  getBusinessOrderSettings,
} from "@/server/services/orderWorkflowSupport";
import { buildOrderTrackingUrl } from "@/server/services/orderTracking";
import {
  extractCustomerEmail,
  logTicketEvent,
  publishHydratedTicketUpsert,
  sanitizeTicketFields,
} from "@/server/services/ticketWorkflowSupport";
import {
  getOrderByIdForBusiness,
  getOrderStatsForBusiness,
  getOrderWorkspaceOverviewForBusiness,
  listOrderEventsForBusiness,
  listOrderPaymentsForBusiness,
  listOrdersForBusiness,
  listOrdersPageForBusiness,
} from "@/server/services/orderReadSupport";
import * as orderMutationSupport from "@/server/services/orderMutationSupport";
import { getCached, setCached } from "@/lib/redis";

const reviewActionSchema = z.enum(["approve", "reject"]);
const refundActionSchema = z.enum(["mark_pending", "mark_refunded", "cancel"]);
const fulfillmentStatusSchema = z.enum(ORDER_FULFILLMENT_STATUSES);

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
      const cacheKey = `orders:list:${ctx.businessId}:${JSON.stringify(input || {})}`;
      const cached = await getCached<any>(cacheKey);
      if (cached) return cached;

      const result = await listOrdersForBusiness({ businessId: ctx.businessId, limit: input?.limit, status: input?.status });
      await setCached(cacheKey, result, 15);
      return result;
    }),

  listOrdersPage: businessProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
        search: z.string().optional(),
        mode: z.enum(ORDER_WORKSPACE_MODES).default("payments"),
        queueFilter: z
          .enum([
            "all",
            "pending",
            "approved",
            "denied",
            "out_for_delivery",
            "completed",
            "realized",
            "unrealized",
          ])
          .default("pending"),
        dateField: z.enum(["updatedAt", "createdAt"]).default("updatedAt"),
        rangeDays: z.number().int().min(1).max(365).default(30),
        methodFilter: z.enum(["all", "manual", "bank_qr", "cod"]).default("all"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const cacheKey = `orders:page:${ctx.businessId}:${JSON.stringify(input || {})}`;
      const cached = await getCached<any>(cacheKey);
      if (cached) return cached;

      const result = await listOrdersPageForBusiness({ businessId: ctx.businessId, ...input });
      await setCached(cacheKey, result, 15);
      return result;
    }),

  getOverview: businessProcedure
    .input(
      z.object({
        mode: z.enum(ORDER_WORKSPACE_MODES).default("payments"),
        queueFilter: z
          .enum([
            "all",
            "pending",
            "approved",
            "denied",
            "out_for_delivery",
            "completed",
            "realized",
            "unrealized",
          ])
          .default("pending"),
        dateField: z.enum(["updatedAt", "createdAt"]).default("updatedAt"),
        rangeDays: z.number().int().min(1).max(365).default(30),
        methodFilter: z.enum(["all", "manual", "bank_qr", "cod"]).default("all"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const cacheKey = `orders:overview:${ctx.businessId}:${JSON.stringify(input || {})}`;
      const cached = await getCached<any>(cacheKey);
      if (cached) return cached;

      const result = await getOrderWorkspaceOverviewForBusiness({ businessId: ctx.businessId, ...input });
      await setCached(cacheKey, result, 15);
      return result;
    }),

  getOrderById: businessProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const cacheKey = `orders:id:${ctx.businessId}:${input.orderId}`;
      const cached = await getCached<any>(cacheKey);
      if (cached) return cached;

      const result = await getOrderByIdForBusiness({ businessId: ctx.businessId, orderId: input.orderId });
      await setCached(cacheKey, result, 15);
      return result;
    }),

  getStats: businessProcedure.query(async ({ ctx }) => {
    const cacheKey = `orders:stats:${ctx.businessId}`;
    const cached = await getCached<any>(cacheKey);
    if (cached) return cached;

    const result = await getOrderStatsForBusiness(ctx.businessId);
    await setCached(cacheKey, result, 60);
    return result;
  }),

  getOrderPayments: businessProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const cacheKey = `orders:payments:${ctx.businessId}:${input.orderId}`;
      const cached = await getCached<any>(cacheKey);
      if (cached) return cached;

      const result = await listOrderPaymentsForBusiness({ businessId: ctx.businessId, orderId: input.orderId });
      await setCached(cacheKey, result, 15);
      return result;
    }),

  updateDraftOrder: businessProcedure
    .input(
      z.object({
        orderId: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        title: z.string().nullish(),
        summary: z.string().nullish(),
        notes: z.string().nullish(),
        customerName: z.string().nullish(),
        customerPhone: z.string().nullish(),
        customerEmail: z.string().nullish(),
        fields: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => orderMutationSupport.updateDraftOrder(ctx, input)),

  updatePaymentSetup: businessProcedure
    .input(
      z.object({
        orderId: z.string().min(1),
        expectedUpdatedAt: z.coerce.date().optional(),
        expectedAmount: z.string().optional().nullable(),
        paymentReference: z.string().optional().nullable(),
        customerEmail: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => orderMutationSupport.updatePaymentSetup(ctx, input)),

  getOrderEvents: businessProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const cacheKey = `orders:events:${ctx.businessId}:${input.orderId}`;
      const cached = await getCached<any>(cacheKey);
      if (cached) return cached;

      const result = await listOrderEventsForBusiness({ businessId: ctx.businessId, orderId: input.orderId });
      await setCached(cacheKey, result, 15);
      return result;
    }),

  sendPaymentDetails: businessProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => orderMutationSupport.sendPaymentDetails(ctx, input)),

  reviewPayment: businessProcedure
    .input(
      z.object({
        paymentId: z.string().min(1),
        action: reviewActionSchema,
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => orderMutationSupport.reviewPayment(ctx, input)),

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
    .mutation(async ({ ctx, input }) => orderMutationSupport.updateFulfillment(ctx, input)),

  captureManualPayment: businessProcedure
    .input(
      z.object({
        orderId: z.string().min(1),
        amount: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => orderMutationSupport.captureManualPayment(ctx, input)),

  denyPendingPaymentOrder: businessProcedure
    .input(
      z.object({
        orderId: z.string().min(1),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => orderMutationSupport.denyPendingPaymentOrder(ctx, input)),

  reopenPaidOrderForPaymentReview: businessProcedure
    .input(
      z.object({
        orderId: z.string().min(1),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => orderMutationSupport.reopenPaidOrderForPaymentReview(ctx, input)),

  updateRefundStatus: businessProcedure
    .input(
      z.object({
        orderId: z.string().min(1),
        action: refundActionSchema,
        amount: z.string().optional(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => orderMutationSupport.updateRefundStatus(ctx, input)),
});
