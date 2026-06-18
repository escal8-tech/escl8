/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { customers, orderPayments, orders, supportTickets } from "../../../drizzle/schema";
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
import {
  buildOrderApprovalEmail,
  buildOrderApprovalMessages,
  buildManualCollectionMessages,
  buildManualCollectionEmail,
  formatOrderItemsSummary,
  logOrderEvent,
  missingRequiredOrderDeliveryFields,
  parseMoneyValue,
  sanitizePhoneDigits,
} from "../services/orderFlow";
import {
  assertOrderAllowsFulfillmentUpdates,
  assertPaymentReviewAllowed,
  assertPaymentSetupEditable,
  asRecord,
  buildPaymentReviewEmail,
  buildPaymentReviewMessages,
  buildRefundStatusMessages,
  buildStoredOrderFlowSettings,
  canReopenPaidOrderForPaymentReview,
  canResendPaymentDetails,
  canCaptureManualPayment,
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
  resolveRefundAmount,
  requiresDispatchData,
} from "@/server/services/orderWorkflowSupport";
import { buildOrderTrackingUrl } from "@/server/services/orderTracking";
import {
  extractCustomerEmail,
  logTicketEvent,
  publishHydratedTicketUpsert,
  sanitizeTicketFields,
} from "@/server/services/ticketWorkflowSupport";

export function isStaffManualOrder(orderRow: { source?: string | null; ticketSnapshot?: Record<string, unknown> | null }) {
  const snapshot = asRecord(orderRow.ticketSnapshot);
  const fields = asRecord(snapshot.fields);
  return String(orderRow.source || "").trim().toLowerCase() === "staff_manual"
    || fields.manual_order === true
    || fields.suppress_customer_notifications === true;
}

export function resolveFulfillmentPrefill(orderRow: {
  recipientName?: string | null;
  recipientPhone?: string | null;
  shippingAddress?: string | null;
  deliveryArea?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
}) {
  const shippingAddress = cleanOptionalText(orderRow.shippingAddress, 1200);
  return {
    recipientName: cleanOptionalText(orderRow.recipientName ?? orderRow.customerName, 160),
    recipientPhone: cleanOptionalText(orderRow.recipientPhone ?? orderRow.customerPhone, 50),
    shippingAddress,
    deliveryArea: cleanOptionalText(orderRow.deliveryArea, 200) ?? shippingAddress,
  };
}

export * from "./orderPaymentMutationSupport";

export async function emailManualOrderInvoice(input: {
  businessId: string;
  order: typeof orders.$inferSelect;
}): Promise<{
  ok: boolean;
  error: string | null;
  invoiceNumber: string | null;
}> {
  const recipientEmail = cleanOptionalText(input.order.customerEmail, 240)?.toLowerCase() ?? "";
  if (!recipientEmail) {
    return {
      ok: false,
      error: "Manual order invoice email skipped because the order has no customer email.",
      invoiceNumber: null,
    };
  }

  const trackingUrl = buildOrderTrackingUrl({
    businessId: input.businessId,
    orderId: input.order.id,
  });
  const artifact = await createOrderInvoiceForOrder({
    businessId: input.businessId,
    orderId: input.order.id,
    deliveryMethod: "email",
    trackingUrl,
  });
  if (!artifact) {
    return {
      ok: false,
      error: "Manual order invoice could not be generated.",
      invoiceNumber: null,
    };
  }

  const queued = await db.transaction((tx) =>
    enqueueEmailOutboxMessages(tx, {
      businessId: input.businessId,
      entityType: "order",
      entityId: input.order.id,
      customerId: input.order.customerId ?? null,
      recipientEmail,
      source: "order_manual_invoice_email",
      idempotencyBaseKey: `order:${input.order.id}:manual_invoice:${artifact.invoiceNumber}`,
      messages: [
        buildOrderInvoiceEmailMessage({
          artifact,
          orderId: input.order.id,
          customerName: input.order.customerName,
          trackingUrl,
        }),
      ],
    }),
  );
  if (!queued.ok) {
    return {
      ok: false,
      error: queued.error,
      invoiceNumber: artifact.invoiceNumber,
    };
  }

  const drained = queued.idempotencyKeys.length
    ? await drainBusinessOutbox({
        businessId: input.businessId,
        idempotencyKeys: queued.idempotencyKeys,
        limit: queued.idempotencyKeys.length,
      })
    : { ok: true, error: null };
  await flushBusinessOutbox(input.businessId);
  if (!drained.ok) {
    return {
      ok: false,
      error: drained.error || "Manual order invoice email delivery failed.",
      invoiceNumber: artifact.invoiceNumber,
    };
  }

  await markOrderInvoiceDelivered({
    businessId: input.businessId,
    orderId: input.order.id,
    deliveryMethod: "email",
    invoiceNumber: artifact.invoiceNumber,
  });
  return {
    ok: true,
    error: null,
    invoiceNumber: artifact.invoiceNumber,
  };
}

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

