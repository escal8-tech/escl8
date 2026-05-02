import crypto from "crypto";
import { and, desc, eq } from "drizzle-orm";

import { buildPrivateBlobReadUrl } from "@/lib/storage";
import { normalizeCustomizationSettings } from "@/lib/customization-settings";
import {
  formatOrderFulfillmentStatus,
  normalizeOrderFulfillmentStatus,
} from "@/lib/order-operations";
import { businesses, orderEvents, orderPayments, orders } from "../../../drizzle/schema";
import { db } from "../db/client";
import { normalizeOrderLineItems, parseMoneyValue } from "./orderFlow";

type TrackingPayload = {
  v: 1;
  b: string;
  o: string;
};

type TimelineTone = "done" | "current" | "pending" | "issue";

export type PublicOrderTrackingData = {
  order: typeof orders.$inferSelect;
  business: {
    id: string;
    name: string;
    logoUrl: string;
    primaryColor: string;
    secondaryColor: string;
    address: string;
    phone: string;
    email: string;
    website: string;
  };
  items: Array<{
    item: string;
    quantity: string;
    unitPrice?: string;
    lineTotal?: string;
  }>;
  latestPayment: typeof orderPayments.$inferSelect | null;
  events: Array<typeof orderEvents.$inferSelect>;
  timeline: Array<{
    key: string;
    label: string;
    description: string;
    at: Date | null;
    tone: TimelineTone;
  }>;
};

function cleanText(value: unknown, limit = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function trackingSecret(): string {
  const secret = String(
    process.env.ORDER_TRACKING_SECRET ||
      process.env.ORDER_INVOICE_API_KEY ||
      process.env.ORDER_PAYMENT_API_KEY ||
      process.env.BOT_INTERNAL_API_KEY ||
      process.env.NEXTAUTH_SECRET ||
      process.env.AUTH_SECRET ||
      process.env.WHATSAPP_API_KEY ||
      "",
  ).trim();
  if (!secret) {
    throw new Error("ORDER_TRACKING_SECRET or an internal API secret is required for public order tracking links.");
  }
  return secret;
}

function trackingBaseUrl(fallbackOrigin?: string | null): string {
  const raw = String(
    process.env.ORDER_TRACKING_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.ESCL8_APP_BASE_URL ||
      process.env.APP_BASE_URL ||
      process.env.NEXTAUTH_URL ||
      process.env.PUBLIC_APP_URL ||
      fallbackOrigin ||
      "",
  ).trim();
  return raw.replace(/\/+$/, "");
}

export function createOrderTrackingToken(input: { businessId: string; orderId: string }): string {
  const payload = base64UrlJson({
    v: 1,
    b: cleanText(input.businessId, 160),
    o: cleanText(input.orderId, 160),
  } satisfies TrackingPayload);
  return `${payload}.${signPayload(payload, trackingSecret())}`;
}

export function parseOrderTrackingToken(token: string): { businessId: string; orderId: string } | null {
  const [payload, signature, extra] = String(token || "").trim().split(".");
  if (!payload || !signature || extra) return null;
  const expected = signPayload(payload, trackingSecret());
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  let parsed: TrackingPayload | null = null;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TrackingPayload;
  } catch {
    return null;
  }

  if (parsed?.v !== 1) return null;
  const businessId = cleanText(parsed.b, 160);
  const orderId = cleanText(parsed.o, 160);
  return businessId && orderId ? { businessId, orderId } : null;
}

export function buildOrderTrackingUrl(input: {
  businessId: string;
  orderId: string;
  fallbackOrigin?: string | null;
}): string {
  const baseUrl = trackingBaseUrl(input.fallbackOrigin);
  const token = createOrderTrackingToken(input);
  return baseUrl ? `${baseUrl}/track/orders/${encodeURIComponent(token)}` : `/track/orders/${encodeURIComponent(token)}`;
}

function resolveItems(order: typeof orders.$inferSelect) {
  const snapshot = asRecord(order.ticketSnapshot);
  const fields = asRecord(snapshot.fields);
  const nested = normalizeOrderLineItems(fields);
  return nested.length ? nested : normalizeOrderLineItems(snapshot);
}

function isPickupOrder(order: typeof orders.$inferSelect): boolean {
  const shipping = cleanText(order.shippingAddress, 120).toLowerCase();
  const area = cleanText(order.deliveryArea, 120).toLowerCase();
  const notes = cleanText(order.deliveryNotes, 500).toLowerCase();
  return shipping === "pickup" || area === "pickup" || notes.includes("[pickup]") || notes.startsWith("customer pickup");
}

function orderIsPaid(order: typeof orders.$inferSelect): boolean {
  const status = cleanText(order.status, 80).toLowerCase();
  return ["payment_submitted", "paid", "completed", "refund_pending", "refunded"].includes(status)
    || Boolean(order.invoiceGeneratedAt || order.invoiceSentAt);
}

function orderPaymentApproved(order: typeof orders.$inferSelect): boolean {
  const status = cleanText(order.status, 80).toLowerCase();
  return ["paid", "completed", "refund_pending", "refunded"].includes(status) || Boolean(order.paymentApprovedAt);
}

function buildTimeline(
  order: typeof orders.$inferSelect,
  latestPayment: typeof orderPayments.$inferSelect | null,
): PublicOrderTrackingData["timeline"] {
  const fulfillment = normalizeOrderFulfillmentStatus(order.fulfillmentStatus);
  const pickup = isPickupOrder(order);
  const paid = orderIsPaid(order);
  const paymentApproved = orderPaymentApproved(order);
  const dispatched = ["dispatched", "out_for_delivery", "delivered"].includes(fulfillment);
  const delivered = fulfillment === "delivered" || cleanText(order.status, 80).toLowerCase() === "completed";
  const issue = fulfillment === "failed_delivery" || fulfillment === "returned";

  return [
    {
      key: "created",
      label: "Order created",
      description: "Your order has been recorded by the business.",
      at: order.createdAt ?? null,
      tone: "done",
    },
    {
      key: "payment_received",
      label: "Payment details received",
      description: "The payment update and order details were captured.",
      at: order.invoiceSentAt ?? order.invoiceGeneratedAt ?? latestPayment?.createdAt ?? order.paymentApprovedAt ?? null,
      tone: paid ? "done" : "current",
    },
    {
      key: "payment_approved",
      label: "Payment approved",
      description: "Staff will mark this complete after checking the bank transfer or proof.",
      at: order.paymentApprovedAt ?? null,
      tone: paymentApproved ? "done" : paid ? "current" : "pending",
    },
    {
      key: "fulfillment",
      label: pickup ? "Ready for pickup" : "Order fulfillment",
      description: pickup ? "The team will prepare the order for pickup." : `Current status: ${formatOrderFulfillmentStatus(fulfillment)}.`,
      at: order.fulfillmentUpdatedAt ?? order.updatedAt ?? null,
      tone: paymentApproved ? (issue ? "issue" : delivered ? "done" : "current") : "pending",
    },
    {
      key: "dispatch",
      label: pickup ? "Picked up" : "Dispatched",
      description: pickup ? "The order is complete after pickup." : "Courier and tracking details appear here after staff dispatches the order.",
      at: pickup ? order.deliveredAt ?? null : order.dispatchedAt ?? order.outForDeliveryAt ?? null,
      tone: delivered ? "done" : dispatched ? "current" : issue ? "issue" : "pending",
    },
    {
      key: "complete",
      label: "Order complete",
      description: issue ? "Staff follow-up is required for this order." : "The order is complete when delivery or pickup is finished.",
      at: order.deliveredAt ?? null,
      tone: issue ? "issue" : delivered ? "done" : "pending",
    },
  ];
}

export async function getPublicOrderTrackingData(token: string): Promise<PublicOrderTrackingData | null> {
  const parsed = parseOrderTrackingToken(token);
  if (!parsed) return null;

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.businessId, parsed.businessId), eq(orders.id, parsed.orderId)))
    .limit(1);
  if (!order) return null;

  const [business] = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      settings: businesses.settings,
    })
    .from(businesses)
    .where(eq(businesses.id, parsed.businessId))
    .limit(1);
  if (!business) return null;

  const [[latestPayment], events] = await Promise.all([
    db
      .select()
      .from(orderPayments)
      .where(and(eq(orderPayments.businessId, parsed.businessId), eq(orderPayments.orderId, parsed.orderId)))
      .orderBy(desc(orderPayments.createdAt))
      .limit(1),
    db
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.businessId, parsed.businessId), eq(orderEvents.orderId, parsed.orderId)))
      .orderBy(desc(orderEvents.createdAt))
      .limit(12),
  ]);

  const customization = normalizeCustomizationSettings(business.settings);
  const logoUrl = customization.logoBlobPath
    ? buildPrivateBlobReadUrl(customization.logoBlobPath, 24 * 30, customization.logoContainer || undefined)
    : "";

  return {
    order,
    business: {
      id: business.id,
      name: customization.businessName || business.name || "Business",
      logoUrl: logoUrl || customization.logoUrl,
      primaryColor: customization.primaryColor,
      secondaryColor: customization.secondaryColor,
      address: customization.address,
      phone: customization.phone,
      email: customization.email,
      website: customization.website,
    },
    items: resolveItems(order),
    latestPayment: latestPayment ?? null,
    events,
    timeline: buildTimeline(order, latestPayment ?? null),
  };
}

export function formatTrackingMoney(currency: string | null | undefined, value: unknown): string {
  const normalized = parseMoneyValue(value) ?? "0.00";
  return `${cleanText(currency || "LKR", 12) || "LKR"} ${Number(normalized).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
