/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { orders } from "../../../drizzle/schema";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import {
  logOrderEvent,
} from "../services/orderFlow";
import {
  assertOrderAllowsFulfillmentUpdates,
  cleanOptionalText,
  cleanOptionalUrl,
  coalesceText,
  enforceOrderOperationThrottle,
  flushBusinessOutbox,
  getBusinessOrderSettings,
  nextFulfillmentTimestamps,
  parseOptionalDate,
} from "@/server/services/orderWorkflowSupport";
import {
  normalizeOrderFulfillmentStatus,
  ORDER_FULFILLMENT_STATUSES,
} from "@/lib/order-operations";
import {
  drainBusinessOutbox,
} from "@/server/services/messageOutbox";
import { withRedisWorkflowLock } from "@/server/services/ticketWorkflowSupport";
import { requiresDispatchData } from "@/server/services/orderFulfillmentUtils";

export async function updateFulfillment(
  ctx: any,
  input: {
    orderId: string;
    expectedUpdatedAt?: Date;
    fulfillmentStatus?: typeof ORDER_FULFILLMENT_STATUSES[number];
    recipientName?: string | null;
    recipientPhone?: string | null;
    shippingAddress?: string | null;
    deliveryArea?: string | null;
    deliveryNotes?: string | null;
    courierName?: string | null;
    trackingNumber?: string | null;
    trackingUrl?: string | null;
    dispatchReference?: string | null;
    scheduledDeliveryAt?: string | null;
    fulfillmentNotes?: string | null;
    notifyCustomer?: boolean;
    customerMessage?: string | null;
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
      await enforceOrderOperationThrottle(tx, ctx, "updateFulfillment", input.orderId);

    const [orderRow] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
      .limit(1);
    if (!orderRow) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
    }
    assertOrderAllowsFulfillmentUpdates(orderRow);
    const nextFulfillmentStatus = input.fulfillmentStatus
      ? normalizeOrderFulfillmentStatus(input.fulfillmentStatus)
      : normalizeOrderFulfillmentStatus(orderRow.fulfillmentStatus);
    const nextRecipientName = cleanOptionalText(
      input.recipientName === undefined ? orderRow.recipientName : input.recipientName,
      160,
    );
    const nextRecipientPhone = cleanOptionalText(
      input.recipientPhone === undefined ? orderRow.recipientPhone : input.recipientPhone,
      50,
    );
    const nextShippingAddress = cleanOptionalText(
      input.shippingAddress === undefined ? orderRow.shippingAddress : input.shippingAddress,
      1200,
    );
    const nextDeliveryArea = cleanOptionalText(
      input.deliveryArea === undefined ? orderRow.deliveryArea : input.deliveryArea,
      200,
    );
    const nextDeliveryNotes = cleanOptionalText(
      input.deliveryNotes === undefined ? orderRow.deliveryNotes : input.deliveryNotes,
      1200,
    );
    const nextCourierName = cleanOptionalText(
      input.courierName === undefined ? orderRow.courierName : input.courierName,
      160,
    );
    const nextTrackingNumber = cleanOptionalText(
      input.trackingNumber === undefined ? orderRow.trackingNumber : input.trackingNumber,
      160,
    );
    const nextTrackingUrl = cleanOptionalUrl(
      input.trackingUrl === undefined ? orderRow.trackingUrl : input.trackingUrl,
    );
    const nextDispatchReference = cleanOptionalText(
      input.dispatchReference === undefined ? orderRow.dispatchReference : input.dispatchReference,
      200,
    );
    const nextScheduledDeliveryAt =
      input.scheduledDeliveryAt === undefined
        ? orderRow.scheduledDeliveryAt
        : parseOptionalDate(input.scheduledDeliveryAt);
    const nextFulfillmentNotes = cleanOptionalText(
      input.fulfillmentNotes === undefined ? orderRow.fulfillmentNotes : input.fulfillmentNotes,
      1200,
    );

    if (requiresDispatchData(nextFulfillmentStatus) && !coalesceText(nextCourierName, nextTrackingNumber, nextDispatchReference)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Add courier name, tracking number, or dispatch reference before moving an order into transit.",
      });
    }
    if (requiresDispatchData(nextFulfillmentStatus) && !nextShippingAddress) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Add the delivery address before dispatching the order.",
      });
    }
    if (requiresDispatchData(nextFulfillmentStatus) && !coalesceText(nextRecipientPhone, orderRow.customerPhone)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Add the recipient phone before dispatching the order.",
      });
    }
    if (nextFulfillmentStatus === "delivered" && !coalesceText(nextRecipientName, orderRow.customerName)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Add the recipient name before marking the order delivered.",
      });
    }

    const statusChanged =
      normalizeOrderFulfillmentStatus(orderRow.fulfillmentStatus) !== nextFulfillmentStatus;
    const nextTimestamps = nextFulfillmentTimestamps({
      currentStatus: orderRow.fulfillmentStatus,
      nextStatus: nextFulfillmentStatus as any,
      now,
      existing: orderRow,
    });

    const [updatedOrder] = await tx
      .update(orders)
      .set({
        fulfillmentStatus: nextFulfillmentStatus,
        fulfillmentUpdatedAt: nextTimestamps.fulfillmentUpdatedAt ?? orderRow.fulfillmentUpdatedAt,
        recipientName: nextRecipientName,
        recipientPhone: nextRecipientPhone,
        shippingAddress: nextShippingAddress,
        deliveryArea: nextDeliveryArea,
        deliveryNotes: nextDeliveryNotes,
        courierName: nextCourierName,
        trackingNumber: nextTrackingNumber,
        trackingUrl: nextTrackingUrl,
        dispatchReference: nextDispatchReference,
        scheduledDeliveryAt: nextScheduledDeliveryAt,
        fulfillmentNotes: nextFulfillmentNotes,
        packedAt: nextTimestamps.packedAt,
        dispatchedAt: nextTimestamps.dispatchedAt,
        outForDeliveryAt: nextTimestamps.outForDeliveryAt,
        deliveredAt: nextTimestamps.deliveredAt,
        failedDeliveryAt: nextTimestamps.failedDeliveryAt,
        returnedAt: nextTimestamps.returnedAt,
        updatedAt: now,
      })
      .where(and(eq(orders.id, orderRow.id), eq(orders.businessId, ctx.businessId)))
      .returning();

    if (!updatedOrder) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to update order fulfillment.",
      });
    }

    // Customers now use the public order tracking link sent with the invoice; fulfillment updates stay internal.
    const shouldNotifyCustomer = false;
    const notification: {
      ok: boolean;
      error: string | null;
      recipientSource: string | null;
      whatsappIdentitySource: string | null;
      idempotencyKeys: string[];
    } = {
      ok: true,
      error: null as string | null,
      recipientSource: null as string | null,
      whatsappIdentitySource: null as string | null,
      idempotencyKeys: [] as string[],
    };
    const emailNotification: {
      ok: boolean;
      error: string | null;
      idempotencyKeys: string[];
    } = {
      ok: true,
      error: null as string | null,
      idempotencyKeys: [] as string[],
    };
    return {
      orderRow,
      updatedOrder,
      nextFulfillmentStatus,
      nextRecipientName,
      nextCourierName,
      nextTrackingNumber,
      nextDispatchReference,
      nextScheduledDeliveryAt,
      statusChanged,
      shouldNotifyCustomer,
      notification,
      emailNotification,
    };
  });
  });

  await logOrderEvent({
    businessId: ctx.businessId,
    orderId: result.updatedOrder.id,
    eventType: result.statusChanged ? "fulfillment_status_changed" : "fulfillment_details_updated",
    actorType: "user",
    actorId: ctx.userId ?? ctx.firebaseUid ?? null,
    actorLabel: ctx.userEmail ?? "user",
    payload: {
      previousStatus: result.orderRow.fulfillmentStatus,
      nextStatus: result.nextFulfillmentStatus,
      courierName: result.nextCourierName,
      trackingNumber: result.nextTrackingNumber,
      dispatchReference: result.nextDispatchReference,
      scheduledDeliveryAt: result.nextScheduledDeliveryAt ? new Date(result.nextScheduledDeliveryAt).toISOString() : null,
    },
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
  if (result.emailNotification.ok && result.emailNotification.idempotencyKeys.length) {
    await drainBusinessOutbox({
      businessId: ctx.businessId,
      idempotencyKeys: result.emailNotification.idempotencyKeys,
      limit: result.emailNotification.idempotencyKeys.length,
    });
  }
  await flushBusinessOutbox(ctx.businessId);
  if (result.shouldNotifyCustomer && !delivery.ok) {
    await logOrderEvent({
      businessId: ctx.businessId,
      orderId: result.updatedOrder.id,
      eventType: "fulfillment_notification_failed",
      actorType: "system",
      actorLabel: "bot",
      payload: {
        fulfillmentStatus: result.nextFulfillmentStatus,
        error: delivery.error,
      },
    });
  }

  await publishPortalEvent({
    businessId: ctx.businessId,
    entity: "order",
    op: "upsert",
    entityId: result.updatedOrder.id,
    payload: { order: result.updatedOrder as any },
    createdAt: result.updatedOrder.updatedAt ?? now,
  });

  recordBusinessEvent({
    event: "order.fulfillment_updated",
    action: "updateFulfillment",
    area: "order",
    businessId: ctx.businessId,
    entity: "order",
    entityId: result.updatedOrder.id,
    userId: ctx.userId,
    actorId: ctx.firebaseUid ?? ctx.userId ?? null,
    actorType: "user",
    outcome: delivery.ok ? "success" : "degraded",
    status: result.nextFulfillmentStatus,
    attributes: {
      previous_status: result.orderRow.fulfillmentStatus,
      courier_name_present: Boolean(result.nextCourierName),
      tracking_number_present: Boolean(result.nextTrackingNumber),
      notify_customer: result.shouldNotifyCustomer,
      delivery_ok: delivery.ok,
    },
  });

  return { order: result.updatedOrder, delivery };
}
