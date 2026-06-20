/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { orders } from "../../../drizzle/schema";
import { drainBusinessOutbox, enqueueEmailOutboxMessages } from "@/server/services/messageOutbox";
import {
  buildOrderInvoiceEmailMessage,
  createOrderInvoiceForOrder,
  markOrderInvoiceDelivered,
} from "@/server/services/orderInvoice";
import { buildOrderTrackingUrl } from "@/server/services/orderTracking";
import {
  asRecord,
  cleanOptionalText,
  flushBusinessOutbox,
} from "@/server/services/orderWorkflowSupport";

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
