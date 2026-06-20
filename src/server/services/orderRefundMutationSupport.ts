/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { orders } from "../../../drizzle/schema";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import { drainBusinessOutbox, enqueueWhatsAppOutboxMessages } from "@/server/services/messageOutbox";
import { logOrderEvent } from "../services/orderFlow";
import {
  buildRefundStatusMessages,
  enforceOrderOperationThrottle,
  flushBusinessOutbox,
  getBusinessOrderSettings,
  resolveOrderNotificationContext,
  resolveRefundAmount,
} from "@/server/services/orderWorkflowSupport";
import { withRedisWorkflowLock } from "@/server/services/ticketWorkflowSupport";

export async function updateRefundStatus(
  ctx: any,
  input: {
    orderId: string;
    action: "mark_pending" | "mark_refunded" | "cancel";
    amount?: string;
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
      await enforceOrderOperationThrottle(tx, ctx, "updateRefundStatus", input.orderId);

    const [orderRow] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
      .limit(1);
    if (!orderRow) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
    }

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

    const [updatedOrder] = await tx
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

    const contactContext = await resolveOrderNotificationContext({
      businessId: ctx.businessId,
      customerId: updatedOrder.customerId ?? null,
      threadId: updatedOrder.threadId ?? null,
      channelIdentityId: updatedOrder.channelIdentityId ?? null,
      customerName: updatedOrder.customerName ?? null,
      customerEmail: updatedOrder.customerEmail ?? null,
      customerPhone: updatedOrder.customerPhone ?? null,
    });
    const notification = await enqueueWhatsAppOutboxMessages(tx, {
      businessId: ctx.businessId,
      entityType: "order",
      entityId: updatedOrder.id,
      customerId: updatedOrder.customerId ?? null,
      threadId: contactContext.threadId ?? null,
      channelIdentityId: contactContext.channelIdentityId ?? null,
      recipient: contactContext.approvalRecipient,
      recipientSource: contactContext.recipientSource,
      whatsappIdentitySource: contactContext.whatsappIdentitySource,
      source:
        input.action === "mark_pending"
          ? "order_refund_pending"
          : input.action === "mark_refunded"
            ? "order_refund_completed"
            : "order_refund_cancelled",
      idempotencyBaseKey: `order:${updatedOrder.id}:refund:${input.action}:${String(updatedOrder.updatedAt ?? now.toISOString())}`,
      messages: buildRefundStatusMessages({
        action: input.action,
        orderId: updatedOrder.id,
        paymentReference: updatedOrder.paymentReference,
        refundAmount: input.action === "cancel" ? null : nextRefundAmount,
        currency: String(updatedOrder.currency || "LKR").trim() || "LKR",
        reason: input.action === "cancel" ? null : nextRefundReason,
      }),
    });
      return { orderRow, updatedOrder, nextRefundAmount, nextRefundReason, nextStatus, eventType, notification };
    });
  });

  await logOrderEvent({
    businessId: ctx.businessId,
    orderId: result.updatedOrder.id,
    eventType: result.eventType,
    actorType: "user",
    actorId: ctx.userId ?? ctx.firebaseUid ?? null,
    actorLabel: ctx.userEmail ?? "user",
    payload: {
      reason: input.action === "cancel" ? null : result.nextRefundReason,
      refundAmount: input.action === "cancel" ? null : result.nextRefundAmount,
      previousStatus: result.orderRow.status,
      nextStatus: result.nextStatus,
    },
  });

  await publishPortalEvent({
    businessId: ctx.businessId,
    entity: "order",
    op: "upsert",
    entityId: result.updatedOrder.id,
    payload: { order: result.updatedOrder as any },
    createdAt: result.updatedOrder.updatedAt ?? result.updatedOrder.createdAt ?? now,
  });

  let delivery: {
    ok: boolean;
    error: string | null;
    recipientSource: string | null;
    whatsappIdentitySource: string | null;
  } = {
    ok: true,
    error: null,
    recipientSource: result.notification.recipientSource,
    whatsappIdentitySource: result.notification.whatsappIdentitySource,
  };
  if (!result.notification.ok) {
    delivery = {
      ok: false,
      error: result.notification.error,
      recipientSource: result.notification.recipientSource,
      whatsappIdentitySource: result.notification.whatsappIdentitySource,
    };
  } else if (result.notification.idempotencyKeys.length) {
    const drained = await drainBusinessOutbox({
      businessId: ctx.businessId,
      idempotencyKeys: result.notification.idempotencyKeys,
      limit: result.notification.idempotencyKeys.length,
    });
    delivery = {
      ok: drained.ok,
      error: drained.error,
      recipientSource: result.notification.recipientSource,
      whatsappIdentitySource: result.notification.whatsappIdentitySource,
    };
  }
  await flushBusinessOutbox(ctx.businessId);
  if (!delivery.ok) {
    await logOrderEvent({
      businessId: ctx.businessId,
      orderId: result.updatedOrder.id,
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
    entityId: result.updatedOrder.id,
    userId: ctx.userId,
    actorId: ctx.firebaseUid ?? ctx.userId ?? null,
    actorType: "user",
    outcome: delivery.ok ? "success" : "degraded",
    status: result.nextStatus,
    attributes: {
      previous_status: result.orderRow.status,
      refund_action: input.action,
      refund_amount: input.action === "cancel" ? null : result.nextRefundAmount,
      delivery_ok: delivery.ok,
      delivery_phone_source: delivery.recipientSource,
      delivery_identity_source: delivery.whatsappIdentitySource,
    },
  });

  return { order: result.updatedOrder, delivery };
}
