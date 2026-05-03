import crypto from "crypto";
import { and, desc, eq, or, sql } from "drizzle-orm";

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

type ParsedTrackingToken = {
  businessId: string;
  orderId: string;
  publicReference?: string;
};

function cleanText(value: unknown, limit = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function shortSignature(payload: string, secret: string): string {
  return signPayload(payload, secret).slice(0, 22);
}

function safeTimingEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function publicOrderReference(value: unknown): string {
  const raw = cleanText(value, 80).replace(/^ORD[-_\s]+/i, "");
  return raw.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24).toUpperCase();
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

function normalizePublicBaseUrl(value: unknown): string {
  const raw = cleanText(value, 300).replace(/\/+$/, "");
  if (!raw) return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "0.0.0.0" ||
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::" ||
    host === "[::]" ||
    host.endsWith(".local")
  ) {
    return "";
  }
  if (!["https:", "http:"].includes(url.protocol)) return "";
  return `${url.protocol}//${url.host}`;
}

function trackingBaseUrl(fallbackOrigin?: string | null): string {
  const candidates = [
    process.env.ORDER_TRACKING_BASE_URL,
    process.env.CONCIERGE_PUBLIC_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.ESCL8_PUBLIC_APP_URL,
    process.env.ESCL8_APP_BASE_URL,
    process.env.APP_BASE_URL,
    process.env.NEXTAUTH_URL,
    process.env.PUBLIC_APP_URL,
    fallbackOrigin,
    "https://concierge.escal8.tech",
  ];
  for (const candidate of candidates) {
    const normalized = normalizePublicBaseUrl(candidate);
    if (normalized) return normalized;
  }
  return "";
}

export function createOrderTrackingToken(input: { businessId: string; orderId: string }): string {
  return publicOrderReference(input.orderId.slice(0, 8)) || cleanText(input.orderId, 160);
}

export function parseOrderTrackingToken(token: string): ParsedTrackingToken | null {
  const rawToken = String(token || "").trim();
  const compactMatch = /^o2_([A-Za-z0-9_-]{4,220})_([A-Za-z0-9_-]{22})$/.exec(rawToken);
  if (compactMatch) {
    const payload = `o2_${compactMatch[1]}`;
    const expected = shortSignature(payload, trackingSecret());
    if (!safeTimingEqual(compactMatch[2], expected)) return null;
    const orderId = cleanText(Buffer.from(compactMatch[1], "base64url").toString("utf8"), 160);
    return orderId ? { businessId: "", orderId } : null;
  }

  if (!rawToken.includes(".")) {
    const reference = publicOrderReference(rawToken);
    return reference ? { businessId: "", orderId: "", publicReference: reference } : null;
  }

  const [payload, signature, extra] = rawToken.split(".");
  if (!payload || !signature || extra) return null;
  const expected = signPayload(payload, trackingSecret());
  if (!safeTimingEqual(signature, expected)) {
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
  const reference = publicOrderReference(parsed.publicReference);
  const orderPredicate = reference
    ? or(
        eq(orders.paymentReference, reference),
        eq(orders.paymentReference, `ORD-${reference}`),
        sql`upper(left(${orders.id}, 8)) = ${reference}`,
      )
    : parsed.businessId
      ? and(eq(orders.businessId, parsed.businessId), eq(orders.id, parsed.orderId))
      : eq(orders.id, parsed.orderId);

  const [order] = await db
    .select()
    .from(orders)
    .where(orderPredicate)
    .limit(1);
  if (!order) return null;
  const businessId = cleanText(order.businessId, 160);

  const [business] = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      settings: businesses.settings,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business) return null;

  const [[latestPayment], events] = await Promise.all([
    db
      .select()
      .from(orderPayments)
      .where(and(eq(orderPayments.businessId, businessId), eq(orderPayments.orderId, parsed.orderId)))
      .orderBy(desc(orderPayments.createdAt))
      .limit(1),
    db
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.businessId, businessId), eq(orderEvents.orderId, parsed.orderId)))
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
