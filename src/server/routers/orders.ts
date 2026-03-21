/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { normalizeOrderFlowSettings } from "@/lib/order-settings";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import { db } from "../db/client";
import { businessProcedure, router } from "../trpc";
import { businesses, customers, messageThreads, orderEvents, orderPayments, orders } from "../../../drizzle/schema";
import { sendWhatsAppMessagesViaBot, type BotSendMessage } from "../services/botApi";
import { logOrderEvent, persistOutboundThreadMessage, sanitizePhoneDigits } from "../services/orderFlow";

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

function coalesceText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return null;
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
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

type OrderCustomerContext = {
  id: string;
  name: string | null;
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

async function getOrderCustomerContext(businessId: string, customerId: string | null | undefined): Promise<OrderCustomerContext | null> {
  const normalizedCustomerId = String(customerId ?? "").trim();
  if (!normalizedCustomerId) return null;
  const [row] = await db
    .select({
      id: customers.id,
      name: customers.name,
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
  customerPhone?: string | null;
}) {
  const directCustomer = await getOrderCustomerContext(params.businessId, params.customerId);
  const threadContext = await getOrderThreadContext(params.businessId, params.threadId);

  const customerName = coalesceText(
    params.customerName,
    directCustomer?.name ?? null,
    threadContext?.customerName ?? null,
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

async function deliverOrderUpdateMessages(params: {
  businessId: string;
  orderRow: {
    id: string;
    customerId?: string | null;
    threadId?: string | null;
    whatsappIdentityId?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
  };
  messages: BotSendMessage[];
  source: string;
}) {
  if (!params.messages.length) {
    return { ok: true as const, error: null, recipientSource: null as string | null, whatsappIdentitySource: null as string | null };
  }
  const contactContext = await resolveOrderNotificationContext({
    businessId: params.businessId,
    customerId: params.orderRow.customerId ?? null,
    threadId: params.orderRow.threadId ?? null,
    whatsappIdentityId: params.orderRow.whatsappIdentityId ?? null,
    customerName: params.orderRow.customerName ?? null,
    customerPhone: params.orderRow.customerPhone ?? null,
  });
  const recipient = sanitizePhoneDigits(contactContext.approvalRecipient);
  if (!contactContext.whatsappIdentityId || !recipient) {
    return {
      ok: false as const,
      error: "Order is missing WhatsApp routing details for customer notification.",
      recipientSource: contactContext.recipientSource,
      whatsappIdentitySource: contactContext.whatsappIdentitySource,
    };
  }

  try {
    const sendResults = await sendWhatsAppMessagesViaBot({
      businessId: params.businessId,
      phoneNumberId: contactContext.whatsappIdentityId,
      to: recipient,
      messages: params.messages,
    });

    if (contactContext.threadId) {
      for (const [index, outbound] of params.messages.entries()) {
        await persistOutboundThreadMessage({
          businessId: params.businessId,
          threadId: contactContext.threadId,
          messageType: outbound.type,
          textBody: outbound.type === "text" ? outbound.text : outbound.caption ?? "[order update image]",
          externalMessageId: sendResults[index]?.messageId ?? null,
          meta: {
            source: params.source,
            orderId: params.orderRow.id,
            providerResponse: sendResults[index]?.providerResponse ?? null,
            whatsappIdentityId: contactContext.whatsappIdentityId,
            recipient: maskPhoneNumber(recipient),
          },
        });
      }
    }

    return {
      ok: true as const,
      error: null,
      recipientSource: contactContext.recipientSource,
      whatsappIdentitySource: contactContext.whatsappIdentitySource,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Failed to deliver WhatsApp order update.",
      recipientSource: contactContext.recipientSource,
      whatsappIdentitySource: contactContext.whatsappIdentitySource,
    };
  }
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
      if (String(paymentRow.status || "").trim().toLowerCase() !== "submitted") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only submitted payments can be reviewed." });
      }
      if (String(orderRow.status || "").trim().toLowerCase() !== "payment_submitted") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only payment-submitted orders can be reviewed." });
      }
      const [latestPayment] = await db
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
          paymentApprovedAt: input.action === "approve" ? now : null,
          paymentRejectedAt: input.action === "reject" ? now : null,
          updatedAt: now,
        })
        .where(eq(orders.id, orderRow.id))
        .returning();

      if (!updatedPayment || !updatedOrder) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to review payment." });
      }

      const delivery = await deliverOrderUpdateMessages({
        businessId: ctx.businessId,
        orderRow: updatedOrder,
        source: input.action === "approve" ? "order_payment_approved" : "order_payment_rejected",
        messages: buildPaymentReviewMessages({
          action: input.action,
          orderId: updatedOrder.id,
          paymentReference: updatedOrder.paymentReference,
          paidAmount: updatedPayment.paidAmount ?? updatedOrder.paidAmount,
          currency: String(updatedOrder.currency || "LKR").trim() || "LKR",
          notes: input.notes?.trim() || null,
        }),
      });

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
      if (!delivery.ok) {
        await logOrderEvent({
          businessId: ctx.businessId,
          orderId: updatedOrder.id,
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
        entityId: updatedOrder.id,
        payload: {
          order: {
            ...updatedOrder,
            latestPayment: updatedPayment,
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
        outcome: delivery.ok ? "success" : "degraded",
        status: nextPaymentStatus,
        attributes: {
          action: input.action,
          order_id: updatedOrder.id,
          delivery_ok: delivery.ok,
          delivery_phone_source: delivery.recipientSource,
          delivery_identity_source: delivery.whatsappIdentitySource,
        },
      });

      return {
        order: updatedOrder,
        payment: updatedPayment,
        delivery,
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

      const delivery = await deliverOrderUpdateMessages({
        businessId: ctx.businessId,
        orderRow: updatedOrder,
        source:
          input.action === "mark_pending"
            ? "order_refund_pending"
            : input.action === "mark_refunded"
              ? "order_refund_completed"
              : "order_refund_cancelled",
        messages: buildRefundStatusMessages({
          action: input.action,
          orderId: updatedOrder.id,
          paymentReference: updatedOrder.paymentReference,
          refundAmount: input.action === "cancel" ? null : nextRefundAmount,
          currency: String(updatedOrder.currency || "LKR").trim() || "LKR",
          reason: input.action === "cancel" ? null : nextRefundReason,
        }),
      });
      if (!delivery.ok) {
        await logOrderEvent({
          businessId: ctx.businessId,
          orderId: updatedOrder.id,
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
        entityId: updatedOrder.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: delivery.ok ? "success" : "degraded",
        status: nextStatus,
        attributes: {
          previous_status: orderRow.status,
          refund_action: input.action,
          refund_amount: input.action === "cancel" ? null : nextRefundAmount,
          delivery_ok: delivery.ok,
          delivery_phone_source: delivery.recipientSource,
          delivery_identity_source: delivery.whatsappIdentitySource,
        },
      });

      return { order: updatedOrder, delivery };
    }),
});
