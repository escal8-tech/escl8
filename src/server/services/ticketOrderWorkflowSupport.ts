/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  businesses,
  customers,
  orders,
  orderPayments,
  supportTickets,
} from "../../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { resolveInitialFulfillmentStatus } from "@/lib/order-operations";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { drainBusinessOutbox, enqueueEmailOutboxMessages, enqueueWhatsAppOutboxMessages } from "@/server/services/messageOutbox";
import {
  buildOrderApprovalEmail,
  buildOrderApprovalMessages,
  buildOrderDeliveryDetailsRequestMessages,
  computeOrderExpectedAmount,
  extractOrderFulfillmentSeed,
  formatOrderItemsSummary,
  logOrderEvent,
  missingRequiredOrderDeliveryFields,
  sanitizePhoneDigits,
} from "../services/orderFlow";
import {
  asRecord,
  assertTicketAwaitingOrderDecision,
  buildOrderDenialMessages,
  coalesceText,
  enforceOrderTicketOperationThrottle,
  extractCustomerEmail,
  flushBusinessOutbox,
  getThreadWhatsappWindowState,
  logTicketEvent,
  maskPhoneNumber,
  publishHydratedTicketUpsert,
  resolveTicketContactContext,
  validateTicketOrderFlow,
  withRedisWorkflowLock,
} from "@/server/services/ticketWorkflowSupport";
import { getBusinessOrderSettingsRecord } from "@/server/services/businessSettingsStore";

export async function approveOrderTicket(
  ctx: any,
  input: { id: string; expectedUpdatedAt?: Date }
) {
  const [biz] = await db
    .select({ settings: businesses.settings })
    .from(businesses)
    .where(eq(businesses.id, ctx.businessId))
    .limit(1);
  const orderSettings = await getBusinessOrderSettingsRecord(ctx.businessId, biz?.settings);

  const [ticket] = await db
    .select({
      id: supportTickets.id,
      businessId: supportTickets.businessId,
      ticketTypeKey: supportTickets.ticketTypeKey,
      status: supportTickets.status,
      outcome: supportTickets.outcome,
      source: supportTickets.source,
      customerId: supportTickets.customerId,
      threadId: supportTickets.threadId,
      channelIdentityId: supportTickets.channelIdentityId,
      customerName: supportTickets.customerName,
      customerPhone: supportTickets.customerPhone,
      title: supportTickets.title,
      summary: supportTickets.summary,
      fields: supportTickets.fields,
      notes: supportTickets.notes,
      priority: supportTickets.priority,
      createdBy: supportTickets.createdBy,
      createdAt: supportTickets.createdAt,
      updatedAt: supportTickets.updatedAt,
    })
    .from(supportTickets)
    .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
    .limit(1);

  if (!ticket) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
  }
  validateTicketOrderFlow({
    ticketTypeKey: ticket.ticketTypeKey,
    ticketFlowEnabled: orderSettings.ticketToOrderEnabled,
  });
  assertTicketAwaitingOrderDecision({
    status: ticket.status,
    outcome: ticket.outcome,
  });

  const fields = asRecord(ticket.fields);
  const suppressCustomerNotifications =
    String(ticket.source || "").trim().toLowerCase() === "staff_manual" ||
    fields.manual_order === true ||
    fields.suppress_customer_notifications === true;
  const requestedCustomerEmail = extractCustomerEmail(fields);
  const itemsSummary = formatOrderItemsSummary(fields);
  const expectedAmount = computeOrderExpectedAmount(fields);
  if (orderSettings.paymentMethod === "bank_qr" && !expectedAmount) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Bank or QR order approval requires a verified payable amount.",
    });
  }
  const contactContext = await resolveTicketContactContext({
    businessId: ctx.businessId,
    customerId: ticket.customerId,
    threadId: ticket.threadId,
    channelIdentityId: ticket.channelIdentityId,
    customerName: ticket.customerName,
    customerPhone: ticket.customerPhone,
  });
  const customerEmail = coalesceText(requestedCustomerEmail, contactContext.customerEmail);
  const approvalRecipient = sanitizePhoneDigits(contactContext.approvalRecipient);
  const now = new Date();
  const initialFulfillmentStatus = resolveInitialFulfillmentStatus(orderSettings.paymentMethod);
  const ticketSnapshot = {
    ticketId: ticket.id,
    title: ticket.title ?? null,
    summary: ticket.summary ?? null,
    fields,
    notes: ticket.notes ?? null,
    priority: ticket.priority ?? null,
  };

  const result = await withRedisWorkflowLock(`${ctx.businessId}::ticket::${ticket.id}`, async () => {
    return await db.transaction(async (tx) => {
      await enforceOrderTicketOperationThrottle(tx, ctx, "approve", ticket.id);

    const [currentTicket] = await tx
      .select({
        id: supportTickets.id,
        ticketTypeKey: supportTickets.ticketTypeKey,
        status: supportTickets.status,
        outcome: supportTickets.outcome,
      })
      .from(supportTickets)
      .where(and(eq(supportTickets.id, ticket.id), eq(supportTickets.businessId, ctx.businessId)))
      .limit(1);
    if (!currentTicket) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
    }
    validateTicketOrderFlow({
      ticketTypeKey: currentTicket.ticketTypeKey,
      ticketFlowEnabled: orderSettings.ticketToOrderEnabled,
    });
    assertTicketAwaitingOrderDecision({
      status: currentTicket.status,
      outcome: currentTicket.outcome,
    });
    const windowState = await getThreadWhatsappWindowState(tx, contactContext.threadId);
    const shouldSendApprovalViaWhatsapp = !suppressCustomerNotifications && windowState.whatsappWindowOpen;
    if (shouldSendApprovalViaWhatsapp && (!contactContext.channelIdentityId || !approvalRecipient)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Ticket is missing WhatsApp routing details for payment delivery.",
      });
    }

    const [existingOrder] = await tx
      .select({
        id: orders.id,
        status: orders.status,
        paymentReference: orders.paymentReference,
        customerEmail: orders.customerEmail,
      })
      .from(orders)
      .where(and(eq(orders.businessId, ctx.businessId), eq(orders.supportTicketId, ticket.id)))
      .limit(1);
    if (existingOrder && !["pending_approval", "edit_required"].includes(String(existingOrder.status || "").trim().toLowerCase())) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Ticket already has a linked order (${existingOrder.status || "existing"}) and cannot be approved again.`,
      });
    }
    const effectiveCustomerEmail = coalesceText(customerEmail, existingOrder?.customerEmail);
    if (!suppressCustomerNotifications && !shouldSendApprovalViaWhatsapp && !effectiveCustomerEmail) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Order approval requires the customer's email after the WhatsApp window closes.",
      });
    }

    const fulfillmentSeed = extractOrderFulfillmentSeed({
      fields,
      customerName: contactContext.customerName ?? ticket.customerName,
      customerPhone: contactContext.customerPhone ?? ticket.customerPhone,
      useContactFallback: !shouldSendApprovalViaWhatsapp,
    });
    const missingDeliveryFields =
      shouldSendApprovalViaWhatsapp && orderSettings.paymentMethod === "bank_qr"
        ? missingRequiredOrderDeliveryFields({
            recipientName: fulfillmentSeed.recipientName,
            recipientPhone: fulfillmentSeed.recipientPhone,
            shippingAddress: fulfillmentSeed.shippingAddress,
          })
        : [];
    const shouldCollectDeliveryDetails =
      shouldSendApprovalViaWhatsapp &&
      orderSettings.paymentMethod === "bank_qr" &&
      missingDeliveryFields.length > 0;
    const nextOrderStatus =
      shouldCollectDeliveryDetails
        ? "approved"
        : orderSettings.paymentMethod === "bank_qr"
          ? "awaiting_payment"
          : "approved";

    const orderId = existingOrder?.id ?? randomUUID();
    const paymentReference =
      orderSettings.paymentMethod === "bank_qr"
        ? coalesceText(existingOrder?.paymentReference, `ORD-${orderId.slice(0, 8).toUpperCase()}`)
        : null;
    const paymentConfigSnapshot = {
      paymentMethod: orderSettings.paymentMethod,
      currency: orderSettings.currency,
      bankQr: orderSettings.bankQr,
      deliveryDetailsCollectionRequired: shouldCollectDeliveryDetails,
      deliveryDetailsMissingFields: missingDeliveryFields,
    };

    const baseOrderValues = {
      businessId: ctx.businessId,
      supportTicketId: ticket.id,
      source: ticket.source || "whatsapp",
      customerId: contactContext.customerId,
      threadId: contactContext.threadId,
      channelIdentityId: contactContext.channelIdentityId,
      customerName: contactContext.customerName,
      customerPhone: contactContext.customerPhone,
      customerEmail: effectiveCustomerEmail,
      status: nextOrderStatus,
      fulfillmentStatus: initialFulfillmentStatus,
      fulfillmentUpdatedAt: now,
      recipientName: fulfillmentSeed.recipientName,
      recipientPhone: fulfillmentSeed.recipientPhone,
      shippingAddress: fulfillmentSeed.shippingAddress,
      deliveryArea: fulfillmentSeed.deliveryArea,
      deliveryNotes: fulfillmentSeed.deliveryNotes,
      paymentMethod: orderSettings.paymentMethod,
      currency: orderSettings.currency,
      expectedAmount,
      paymentReference,
      ticketSnapshot,
      paymentConfigSnapshot,
      notes: ticket.notes?.trim() || null,
      approvedAt: now,
      updatedAt: now,
    } as const;

    const [orderRow] = existingOrder
      ? await tx
          .update(orders)
          .set(baseOrderValues)
          .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, existingOrder.id)))
          .returning()
      : await tx
          .insert(orders)
          .values({
            id: orderId,
            ...baseOrderValues,
          })
          .returning();

    if (contactContext.customerId && effectiveCustomerEmail) {
      await tx
        .update(customers)
        .set({
          email: effectiveCustomerEmail,
          updatedAt: now,
        })
        .where(and(eq(customers.businessId, ctx.businessId), eq(customers.id, contactContext.customerId)));
    }

    let resumedCustomer: typeof customers.$inferSelect | null = null;
    let previousCustomerBotPaused = false;
    if (contactContext.customerId) {
      const [existingCustomer] = await tx
        .select({
          botPaused: customers.botPaused,
        })
        .from(customers)
        .where(and(eq(customers.businessId, ctx.businessId), eq(customers.id, contactContext.customerId)))
        .limit(1);
      previousCustomerBotPaused = Boolean(existingCustomer?.botPaused);
      if (previousCustomerBotPaused) {
        [resumedCustomer] = await tx
          .update(customers)
          .set({
            botPaused: false,
            updatedAt: now,
          })
          .where(and(eq(customers.businessId, ctx.businessId), eq(customers.id, contactContext.customerId)))
          .returning();
      }
    }

    const [ticketRow] = await tx
      .update(supportTickets)
      .set({
        customerId: contactContext.customerId,
        threadId: contactContext.threadId,
        channelIdentityId: contactContext.channelIdentityId,
        customerName: contactContext.customerName,
        customerPhone: contactContext.customerPhone,
        status: "resolved",
        outcome: "won",
        lossReason: null,
        resolvedAt: now,
        closedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(supportTickets.id, ticket.id),
          eq(supportTickets.businessId, ctx.businessId),
        ),
      )
      .returning();

    if (!ticketRow) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to approve order ticket.",
      });
    }

    const approvalMessages = buildOrderApprovalMessages({
      orderId: orderRow?.id ?? orderId,
      customerName: contactContext.customerName ?? ticket.customerName,
      itemsSummary,
      expectedAmount,
      paymentReference: orderRow?.paymentReference ?? paymentReference,
      orderSettings,
    });
    const deliveryDetailsMessages = buildOrderDeliveryDetailsRequestMessages({
      orderId: orderRow?.id ?? orderId,
      itemsSummary,
      expectedAmount,
      currency: orderSettings.currency,
      missingFields: missingDeliveryFields,
    });
    const approvalEmail = buildOrderApprovalEmail({
      orderId: orderRow?.id ?? orderId,
      customerName: contactContext.customerName ?? ticket.customerName,
      itemsSummary,
      expectedAmount,
      paymentReference: orderRow?.paymentReference ?? paymentReference,
      orderSettings,
    });
    const notification = shouldSendApprovalViaWhatsapp
      ? await enqueueWhatsAppOutboxMessages(tx, {
          businessId: ctx.businessId,
          entityType: "order",
          entityId: orderRow?.id ?? orderId,
          customerId: contactContext.customerId,
          threadId: contactContext.threadId,
          channelIdentityId: contactContext.channelIdentityId,
          recipient: contactContext.approvalRecipient,
          recipientSource: contactContext.recipientSource,
          whatsappIdentitySource: contactContext.whatsappIdentitySource,
          source: "order_ticket_approval",
          idempotencyBaseKey: `order_ticket:${ticket.id}:approval:${orderRow?.id ?? orderId}`,
          messages: shouldCollectDeliveryDetails ? deliveryDetailsMessages : approvalMessages,
        })
      : {
          ok: true as const,
          error: null,
          recipientSource: null,
          whatsappIdentitySource: null,
          idempotencyKeys: [] as string[],
        };
    const emailNotification = shouldSendApprovalViaWhatsapp || suppressCustomerNotifications
      ? {
          ok: true as const,
          error: null,
          idempotencyKeys: [] as string[],
        }
      : await enqueueEmailOutboxMessages(tx, {
          businessId: ctx.businessId,
          entityType: "order",
          entityId: orderRow?.id ?? orderId,
          customerId: contactContext.customerId,
          recipientEmail: effectiveCustomerEmail,
          source: "order_ticket_approval_email",
          idempotencyBaseKey: `order_ticket:${ticket.id}:approval_email:${orderRow?.id ?? orderId}`,
          messages: [approvalEmail],
        });
    const deliveryChannel: "whatsapp" | "email" | "none" = suppressCustomerNotifications
      ? "none"
      : shouldSendApprovalViaWhatsapp
        ? "whatsapp"
        : "email";

    return {
      order: orderRow ?? null,
      ticket: ticketRow ?? null,
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

  if (!result.order || !result.ticket) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to approve order ticket." });
  }

  await Promise.all([
    logTicketEvent({
      businessId: ctx.businessId,
      ticketId: result.ticket.id,
      eventType: "order_approved",
      actorType: "user",
      actorId: ctx.userId ?? ctx.firebaseUid ?? null,
      actorLabel: ctx.userEmail ?? "user",
      payload: {
        orderId: result.order.id,
        orderStatus: result.order.status,
        paymentMethod: result.order.paymentMethod,
      },
    }),
    logOrderEvent({
      businessId: ctx.businessId,
      orderId: result.order.id,
      eventType: "approved",
      actorType: "user",
      actorId: ctx.userId ?? ctx.firebaseUid ?? null,
      actorLabel: ctx.userEmail ?? "user",
      payload: {
        supportTicketId: result.ticket.id,
        paymentMethod: result.order.paymentMethod,
        expectedAmount: result.order.expectedAmount,
        recipient: maskPhoneNumber(approvalRecipient),
        recipientSource: contactContext.recipientSource,
        whatsappIdentitySource: contactContext.whatsappIdentitySource,
        suppressCustomerNotifications,
      },
    }),
  ]);

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
  if (!delivery.ok) {
    await logOrderEvent({
      businessId: ctx.businessId,
      orderId: result.order.id,
      eventType: orderSettings.paymentMethod === "bank_qr"
        ? "payment_instructions_delivery_failed"
        : "order_approval_notification_failed",
      actorType: "system",
      actorLabel: "bot",
      payload: {
        error: delivery.error,
      },
    });
  }

  const [realtimeTicket] = await Promise.all([
    publishHydratedTicketUpsert({
      businessId: ctx.businessId,
      ticketId: result.ticket.id,
      createdAt: result.ticket.updatedAt ?? now,
    }),
    publishPortalEvent({
      businessId: ctx.businessId,
      entity: "order",
      op: "upsert",
      entityId: result.order.id,
      payload: { order: result.order as any },
      createdAt: result.order.updatedAt ?? now,
    }),
  ]);
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
    event: "ticket.order_approved",
    action: "approveOrderTicket",
    area: "ticket",
    businessId: ctx.businessId,
    entity: "ticket",
    entityId: result.ticket.id,
    userId: ctx.userId,
    actorId: ctx.firebaseUid ?? ctx.userId ?? null,
    actorType: "user",
    outcome: delivery.ok ? "success" : "degraded",
    status: result.order.status,
    attributes: {
      delivery_ok: delivery.ok,
      delivery_channel: delivery.channel,
      order_id: result.order.id,
      payment_method: result.order.paymentMethod,
      suppress_customer_notifications: suppressCustomerNotifications,
      delivery_phone_source: delivery.recipientSource,
      delivery_identity_source: delivery.whatsappIdentitySource,
    },
  });

  return {
    ticket: realtimeTicket ?? result.ticket,
    order: result.order,
    delivery,
  };
}

export async function denyOrderTicket(
  ctx: any,
  input: { id: string; expectedUpdatedAt?: Date; reason?: string }
) {
  const [biz] = await db
    .select({ settings: businesses.settings })
    .from(businesses)
    .where(eq(businesses.id, ctx.businessId))
    .limit(1);
  const orderSettings = await getBusinessOrderSettingsRecord(ctx.businessId, biz?.settings);

  const [ticket] = await db
    .select({
      id: supportTickets.id,
      businessId: supportTickets.businessId,
      ticketTypeKey: supportTickets.ticketTypeKey,
      status: supportTickets.status,
      outcome: supportTickets.outcome,
      source: supportTickets.source,
      customerId: supportTickets.customerId,
      threadId: supportTickets.threadId,
      channelIdentityId: supportTickets.channelIdentityId,
      customerName: supportTickets.customerName,
      customerPhone: supportTickets.customerPhone,
      notes: supportTickets.notes,
      updatedAt: supportTickets.updatedAt,
    })
    .from(supportTickets)
    .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
    .limit(1);
  if (!ticket) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
  }
  validateTicketOrderFlow({
    ticketTypeKey: ticket.ticketTypeKey,
    ticketFlowEnabled: orderSettings.ticketToOrderEnabled,
  });
  assertTicketAwaitingOrderDecision({
    status: ticket.status,
    outcome: ticket.outcome,
  });

  const now = new Date();
  const normalizedReason = input.reason?.trim() || "Denied";
  const contactContext = await resolveTicketContactContext({
    businessId: ctx.businessId,
    customerId: ticket.customerId,
    threadId: ticket.threadId,
    channelIdentityId: ticket.channelIdentityId,
    customerName: ticket.customerName,
    customerPhone: ticket.customerPhone,
  });
  const result = await withRedisWorkflowLock(`${ctx.businessId}::ticket::${input.id}`, async () => {
    return await db.transaction(async (tx) => {
      await enforceOrderTicketOperationThrottle(tx, ctx, "deny", input.id);

    const [currentTicket] = await tx
      .select({
        id: supportTickets.id,
        ticketTypeKey: supportTickets.ticketTypeKey,
        status: supportTickets.status,
        outcome: supportTickets.outcome,
      })
      .from(supportTickets)
      .where(and(eq(supportTickets.id, input.id), eq(supportTickets.businessId, ctx.businessId)))
      .limit(1);
    if (!currentTicket) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
    }
    validateTicketOrderFlow({
      ticketTypeKey: currentTicket.ticketTypeKey,
      ticketFlowEnabled: orderSettings.ticketToOrderEnabled,
    });
    assertTicketAwaitingOrderDecision({
      status: currentTicket.status,
      outcome: currentTicket.outcome,
    });

    const [existingOrder] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.businessId, ctx.businessId), eq(orders.supportTicketId, input.id)))
      .limit(1);
    let deniedOrder: typeof orders.$inferSelect | null = null;
    if (existingOrder) {
      await tx
        .update(orderPayments)
        .set({
          status: "rejected",
          aiCheckNotes: normalizedReason,
          updatedAt: now,
        })
        .where(
          and(
            eq(orderPayments.businessId, ctx.businessId),
            eq(orderPayments.orderId, existingOrder.id),
            eq(orderPayments.status, "submitted"),
          ),
        );

      const [updatedOrder] = await tx
        .update(orders)
        .set({
          status: "denied",
          paymentApprovedAt: null,
          paymentRejectedAt: now,
          updatedAt: now,
        })
        .where(and(eq(orders.businessId, ctx.businessId), eq(orders.id, existingOrder.id)))
        .returning();
      deniedOrder = updatedOrder ?? existingOrder;
    }

    const [ticketRow] = await tx
      .update(supportTickets)
      .set({
        status: "resolved",
        outcome: "lost",
        lossReason: normalizedReason,
        resolvedAt: now,
        closedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(supportTickets.id, input.id),
          eq(supportTickets.businessId, ctx.businessId),
        ),
      )
      .returning();

    if (!ticketRow) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to deny order ticket.",
      });
    }

    const notification = await enqueueWhatsAppOutboxMessages(tx, {
      businessId: ctx.businessId,
      entityType: "ticket",
      entityId: input.id,
      customerId: contactContext.customerId,
      threadId: contactContext.threadId,
      channelIdentityId: contactContext.channelIdentityId,
      recipient: contactContext.approvalRecipient,
      recipientSource: contactContext.recipientSource,
      whatsappIdentitySource: contactContext.whatsappIdentitySource,
      source: "order_ticket_denied",
      idempotencyBaseKey: `order_ticket:${input.id}:denial`,
      messages: buildOrderDenialMessages({
        customerName: contactContext.customerName ?? ticket.customerName,
        reason: normalizedReason,
      }),
    });

      return {
        ticket: ticketRow ?? null,
        order: deniedOrder,
        notification,
      };
    });
  });

  if (!result.ticket) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to deny order ticket." });
  }

  await logTicketEvent({
    businessId: ctx.businessId,
    ticketId: result.ticket.id,
    eventType: "order_denied",
    actorType: "user",
    actorId: ctx.userId ?? ctx.firebaseUid ?? null,
    actorLabel: ctx.userEmail ?? "user",
    payload: {
      reason: normalizedReason,
      orderId: result.order?.id ?? null,
    },
  });
  if (result.order) {
    await logOrderEvent({
      businessId: ctx.businessId,
      orderId: result.order.id,
      eventType: "denied",
      actorType: "user",
      actorId: ctx.userId ?? ctx.firebaseUid ?? null,
      actorLabel: ctx.userEmail ?? "user",
      payload: {
        reason: normalizedReason,
        supportTicketId: result.ticket.id,
      },
    });
    await publishPortalEvent({
      businessId: ctx.businessId,
      entity: "order",
      op: "upsert",
      entityId: result.order.id,
      payload: {
        order: result.order as any,
      },
      createdAt: result.order.updatedAt ?? now,
    });
  }

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
    await logTicketEvent({
      businessId: ctx.businessId,
      ticketId: result.ticket.id,
      eventType: "order_denial_notification_failed",
      actorType: "system",
      actorLabel: "bot",
      payload: {
        error: delivery.error,
      },
    });
  }

  const realtimeTicket = await publishHydratedTicketUpsert({
    businessId: ctx.businessId,
    ticketId: result.ticket.id,
    createdAt: result.ticket.updatedAt ?? now,
  });

  recordBusinessEvent({
    event: "ticket.order_denied",
    action: "denyOrderTicket",
    area: "ticket",
    businessId: ctx.businessId,
    entity: "ticket",
    entityId: result.ticket.id,
    userId: ctx.userId,
    actorId: ctx.firebaseUid ?? ctx.userId ?? null,
    actorType: "user",
    outcome: delivery.ok ? "success" : "degraded",
    status: "denied",
    attributes: {
      order_id: result.order?.id ?? null,
      reason: normalizedReason,
      delivery_ok: delivery.ok,
      delivery_phone_source: delivery.recipientSource,
      delivery_identity_source: delivery.whatsappIdentitySource,
    },
  });

  return {
    ...result,
    ticket: realtimeTicket ?? result.ticket,
    delivery,
  };
}
