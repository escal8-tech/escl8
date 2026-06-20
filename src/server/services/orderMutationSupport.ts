/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { customers, orders, supportTickets } from "../../../drizzle/schema";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import {
  buildOrderApprovalEmail,
  buildOrderApprovalMessages,
  formatOrderItemsSummary,
  logOrderEvent,
  missingRequiredOrderDeliveryFields,
  parseMoneyValue,
  sanitizePhoneDigits,
} from "../services/orderFlow";
import {
  assertOrderAllowsFulfillmentUpdates,
  assertPaymentSetupEditable,
  asRecord,
  buildStoredOrderFlowSettings,
  canResendPaymentDetails,
  cleanOptionalText,
  cleanOptionalUrl,
  coalesceText,
  enforceOrderOperationThrottle,
  flushBusinessOutbox,
  getBusinessOrderSettings,
  getThreadWhatsappWindowState,
  lockWorkflowKey,
  maskPhoneNumber,
  nextFulfillmentTimestamps,
  parseOptionalDate,
  resolveOrderNotificationContext,
  requiresDispatchData,
} from "@/server/services/orderWorkflowSupport";
import {
  extractCustomerEmail,
  logTicketEvent,
  publishHydratedTicketUpsert,
  sanitizeTicketFields,
} from "@/server/services/ticketWorkflowSupport";
import {
  ORDER_FULFILLMENT_STATUSES,
  normalizeOrderFulfillmentStatus,
} from "@/lib/order-operations";
import {
  enqueueWhatsAppOutboxMessages,
  enqueueEmailOutboxMessages,
  drainBusinessOutbox,
} from "@/server/services/messageOutbox";
import { isStaffManualOrder, resolveFulfillmentPrefill } from "@/server/services/orderMutationUtils";
export * from "./orderMutationUtils";

export async function updateDraftOrder(
  ctx: any,
  input: {
    orderId: string;
    expectedUpdatedAt?: Date;
    title?: string | null;
    summary?: string | null;
    notes?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    customerEmail?: string | null;
    fields?: Record<string, unknown>;
  }
) {
  const now = new Date();
  const [orderRow] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
    .limit(1);
  if (!orderRow) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
  }
  if (String(orderRow.status || "").trim().toLowerCase() !== "pending_approval") {
    assertPaymentSetupEditable(orderRow);
  }
  const snapshot = asRecord(orderRow.ticketSnapshot);
  const baseFields = asRecord(snapshot.fields);
  const nextFieldsSeed = sanitizeTicketFields(input.fields ?? baseFields);
  const nextCustomerName = input.customerName === undefined
    ? cleanOptionalText(orderRow.customerName, 160)
    : cleanOptionalText(input.customerName, 160);
  const nextCustomerPhone = input.customerPhone === undefined
    ? cleanOptionalText(orderRow.customerPhone, 64)
    : cleanOptionalText(input.customerPhone, 64);
  const nextCustomerEmail = input.customerEmail === undefined
    ? cleanOptionalText(orderRow.customerEmail ?? extractCustomerEmail(nextFieldsSeed), 320)
    : cleanOptionalText(input.customerEmail, 320);
  const nextTitle = input.title === undefined
    ? cleanOptionalText(typeof snapshot.title === "string" ? snapshot.title : null, 240)
    : cleanOptionalText(input.title, 240);
  const nextSummary = input.summary === undefined
    ? cleanOptionalText(typeof snapshot.summary === "string" ? snapshot.summary : null, 1200)
    : cleanOptionalText(input.summary, 1200);
  const nextNotes = input.notes === undefined
    ? cleanOptionalText(orderRow.notes ?? (typeof snapshot.notes === "string" ? snapshot.notes : null), 1200)
    : cleanOptionalText(input.notes, 1200);

  const nextFields: Record<string, unknown> = { ...nextFieldsSeed };
  if (nextCustomerName) nextFields.name = nextCustomerName;
  else delete nextFields.name;
  if (nextCustomerEmail) {
    nextFields.email = nextCustomerEmail;
    nextFields.customerEmail = nextCustomerEmail;
  } else {
    delete nextFields.email;
    delete nextFields.customerEmail;
  }

  const ticketSnapshot = {
    ...snapshot,
    ticketId: orderRow.supportTicketId ?? snapshot.ticketId ?? null,
    title: nextTitle,
    summary: nextSummary,
    fields: nextFields,
    notes: nextNotes,
    priority: snapshot.priority ?? null,
  };

  const result = await db.transaction(async (tx) => {
    const [updatedOrder] = await tx
      .update(orders)
      .set({
        customerName: nextCustomerName,
        customerPhone: nextCustomerPhone,
        customerEmail: nextCustomerEmail,
        ticketSnapshot,
        notes: nextNotes,
        updatedAt: now,
      })
      .where(eq(orders.id, orderRow.id))
      .returning();

    if (!updatedOrder) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to update draft order.",
      });
    }

    let updatedTicketId: string | null = null;
    if (orderRow.supportTicketId) {
      const [updatedTicket] = await tx
        .update(supportTickets)
        .set({
          title: nextTitle,
          summary: nextSummary,
          notes: nextNotes,
          customerName: nextCustomerName,
          customerPhone: nextCustomerPhone,
          fields: nextFields,
          updatedAt: now,
        })
        .where(and(eq(supportTickets.id, orderRow.supportTicketId), eq(supportTickets.businessId, ctx.businessId)))
        .returning({ id: supportTickets.id });
      updatedTicketId = updatedTicket?.id ?? null;
    }

    if (orderRow.customerId) {
      await tx
        .update(customers)
        .set({
          name: nextCustomerName,
          phone: nextCustomerPhone,
          email: nextCustomerEmail,
          updatedAt: now,
        })
        .where(and(eq(customers.businessId, ctx.businessId), eq(customers.id, orderRow.customerId)));
    }

    return { updatedOrder, updatedTicketId };
  });

  await logOrderEvent({
    businessId: ctx.businessId,
    orderId: result.updatedOrder.id,
    eventType: "draft_updated",
    actorType: "user",
    actorId: ctx.userId ?? ctx.firebaseUid ?? null,
    actorLabel: ctx.userEmail ?? "user",
    payload: {
      customerEmail: result.updatedOrder.customerEmail,
      customerName: result.updatedOrder.customerName,
      customerPhone: result.updatedOrder.customerPhone,
    },
  });

  if (result.updatedTicketId) {
    await logTicketEvent({
      businessId: ctx.businessId,
      ticketId: result.updatedTicketId,
      eventType: "edited",
      actorType: "user",
      actorId: ctx.userId ?? ctx.firebaseUid ?? null,
      actorLabel: ctx.userEmail ?? "user",
      payload: {
        syncedFromOrderDraft: true,
        fieldsUpdated: Object.keys(nextFields),
      },
    });
  }

  await Promise.all([
    publishPortalEvent({
      businessId: ctx.businessId,
      entity: "order",
      op: "upsert",
      entityId: result.updatedOrder.id,
      payload: { order: result.updatedOrder as any },
      createdAt: result.updatedOrder.updatedAt ?? now,
    }),
    result.updatedTicketId
      ? publishHydratedTicketUpsert({
          businessId: ctx.businessId,
          ticketId: result.updatedTicketId,
          createdAt: now,
        })
      : Promise.resolve(null),
  ]);

  recordBusinessEvent({
    event: "order.draft_updated",
    action: "updateDraftOrder",
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
      support_ticket_id: orderRow.supportTicketId,
      ticket_synced: Boolean(result.updatedTicketId),
    },
  });

  return result.updatedOrder;
}

export async function updatePaymentSetup(
  ctx: any,
  input: {
    orderId: string;
    expectedUpdatedAt?: Date;
    expectedAmount?: string | null;
    paymentReference?: string | null;
    customerEmail?: string | null;
    notes?: string | null;
  }
) {
  const now = new Date();
  const [orderRow] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, input.orderId)))
    .limit(1);
  if (!orderRow) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
  }
  assertPaymentSetupEditable(orderRow);
  const nextExpectedAmount = input.expectedAmount === undefined
    ? orderRow.expectedAmount?.toString() ?? null
    : parseMoneyValue(input.expectedAmount);
  const nextPaymentReference = input.paymentReference === undefined
    ? cleanOptionalText(orderRow.paymentReference, 120)
    : cleanOptionalText(input.paymentReference, 120);
  const nextCustomerEmail = input.customerEmail === undefined
    ? cleanOptionalText(orderRow.customerEmail, 320)
    : cleanOptionalText(input.customerEmail, 320);
  const nextNotes = input.notes === undefined
    ? cleanOptionalText(orderRow.notes, 1200)
    : cleanOptionalText(input.notes, 1200);

  const [updatedOrder] = await db
    .update(orders)
    .set({
      expectedAmount: nextExpectedAmount,
      paymentReference: nextPaymentReference,
      customerEmail: nextCustomerEmail,
      notes: nextNotes,
      updatedAt: now,
    })
    .where(eq(orders.id, orderRow.id))
    .returning();

  if (!updatedOrder) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update order.",
    });
  }

  await logOrderEvent({
    businessId: ctx.businessId,
    orderId: updatedOrder.id,
    eventType: "payment_setup_updated",
    actorType: "user",
    actorId: ctx.userId ?? ctx.firebaseUid ?? null,
    actorLabel: ctx.userEmail ?? "user",
    payload: {
      expectedAmount: updatedOrder.expectedAmount,
      paymentReference: updatedOrder.paymentReference,
      customerEmail: updatedOrder.customerEmail,
    },
  });

  await publishPortalEvent({
    businessId: ctx.businessId,
    entity: "order",
    op: "upsert",
    entityId: updatedOrder.id,
    payload: { order: updatedOrder as any },
    createdAt: updatedOrder.updatedAt ?? now,
  });

  return updatedOrder;
}

export async function sendPaymentDetails(ctx: any, input: { orderId: string }) {
  const settings = await getBusinessOrderSettings(ctx.businessId);
  if (!settings.ticketToOrderEnabled) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket-to-order flow is disabled for this business." });
  }
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    await lockWorkflowKey(tx, `${ctx.businessId}::order::${input.orderId}`);
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

export * from "./orderPaymentMutationSupport";

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
  const result = await db.transaction(async (tx) => {
    await lockWorkflowKey(tx, `${ctx.businessId}::order::${input.orderId}`);
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
      .where(eq(orders.id, orderRow.id))
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

