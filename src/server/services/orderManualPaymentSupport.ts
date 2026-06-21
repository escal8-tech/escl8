/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { orderPayments, orders, supportTickets } from "../../../drizzle/schema";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import { drainBusinessOutbox, enqueueEmailOutboxMessages, enqueueWhatsAppOutboxMessages } from "@/server/services/messageOutbox";
import {
  buildManualCollectionMessages,
  buildManualCollectionEmail,
  logOrderEvent,
  sanitizePhoneDigits,
} from "../services/orderFlow";
import {
  buildPaymentReviewEmail,
  buildPaymentReviewMessages,
  canReopenPaidOrderForPaymentReview,
  canCaptureManualPayment,
  cleanOptionalText,
  enforceOrderOperationThrottle,
  flushBusinessOutbox,
  getBusinessOrderSettings,
  getThreadWhatsappWindowState,
  resolveOrderNotificationContext,
  resolveRefundAmount,
} from "@/server/services/orderWorkflowSupport";
import { withRedisWorkflowLock } from "@/server/services/ticketWorkflowSupport";
import {
  emailManualOrderInvoice,
  isStaffManualOrder,
  resolveFulfillmentPrefill,
} from "./orderMutationUtils";

export async function captureManualPayment(
  ctx: any,
  input: {
    orderId: string;
    amount?: string;
    note?: string;
  }
) {
  const settings = await getBusinessOrderSettings(ctx.businessId);
  if (!settings.ticketToOrderEnabled) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket-to-order flow is disabled for this business." });
  }
  const now = new Date();
  const lockKey = `${ctx.businessId}::order::${input.orderId}`;
  const result = await withRedisWorkflowLock(lockKey, async () => {
    return await db.transaction(async (tx) => {
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
    const [manualPaymentRow] = await tx
      .insert(orderPayments)
      .values({
        businessId: ctx.businessId,
        orderId: orderRow.id,
        customerId: orderRow.customerId,
        threadId: orderRow.threadId,
        channelIdentityId: orderRow.channelIdentityId,
        paymentMethod: orderRow.paymentMethod,
        status: "approved_manual",
        currency: orderRow.currency,
        expectedAmount: orderRow.expectedAmount,
        paidAmount,
        aiCheckStatus: "manual_review",
        aiCheckNotes: input.note?.trim() || "Staff approved payment manually.",
        details: {
          source: "manual_staff_approval",
          note: input.note?.trim() || null,
        },
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const fulfillmentPrefill = resolveFulfillmentPrefill(orderRow);
    const [updatedOrder] = await tx
      .update(orders)
      .set({
        status: "paid",
        paidAmount,
        paymentApprovedAt: now,
        recipientName: fulfillmentPrefill.recipientName,
        recipientPhone: fulfillmentPrefill.recipientPhone,
        shippingAddress: fulfillmentPrefill.shippingAddress,
        deliveryArea: fulfillmentPrefill.deliveryArea,
        updatedAt: now,
      })
      .where(eq(orders.id, orderRow.id))
      .returning();

    if (!updatedOrder) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to record manual payment." });
    }

    const suppressCustomerNotifications = isStaffManualOrder(updatedOrder);
    const currentOrder = updatedOrder;

    const contactContext = await resolveOrderNotificationContext({
      businessId: ctx.businessId,
      customerId: currentOrder.customerId ?? null,
      threadId: currentOrder.threadId ?? null,
      channelIdentityId: currentOrder.channelIdentityId ?? null,
      customerName: currentOrder.customerName ?? null,
      customerEmail: currentOrder.customerEmail ?? null,
      customerPhone: currentOrder.customerPhone ?? null,
    });
    const windowState = await getThreadWhatsappWindowState(tx, currentOrder.threadId);
    const hasWhatsappRoute = Boolean(contactContext.channelIdentityId && sanitizePhoneDigits(contactContext.approvalRecipient));
    const hasEmailRoute = Boolean(contactContext.customerEmail);
    const deliveryChannel: "whatsapp" | "email" | "none" =
      suppressCustomerNotifications
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
          entityId: currentOrder.id,
          customerId: currentOrder.customerId ?? null,
          threadId: contactContext.threadId ?? null,
          channelIdentityId: contactContext.channelIdentityId ?? null,
          recipient: contactContext.approvalRecipient,
          recipientSource: contactContext.recipientSource,
          whatsappIdentitySource: contactContext.whatsappIdentitySource,
          source: "order_manual_payment_collected",
          idempotencyBaseKey: `order:${currentOrder.id}:manual_payment:${String(currentOrder.paymentApprovedAt ?? now.toISOString())}`,
          messages: buildManualCollectionMessages({
            customerName: currentOrder.customerName,
            orderId: currentOrder.id,
            currency: String(currentOrder.currency || "LKR").trim() || "LKR",
            paidAmount,
          }),
        })
      : {
          ok: true as const,
          error: null,
          recipientSource: null,
          whatsappIdentitySource: null,
          idempotencyKeys: [] as string[],
        };
    const emailNotification = deliveryChannel === "email"
      ? await enqueueEmailOutboxMessages(tx, {
          businessId: ctx.businessId,
          entityType: "order",
          entityId: currentOrder.id,
          customerId: currentOrder.customerId ?? null,
          recipientEmail: contactContext.customerEmail,
          source: "order_manual_payment_collected_email",
          idempotencyBaseKey: `order:${currentOrder.id}:manual_payment_email:${String(currentOrder.paymentApprovedAt ?? now.toISOString())}`,
          messages: [
            buildManualCollectionEmail({
              customerName: currentOrder.customerName,
              orderId: currentOrder.id,
              currency: String(currentOrder.currency || "LKR").trim() || "LKR",
              paidAmount,
            }),
          ],
        })
      : { ok: true as const, error: null, idempotencyKeys: [] as string[] };
      return { orderRow, updatedOrder: currentOrder, paidAmount, manualPaymentRow, notification, emailNotification, deliveryChannel };
    });
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
      paymentId: result.manualPaymentRow?.id ?? null,
      invoiceNumber: result.updatedOrder.invoiceNumber,
    },
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
  const shouldEmailManualInvoice = isStaffManualOrder(result.updatedOrder)
    && Boolean(cleanOptionalText(result.updatedOrder.customerEmail, 240));
  let manualInvoiceEmail: Awaited<ReturnType<typeof emailManualOrderInvoice>> | null = null;
  if (shouldEmailManualInvoice) {
    try {
      manualInvoiceEmail = await emailManualOrderInvoice({
        businessId: ctx.businessId,
        order: result.updatedOrder,
      });
    } catch (error) {
      manualInvoiceEmail = {
        ok: false,
        error: error instanceof Error ? error.message : "Manual order invoice email failed.",
        invoiceNumber: result.updatedOrder.invoiceNumber ?? null,
      };
    }
    if (!manualInvoiceEmail.ok) {
      await logOrderEvent({
        businessId: ctx.businessId,
        orderId: result.updatedOrder.id,
        eventType: "manual_invoice_email_failed",
        actorType: "system",
        actorLabel: "system",
        payload: {
          error: manualInvoiceEmail.error,
        },
      });
    } else {
      await logOrderEvent({
        businessId: ctx.businessId,
        orderId: result.updatedOrder.id,
        eventType: "manual_invoice_emailed",
        actorType: "system",
        actorLabel: "system",
        payload: {
          invoiceNumber: manualInvoiceEmail.invoiceNumber,
        },
      });
    }
  }
  const latestOrderAfterInvoice = manualInvoiceEmail?.ok
    ? await db
        .select()
        .from(orders)
        .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, result.updatedOrder.id)))
        .limit(1)
        .then((rows) => rows[0] ?? result.updatedOrder)
    : result.updatedOrder;
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
    payload: { order: latestOrderAfterInvoice as any },
    createdAt: latestOrderAfterInvoice.updatedAt ?? now,
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
      delivery_channel: delivery.channel,
    },
  });

  return { order: latestOrderAfterInvoice, delivery };
}

export async function denyPendingPaymentOrder(
  ctx: any,
  input: {
    orderId: string;
    reason?: string;
  }
) {
  const settings = await getBusinessOrderSettings(ctx.businessId);
  if (!settings.ticketToOrderEnabled) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket-to-order flow is disabled for this business." });
  }
  const now = new Date();
  const lockKey = `${ctx.businessId}::order::${input.orderId}`;
  const result = await withRedisWorkflowLock(lockKey, async () => {
    return await db.transaction(async (tx) => {
      await enforceOrderOperationThrottle(tx, ctx, "reviewPayment", input.orderId);

    const [orderRow] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
      .limit(1);
    if (!orderRow) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
    }
    const status = String(orderRow.status || "").trim().toLowerCase();
    if (!["approved", "awaiting_payment", "payment_submitted", "payment_rejected"].includes(status)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only unpaid orders can be denied from the payment queue." });
    }

    const normalizedReason = input.reason?.trim() || "Payment was not approved";
    const [latestPayment] = await tx
      .select()
      .from(orderPayments)
      .where(and(eq(orderPayments.businessId, ctx.businessId), eq(orderPayments.orderId, orderRow.id)))
      .orderBy(desc(orderPayments.createdAt), desc(orderPayments.id))
      .limit(1);

    let updatedPayment = latestPayment ?? null;
    if (latestPayment && String(latestPayment.status || "").trim().toLowerCase() === "submitted") {
      const [rejectedPayment] = await tx
        .update(orderPayments)
        .set({
          status: "rejected",
          aiCheckNotes: normalizedReason,
          updatedAt: now,
        })
        .where(eq(orderPayments.id, latestPayment.id))
        .returning();
      updatedPayment = rejectedPayment ?? latestPayment;
    } else if (!latestPayment) {
      const [createdPayment] = await tx
        .insert(orderPayments)
        .values({
          businessId: ctx.businessId,
          orderId: orderRow.id,
          customerId: orderRow.customerId,
          threadId: orderRow.threadId,
          channelIdentityId: orderRow.channelIdentityId,
          paymentMethod: orderRow.paymentMethod,
          status: "rejected",
          currency: orderRow.currency,
          expectedAmount: orderRow.expectedAmount,
          aiCheckStatus: "manual_review",
          aiCheckNotes: normalizedReason,
          details: {
            source: "manual_staff_denial",
          },
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      updatedPayment = createdPayment ?? null;
    }

    const [updatedOrder] = await tx
      .update(orders)
      .set({
        status: "denied",
        paymentRejectedAt: now,
        updatedAt: now,
      })
      .where(eq(orders.id, orderRow.id))
      .returning();
    if (!updatedOrder) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to deny order." });
    }
    if (updatedOrder.supportTicketId) {
      await tx
        .update(supportTickets)
        .set({
          status: "resolved",
          outcome: "lost",
          lossReason: normalizedReason,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(and(eq(supportTickets.businessId, ctx.businessId), eq(supportTickets.id, updatedOrder.supportTicketId)));
    }

    const contactContext = await resolveOrderNotificationContext({
      businessId: ctx.businessId,
      customerId: updatedOrder.customerId ?? null,
      threadId: updatedOrder.threadId ?? null,
      channelIdentityId: updatedOrder.channelIdentityId ?? null,
      customerName: updatedOrder.customerName ?? null,
      customerEmail: updatedOrder.customerEmail ?? null,
      customerPhone: updatedOrder.customerPhone ?? null,
    });
    const windowState = await getThreadWhatsappWindowState(tx, updatedOrder.threadId);
    const hasWhatsappRoute = Boolean(contactContext.channelIdentityId && sanitizePhoneDigits(contactContext.approvalRecipient));
    const hasEmailRoute = Boolean(contactContext.customerEmail);
    const deliveryChannel: "whatsapp" | "email" =
      windowState.whatsappWindowOpen && hasWhatsappRoute
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
          entityId: updatedOrder.id,
          customerId: updatedOrder.customerId ?? null,
          threadId: contactContext.threadId ?? null,
          channelIdentityId: contactContext.channelIdentityId ?? null,
          recipient: contactContext.approvalRecipient,
          recipientSource: contactContext.recipientSource,
          whatsappIdentitySource: contactContext.whatsappIdentitySource,
          source: "order_payment_denied",
          idempotencyBaseKey: `order:${updatedOrder.id}:payment_denied:${now.toISOString()}`,
          messages: buildPaymentReviewMessages({
            action: "reject",
            orderId: updatedOrder.id,
            paymentReference: updatedOrder.paymentReference,
            paidAmount: updatedPayment?.paidAmount ?? updatedOrder.paidAmount,
            currency: String(updatedOrder.currency || "LKR").trim() || "LKR",
            notes: normalizedReason,
          }),
        })
      : { ok: true as const, error: null, recipientSource: null, whatsappIdentitySource: null, idempotencyKeys: [] as string[] };
    const emailNotification = deliveryChannel === "email"
      ? await enqueueEmailOutboxMessages(tx, {
          businessId: ctx.businessId,
          entityType: "order",
          entityId: updatedOrder.id,
          customerId: updatedOrder.customerId ?? null,
          recipientEmail: contactContext.customerEmail,
          source: "order_payment_denied_email",
          idempotencyBaseKey: `order:${updatedOrder.id}:payment_denied_email:${now.toISOString()}`,
          messages: [
            buildPaymentReviewEmail({
              action: "reject",
              orderId: updatedOrder.id,
              paymentReference: updatedOrder.paymentReference,
              paidAmount: updatedPayment?.paidAmount ?? updatedOrder.paidAmount,
              currency: String(updatedOrder.currency || "LKR").trim() || "LKR",
              notes: normalizedReason,
            }),
          ],
        })
      : { ok: true as const, error: null, idempotencyKeys: [] as string[] };
      return { updatedOrder, updatedPayment, notification, emailNotification, deliveryChannel };
    });
  });

  await logOrderEvent({
    businessId: ctx.businessId,
    orderId: result.updatedOrder.id,
    eventType: "payment_denied",
    actorType: "user",
    actorId: ctx.userId ?? ctx.firebaseUid ?? null,
    actorLabel: ctx.userEmail ?? "user",
    payload: {
      reason: cleanOptionalText(input.reason, 400),
      paymentId: result.updatedPayment?.id ?? null,
    },
  });

  let delivery = {
    ok: true,
    error: null as string | null,
    channel: result.deliveryChannel as "whatsapp" | "email",
  };
  if (result.deliveryChannel === "whatsapp" && !result.notification.ok) {
    delivery = { ok: false, error: result.notification.error, channel: "whatsapp" };
  } else if (result.deliveryChannel === "email" && !result.emailNotification.ok) {
    delivery = { ok: false, error: result.emailNotification.error, channel: "email" };
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
      delivery = { ok: drained.ok, error: drained.error, channel: result.deliveryChannel };
    }
  }
  await flushBusinessOutbox(ctx.businessId);
  return { order: result.updatedOrder, delivery };
}

export async function reopenPaidOrderForPaymentReview(
  ctx: any,
  input: {
    orderId: string;
    reason?: string;
  }
) {
  const settings = await getBusinessOrderSettings(ctx.businessId);
  if (!settings.ticketToOrderEnabled) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket-to-order flow is disabled for this business." });
  }
  const now = new Date();
  const normalizedReason = input.reason?.trim() || "Payment approval was reopened by staff.";
  const lockKey = `${ctx.businessId}::order::${input.orderId}`;
  const result = await withRedisWorkflowLock(lockKey, async () => {
    return await db.transaction(async (tx) => {
      await enforceOrderOperationThrottle(tx, ctx, "reviewPayment", input.orderId);

    const [orderRow] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
      .limit(1);
    if (!orderRow) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
    }
    if (!canReopenPaidOrderForPaymentReview(orderRow)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Only paid orders that have not entered delivery can be moved back into payment review.",
      });
    }

    const [latestPayment] = await tx
      .select()
      .from(orderPayments)
      .where(and(eq(orderPayments.businessId, ctx.businessId), eq(orderPayments.orderId, orderRow.id)))
      .orderBy(desc(orderPayments.createdAt), desc(orderPayments.id))
      .limit(1);

    let updatedPayment = latestPayment ?? null;
    let nextOrderStatus: "approved" | "awaiting_payment" | "payment_submitted" =
      String(orderRow.paymentMethod || "").trim().toLowerCase() === "bank_qr" ? "awaiting_payment" : "approved";

    if (latestPayment) {
      nextOrderStatus = "payment_submitted";
      const nextNotes = [normalizedReason, latestPayment.aiCheckNotes?.trim() || ""]
        .filter(Boolean)
        .join(" ");
      const [reopenedPayment] = await tx
        .update(orderPayments)
        .set({
          status: "submitted",
          aiCheckStatus: "manual_review",
          aiCheckNotes: nextNotes || null,
          updatedAt: now,
        })
        .where(eq(orderPayments.id, latestPayment.id))
        .returning();
      updatedPayment = reopenedPayment ?? latestPayment;
    }

    const [updatedOrder] = await tx
      .update(orders)
      .set({
        status: nextOrderStatus,
        fulfillmentStatus: "on_hold",
        fulfillmentUpdatedAt: now,
        paidAmount:
          nextOrderStatus === "payment_submitted"
            ? (updatedPayment?.paidAmount ?? orderRow.paidAmount)
            : null,
        paymentApprovedAt: null,
        paymentRejectedAt: null,
        invoiceNumber: null,
        invoiceUrl: null,
        invoiceStoragePath: null,
        invoiceFileName: null,
        invoiceStatus: "not_sent",
        invoiceDeliveryMethod: null,
        invoiceGeneratedAt: null,
        invoiceSentAt: null,
        updatedAt: now,
      })
      .where(eq(orders.id, orderRow.id))
      .returning();

    if (!updatedOrder) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to reopen paid order." });
    }

      return { updatedOrder, updatedPayment };
    });
  });

  await logOrderEvent({
    businessId: ctx.businessId,
    orderId: result.updatedOrder.id,
    eventType: "payment_reopened",
    actorType: "user",
    actorId: ctx.userId ?? ctx.firebaseUid ?? null,
    actorLabel: ctx.userEmail ?? "user",
    payload: {
      reason: normalizedReason,
      nextStatus: result.updatedOrder.status,
      paymentId: result.updatedPayment?.id ?? null,
    },
  });

  await publishPortalEvent({
    businessId: ctx.businessId,
    entity: "order",
    op: "upsert",
    entityId: result.updatedOrder.id,
    payload: { order: result.updatedOrder as any },
    createdAt: result.updatedOrder.updatedAt ?? now,
  });

  recordBusinessEvent({
    event: "order.payment_reopened",
    action: "reopenPaidOrderForPaymentReview",
    area: "order",
    businessId: ctx.businessId,
    entity: "order",
    entityId: result.updatedOrder.id,
    userId: ctx.userId,
    actorId: ctx.firebaseUid ?? ctx.userId ?? null,
    actorType: "user",
    outcome: "success",
    status: result.updatedOrder.status,
    attributes: {
      payment_id: result.updatedPayment?.id ?? null,
    },
  });

  return { order: result.updatedOrder, payment: result.updatedPayment };
}
