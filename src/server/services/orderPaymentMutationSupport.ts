/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { customers, orderPayments, orders, supportTickets } from "../../../drizzle/schema";
import {
  normalizeOrderFulfillmentStatus,
} from "@/lib/order-operations";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import { drainBusinessOutbox, enqueueEmailOutboxMessages, enqueueWhatsAppOutboxMessages } from "@/server/services/messageOutbox";
import {
  logOrderEvent,
  sanitizePhoneDigits,
} from "../services/orderFlow";
import {
  assertPaymentReviewAllowed,
  buildPaymentReviewEmail,
  buildPaymentReviewMessages,
  enforceOrderOperationThrottle,
  flushBusinessOutbox,
  getBusinessOrderSettings,
  getThreadWhatsappWindowState,
  resolveOrderNotificationContext,
} from "@/server/services/orderWorkflowSupport";
import { withRedisWorkflowLock } from "@/server/services/ticketWorkflowSupport";
import {
  resolveFulfillmentPrefill,
} from "./orderMutationUtils";

export * from "./orderManualPaymentSupport";
export * from "./orderRefundMutationSupport";

export async function reviewPayment(
  ctx: any,
  input: {
    paymentId: string;
    action: "approve" | "reject";
    notes?: string;
  }
) {
  const settings = await getBusinessOrderSettings(ctx.businessId);
  if (!settings.ticketToOrderEnabled) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket-to-order flow is disabled for this business." });
  }
  const now = new Date();
  const [paymentPrecheck] = await db
    .select({ orderId: orderPayments.orderId })
    .from(orderPayments)
    .where(and(eq(orderPayments.businessId, ctx.businessId), eq(orderPayments.id, input.paymentId)))
    .limit(1);
  if (!paymentPrecheck) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Order payment not found." });
  }

  const lockKey = `${ctx.businessId}::order::${paymentPrecheck.orderId}`;
  const result = await withRedisWorkflowLock(lockKey, async () => {
    return await db.transaction(async (tx) => {
      const [paymentRow] = await tx
        .select()
        .from(orderPayments)
        .where(and(eq(orderPayments.businessId, ctx.businessId), eq(orderPayments.id, input.paymentId)))
        .limit(1);
      if (!paymentRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order payment not found." });
      }

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
    assertPaymentReviewAllowed({
      orderRow,
      paymentRow,
      action: input.action,
    });
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
    const nextOrderStatus = input.action === "approve" ? "paid" : "denied";
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

    const fulfillmentPrefill = resolveFulfillmentPrefill(orderRow);
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
        recipientName: fulfillmentPrefill.recipientName,
        recipientPhone: fulfillmentPrefill.recipientPhone,
        shippingAddress: fulfillmentPrefill.shippingAddress,
        deliveryArea: fulfillmentPrefill.deliveryArea,
        updatedAt: now,
      })
      .where(eq(orders.id, orderRow.id))
      .returning();

    if (!updatedPayment || !updatedOrder) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to review payment." });
    }

    if (input.action === "reject" && updatedOrder.supportTicketId) {
      await tx
        .update(supportTickets)
        .set({
          status: "resolved",
          outcome: "lost",
          lossReason: input.notes?.trim() || "Payment was not approved",
          resolvedAt: now,
          updatedAt: now,
        })
        .where(and(eq(supportTickets.businessId, ctx.businessId), eq(supportTickets.id, updatedOrder.supportTicketId)));
    }

    const finalizedOrder = updatedOrder;

    const contactContext = await resolveOrderNotificationContext({
      businessId: ctx.businessId,
      customerId: finalizedOrder.customerId ?? null,
      threadId: finalizedOrder.threadId ?? null,
      channelIdentityId: finalizedOrder.channelIdentityId ?? null,
      customerName: finalizedOrder.customerName ?? null,
      customerEmail: finalizedOrder.customerEmail ?? null,
      customerPhone: finalizedOrder.customerPhone ?? null,
    });
    let resumedCustomer: typeof customers.$inferSelect | null = null;
    let previousCustomerBotPaused = false;
    if (finalizedOrder.customerId) {
      const [existingCustomer] = await tx
        .select({
          botPaused: customers.botPaused,
        })
        .from(customers)
        .where(and(eq(customers.businessId, ctx.businessId), eq(customers.id, finalizedOrder.customerId)))
        .limit(1);
      previousCustomerBotPaused = Boolean(existingCustomer?.botPaused);
      if (previousCustomerBotPaused) {
        [resumedCustomer] = await tx
          .update(customers)
          .set({
            botPaused: false,
            updatedAt: now,
          })
          .where(and(eq(customers.businessId, ctx.businessId), eq(customers.id, finalizedOrder.customerId)))
          .returning();
      }
    }
    const windowState = await getThreadWhatsappWindowState(tx, finalizedOrder.threadId);
    const hasWhatsappRoute = Boolean(contactContext.channelIdentityId && sanitizePhoneDigits(contactContext.approvalRecipient));
    const hasEmailRoute = Boolean(contactContext.customerEmail);
    const deliveryChannel: "whatsapp" | "email" | "none" =
      input.action === "approve"
        ? "none"
        : windowState.whatsappWindowOpen && hasWhatsappRoute
          ? "whatsapp"
          : hasEmailRoute
            ? "email"
            : hasWhatsappRoute
              ? "whatsapp"
              : (() => {
                  throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "This order is missing both an active WhatsApp route and a customer email address.",
                  });
                })();
    const notification = deliveryChannel === "whatsapp"
      ? await enqueueWhatsAppOutboxMessages(tx, {
          businessId: ctx.businessId,
          entityType: "order",
          entityId: finalizedOrder.id,
          customerId: finalizedOrder.customerId ?? null,
          threadId: contactContext.threadId ?? null,
          channelIdentityId: contactContext.channelIdentityId ?? null,
          recipient: contactContext.approvalRecipient,
          recipientSource: contactContext.recipientSource,
          whatsappIdentitySource: contactContext.whatsappIdentitySource,
          source: input.action === "approve" ? "order_payment_approved" : "order_payment_rejected",
          idempotencyBaseKey: `order:${finalizedOrder.id}:payment_review:${paymentRow.id}:${input.action}`,
          messages: buildPaymentReviewMessages({
            action: input.action,
            orderId: finalizedOrder.id,
            paymentReference: finalizedOrder.paymentReference,
            paidAmount: updatedPayment.paidAmount ?? finalizedOrder.paidAmount,
            currency: String(finalizedOrder.currency || "LKR").trim() || "LKR",
            notes: input.notes?.trim() || null,
          }),
        })
      : {
          ok: true as const,
          error: null,
          recipientSource: null,
          whatsappIdentitySource: null,
          idempotencyKeys: [] as string[],
        };
    const emailNotification = deliveryChannel === "email" && input.action === "reject"
      ? await enqueueEmailOutboxMessages(tx, {
          businessId: ctx.businessId,
          entityType: "order",
          entityId: finalizedOrder.id,
          customerId: finalizedOrder.customerId ?? null,
          recipientEmail: contactContext.customerEmail,
          source: "order_payment_rejected_email",
          idempotencyBaseKey: `order:${finalizedOrder.id}:payment_review_email:${paymentRow.id}:${input.action}`,
          messages: [
            buildPaymentReviewEmail({
              action: input.action,
              orderId: finalizedOrder.id,
              paymentReference: finalizedOrder.paymentReference,
              paidAmount: updatedPayment.paidAmount ?? finalizedOrder.paidAmount,
              currency: String(finalizedOrder.currency || "LKR").trim() || "LKR",
              notes: input.notes?.trim() || null,
            }),
          ],
        })
      : { ok: true as const, error: null, idempotencyKeys: [] as string[] };

    return {
      paymentRow,
      orderRow,
      updatedPayment,
      updatedOrder: finalizedOrder,
      nextPaymentStatus,
      nextOrderStatus,
      nextFulfillmentStatus,
      notification,
      emailNotification,
      deliveryChannel,
      windowState,
      customerPause: {
        row: resumedCustomer,
        previousBotPaused: previousCustomerBotPaused,
      },
    };
  });
  });

  let delivery: {
    ok: boolean;
    error: string | null;
    channel: "whatsapp" | "email" | "none";
    recipientSource: string | null;
    whatsappIdentitySource: string | null;
  } = {
    ok: true,
    error: null,
    channel: result.deliveryChannel,
    recipientSource: result.notification.recipientSource,
    whatsappIdentitySource: result.notification.whatsappIdentitySource,
  };
  if (result.deliveryChannel === "none") {
    delivery = {
      ok: true,
      error: null,
      channel: "none",
      recipientSource: null,
      whatsappIdentitySource: null,
    };
  } else if (result.deliveryChannel === "whatsapp" && !result.notification.ok) {
    delivery = {
      ok: false,
      error: result.notification.error,
      channel: "whatsapp",
      recipientSource: result.notification.recipientSource,
      whatsappIdentitySource: result.notification.whatsappIdentitySource,
    };
  } else if (result.deliveryChannel === "email" && !result.emailNotification.ok) {
    delivery = {
      ok: false,
      error: result.emailNotification.error,
      channel: "email",
      recipientSource: null,
      whatsappIdentitySource: null,
    };
  } else {
    const idempotencyKeys =
      result.deliveryChannel === "whatsapp"
        ? result.notification.idempotencyKeys
        : result.emailNotification.idempotencyKeys;
    if (idempotencyKeys.length) {
      const drained = await drainBusinessOutbox({
        businessId: ctx.businessId,
        idempotencyKeys,
        limit: idempotencyKeys.length,
      });
      delivery = {
        ok: drained.ok,
        error: drained.error,
        channel: result.deliveryChannel,
        recipientSource: result.deliveryChannel === "whatsapp" ? result.notification.recipientSource : null,
        whatsappIdentitySource:
          result.deliveryChannel === "whatsapp" ? result.notification.whatsappIdentitySource : null,
      };
    }
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
      invoiceNumber: result.updatedOrder.invoiceNumber,
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
  if (result.customerPause?.row) {
    await publishPortalEvent({
      businessId: ctx.businessId,
      entity: "customer",
      op: "upsert",
      entityId: result.customerPause.row.id,
      payload: {
        customer: JSON.parse(JSON.stringify(result.customerPause.row)) as any,
      },
      createdAt: result.customerPause.row.updatedAt ?? now,
    });
  }

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
      delivery_channel: delivery.channel,
      delivery_phone_source: delivery.recipientSource,
      delivery_identity_source: delivery.whatsappIdentitySource,
    },
  });
  if (result.customerPause?.row && result.customerPause.previousBotPaused) {
    recordBusinessEvent({
      event: "customer.bot_resumed",
      action: "reviewPayment",
      area: "customer",
      businessId: ctx.businessId,
      entity: "customer",
      entityId: result.customerPause.row.id,
      userId: ctx.userId,
      actorId: ctx.firebaseUid ?? ctx.userId ?? null,
      actorType: "user",
      outcome: "success",
      status: result.customerPause.row.status,
      attributes: {
        previous_bot_paused: true,
        source: result.customerPause.row.source,
        order_id: result.updatedOrder.id,
        payment_id: result.paymentRow.id,
        trigger: input.action === "approve" ? "payment_approved" : "payment_rejected",
      },
    });
  }

  return {
    order: result.updatedOrder,
    payment: result.updatedPayment,
    delivery,
  };
}
