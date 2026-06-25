/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { orders } from "../../../drizzle/schema";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import {
  formatOrderItemsSummary,
  logOrderEvent,
  missingRequiredOrderDeliveryFields,
} from "../services/orderFlow";
import {
  asRecord,
  buildStoredOrderFlowSettings,
  canResendPaymentDetails,
  enforceOrderOperationThrottle,
  flushBusinessOutbox,
  getBusinessOrderSettings,
  getThreadWhatsappWindowState,
  maskPhoneNumber,
  resolveOrderNotificationContext,
} from "@/server/services/orderWorkflowSupport";
import {
  withRedisWorkflowLock,
} from "@/server/services/ticketWorkflowSupport";
import {
  enqueueWhatsAppOutboxMessages,
  enqueueEmailOutboxMessages,
  drainBusinessOutbox,
} from "@/server/services/messageOutbox";
import {
  buildOrderApprovalEmail,
  buildOrderApprovalMessages,
  sanitizePhoneDigits,
} from "@/server/services/orderFlow";
import { createOrderInvoiceForOrder } from "@/server/services/orderInvoice";
import { isStaffManualOrder, resolveFulfillmentPrefill } from "@/server/services/orderMutationUtils";

export * from "./orderMutationUtils";
export * from "./orderDraftMutationSupport";
export * from "./orderFulfillmentMutationSupport";
export * from "./orderPaymentMutationSupport";

export async function sendPaymentDetails(ctx: any, input: { orderId: string }) {
  const settings = await getBusinessOrderSettings(ctx.businessId);
  if (!settings.ticketToOrderEnabled) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket-to-order flow is disabled for this business." });
  }
  const now = new Date();
  const lockKey = `${ctx.businessId}::order::${input.orderId}`;
  const result = await withRedisWorkflowLock(lockKey, async () => {
    return await db.transaction(async (tx) => {
      await enforceOrderOperationThrottle(tx, ctx, "sendPaymentDetails", input.orderId);

    const [orderRow] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
      .limit(1);
    if (!orderRow) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
    }
    if (isStaffManualOrder(orderRow)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Manual staff orders do not send payment details to customers. Handle payment in-house.",
      });
    }
    if (String(orderRow.paymentMethod || "").trim().toLowerCase() !== "bank_qr") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Payment details can only be sent for Bank / QR orders." });
    }
    const missingDeliveryFields = missingRequiredOrderDeliveryFields({
      recipientName: orderRow.recipientName,
      recipientPhone: orderRow.recipientPhone,
      shippingAddress: orderRow.shippingAddress,
    });
    if (!canResendPaymentDetails(orderRow)) {
      if (
        String(orderRow.status || "").trim().toLowerCase() === "approved" &&
        missingDeliveryFields.length > 0
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Delivery details are still missing for this order. Collect the customer's name, phone number, and address before sending payment details.",
        });
      }
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Payment details can only be resent while the order is awaiting payment or under payment review.",
      });
    }

    let effectiveOrderRow = orderRow;
    if (String(orderRow.status || "").trim().toLowerCase() === "approved") {
      const fulfillmentPrefill = resolveFulfillmentPrefill(orderRow);
      const [updatedOrder] = await tx
        .update(orders)
        .set({
          status: "awaiting_payment",
          recipientName: fulfillmentPrefill.recipientName,
          recipientPhone: fulfillmentPrefill.recipientPhone,
          shippingAddress: fulfillmentPrefill.shippingAddress,
          deliveryArea: fulfillmentPrefill.deliveryArea,
          updatedAt: now,
        })
        .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, orderRow.id)))
        .returning();
      if (!updatedOrder) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to move the order into the payment stage.",
        });
      }
      effectiveOrderRow = updatedOrder;
    }

    const windowState = await getThreadWhatsappWindowState(tx, effectiveOrderRow.threadId);

    const contactContext = await resolveOrderNotificationContext({
      businessId: ctx.businessId,
      customerId: effectiveOrderRow.customerId ?? null,
      threadId: effectiveOrderRow.threadId ?? null,
      channelIdentityId: effectiveOrderRow.channelIdentityId ?? null,
      customerName: effectiveOrderRow.customerName ?? null,
      customerEmail: effectiveOrderRow.customerEmail ?? null,
      customerPhone: effectiveOrderRow.customerPhone ?? null,
    });
    const shouldSendViaWhatsapp = windowState.whatsappWindowOpen;
    const recipient = sanitizePhoneDigits(contactContext.approvalRecipient);
    if (shouldSendViaWhatsapp && (!contactContext.channelIdentityId || !recipient)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This order is missing WhatsApp routing details." });
    }
    if (!shouldSendViaWhatsapp && !contactContext.customerEmail) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Payment details require the customer's email after the WhatsApp window closes.",
      });
    }

    const orderSettings = buildStoredOrderFlowSettings(effectiveOrderRow);
    const snapshot = asRecord(effectiveOrderRow.ticketSnapshot);
    const messages = buildOrderApprovalMessages({
      orderId: effectiveOrderRow.id,
      customerName: contactContext.customerName ?? effectiveOrderRow.customerName,
      itemsSummary: formatOrderItemsSummary(snapshot),
      expectedAmount: effectiveOrderRow.expectedAmount?.toString() ?? null,
      paymentReference: effectiveOrderRow.paymentReference,
      orderSettings,
    });
    const emailMessage = buildOrderApprovalEmail({
      orderId: effectiveOrderRow.id,
      customerName: contactContext.customerName ?? effectiveOrderRow.customerName,
      itemsSummary: formatOrderItemsSummary(snapshot),
      expectedAmount: effectiveOrderRow.expectedAmount?.toString() ?? null,
      paymentReference: effectiveOrderRow.paymentReference,
      orderSettings,
    });
    const notification = shouldSendViaWhatsapp
      ? await enqueueWhatsAppOutboxMessages(tx, {
          businessId: ctx.businessId,
          entityType: "order",
          entityId: effectiveOrderRow.id,
          customerId: effectiveOrderRow.customerId ?? null,
          threadId: contactContext.threadId ?? null,
          channelIdentityId: contactContext.channelIdentityId ?? null,
          recipient: contactContext.approvalRecipient,
          recipientSource: contactContext.recipientSource,
          whatsappIdentitySource: contactContext.whatsappIdentitySource,
          source: "order_payment_details_manual_send",
          idempotencyBaseKey: `order:${orderRow.id}:payment_details_manual_send:${now.toISOString()}`,
          messages,
        })
      : {
          ok: true as const,
          error: null,
          recipientSource: null,
          whatsappIdentitySource: null,
          idempotencyKeys: [] as string[],
        };
    const emailNotification = shouldSendViaWhatsapp
      ? {
          ok: true as const,
          error: null,
          idempotencyKeys: [] as string[],
        }
      : await enqueueEmailOutboxMessages(tx, {
          businessId: ctx.businessId,
          entityType: "order",
          entityId: effectiveOrderRow.id,
          customerId: effectiveOrderRow.customerId ?? null,
          recipientEmail: contactContext.customerEmail,
          source: "order_payment_details_manual_send_email",
          idempotencyBaseKey: `order:${orderRow.id}:payment_details_manual_send_email:${now.toISOString()}`,
          messages: [emailMessage],
        });
    const deliveryChannel: "whatsapp" | "email" = shouldSendViaWhatsapp ? "whatsapp" : "email";

    return {
      orderRow: effectiveOrderRow,
      notification,
      emailNotification,
      deliveryChannel,
      windowState,
      botDisplayPhoneNumber: contactContext.channelIdentityId,
    };
  });
  });

  let delivery = {
    ok: true,
    error: null as string | null,
    channel: result.deliveryChannel as "whatsapp" | "email",
    recipientSource: result.notification.recipientSource,
    whatsappIdentitySource: result.notification.whatsappIdentitySource,
  };
  if (result.deliveryChannel === "whatsapp" && !result.notification.ok) {
    delivery = {
      ok: false,
      error: result.notification.error,
      channel: "whatsapp" as const,
      recipientSource: result.notification.recipientSource,
      whatsappIdentitySource: result.notification.whatsappIdentitySource,
    };
  } else if (result.deliveryChannel === "email" && !result.emailNotification.ok) {
    delivery = {
      ok: false,
      error: result.emailNotification.error,
      channel: "email" as const,
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
    orderId: result.orderRow.id,
    eventType: "payment_details_sent",
    actorType: "user",
    actorId: ctx.userId ?? ctx.firebaseUid ?? null,
    actorLabel: ctx.userEmail ?? "user",
    payload: {
      recipient: maskPhoneNumber(result.orderRow.customerPhone ?? null),
      deliveryChannel: delivery.channel,
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
      delivery_channel: delivery.channel,
      delivery_phone_source: delivery.recipientSource,
      delivery_identity_source: delivery.whatsappIdentitySource,
    },
  });

  return {
    ok: delivery.ok,
    error: delivery.error,
    deliveryChannel: delivery.channel,
    orderId: result.orderRow.id,
    windowExpiresAt: result.windowState.whatsappWindowExpiresAt,
  };
}

export async function regenerateInvoice(ctx: any, input: { orderId: string }) {
  const settings = await getBusinessOrderSettings(ctx.businessId);
  if (!settings.ticketToOrderEnabled) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket-to-order flow is disabled for this business." });
  }

  const lockKey = `${ctx.businessId}::order::${input.orderId}`;
  const now = new Date();
  const result = await withRedisWorkflowLock(lockKey, async () => {
    const [orderRow] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
      .limit(1);
    if (!orderRow) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
    }

    const artifact = await createOrderInvoiceForOrder({
      businessId: ctx.businessId,
      orderId: orderRow.id,
      forceRegenerate: true,
      deliveryMethod: null,
      trackingUrl: null,
    });
    if (!artifact) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Invoice generation returned no file." });
    }

    const [updatedOrder] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, orderRow.id)))
      .limit(1);
    if (!updatedOrder) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Order could not be reloaded after invoice generation." });
    }

    return {
      orderBefore: orderRow,
      orderAfter: updatedOrder,
      artifact,
    };
  });

  await logOrderEvent({
    businessId: ctx.businessId,
    orderId: result.orderAfter.id,
    eventType: "invoice_regenerated",
    actorType: "user",
    actorId: ctx.userId ?? ctx.firebaseUid ?? null,
    actorLabel: ctx.userEmail ?? "user",
    payload: {
      invoiceNumber: result.artifact.invoiceNumber,
      fileName: result.artifact.fileName,
      previousInvoiceStatus: result.orderBefore.invoiceStatus,
      deliveryMethod: null,
    },
  });

  await publishPortalEvent({
    businessId: ctx.businessId,
    entity: "order",
    op: "upsert",
    entityId: result.orderAfter.id,
    payload: {
      order: result.orderAfter as any,
    },
    createdAt: result.orderAfter.updatedAt ?? result.orderAfter.createdAt ?? now,
  });

  recordBusinessEvent({
    event: "order.invoice_regenerated",
    action: "regenerateInvoice",
    area: "order",
    businessId: ctx.businessId,
    entity: "order",
    entityId: result.orderAfter.id,
    userId: ctx.userId,
    actorId: ctx.firebaseUid ?? ctx.userId ?? null,
    actorType: "user",
    outcome: "success",
    status: result.orderAfter.invoiceStatus,
    attributes: {
      invoice_number: result.artifact.invoiceNumber,
      previous_invoice_status: result.orderBefore.invoiceStatus,
    },
  });

  return {
    orderId: result.orderAfter.id,
    invoiceNumber: result.artifact.invoiceNumber,
    invoiceUrl: result.artifact.url,
  };
}
