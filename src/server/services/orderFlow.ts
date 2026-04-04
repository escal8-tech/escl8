import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { messageThreads, orderEvents, threadMessages } from "../../../drizzle/schema";
import type { OrderFlowSettings } from "@/lib/order-settings";
import {
  formatOrderFulfillmentStatus,
  type OrderFulfillmentStatus,
} from "@/lib/order-operations";
import { publishPortalEvent } from "@/server/realtime/portalEvents";

export type OrderApprovalMessage =
  | { type: "text"; text: string }
  | { type: "image"; imageUrl: string; caption?: string };

export type OrderEmailMessage = {
  subject: string;
  text: string;
  html: string;
};

type PortalJsonValue = string | number | boolean | null | PortalJsonValue[] | { [k: string]: PortalJsonValue };

function toPortalPayload(value: unknown): Record<string, PortalJsonValue> {
  const serialized = JSON.parse(JSON.stringify(value ?? {})) as PortalJsonValue;
  if (!serialized || typeof serialized !== "object" || Array.isArray(serialized)) {
    return {};
  }
  return serialized as Record<string, PortalJsonValue>;
}

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderOrderEmailHtml(params: {
  heading: string;
  lead?: string | null;
  lines: string[];
  imageUrl?: string | null;
}): string {
  const lines = params.lines.filter(Boolean);
  const imageUrl = String(params.imageUrl || "").trim();
  const listItems = lines.map((line) => `<li style="margin:0 0 10px">${escapeHtml(line)}</li>`).join("");
  return [
    '<div style="font-family:Montserrat,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#0b1220;color:#e5edf6">',
    '<div style="border:1px solid #21324a;border-radius:18px;padding:24px;background:linear-gradient(180deg,#122038,#0d172a)">',
    `<div style="font-size:24px;font-weight:700;margin:0 0 10px">${escapeHtml(params.heading)}</div>`,
    params.lead ? `<p style="margin:0 0 18px;color:#b8c7da;line-height:1.6">${escapeHtml(params.lead)}</p>` : "",
    `<ul style="padding-left:18px;margin:0;color:#f6fbff;line-height:1.65">${listItems}</ul>`,
    imageUrl
      ? `<div style="margin-top:20px"><img src="${escapeHtml(imageUrl)}" alt="Payment QR" style="max-width:240px;border-radius:14px;border:1px solid #2d4361" /></div>`
      : "",
    '<div style="margin-top:22px;font-size:12px;color:#90a4be">Sent by your Escl8 order operations workflow.</div>',
    "</div>",
    "</div>",
  ].join("");
}

export function sanitizePhoneDigits(value: string | null | undefined): string {
  return String(value ?? "").replace(/[^\d]/g, "");
}

export function parseMoneyValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  const normalized = String(value).trim();
  if (!normalized) return null;
  const cleaned = normalized.replace(/[^0-9.,-]/g, "");
  if (!cleaned) return null;
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  const decimalIdx = Math.max(lastDot, lastComma);
  let numeric = cleaned;
  if (decimalIdx >= 0) {
    const integerPart = cleaned.slice(0, decimalIdx).replace(/[.,]/g, "");
    const decimalPart = cleaned.slice(decimalIdx + 1).replace(/[.,]/g, "");
    numeric = `${integerPart}.${decimalPart}`;
  } else {
    numeric = cleaned.replace(/[.,]/g, "");
  }
  const parsed = Number(numeric);
  if (!Number.isFinite(parsed)) return null;
  return parsed.toFixed(2);
}

export type NormalizedOrderLineItem = {
  item: string;
  quantity: string;
  unitPrice?: string;
  lineTotal?: string;
};

export type OrderFulfillmentSeed = {
  recipientName: string | null;
  recipientPhone: string | null;
  shippingAddress: string | null;
  deliveryArea: string | null;
  deliveryNotes: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  }
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry ?? "").trim()).filter(Boolean);
    }
  } catch {
    // noop
  }
  return raw.split(/\s*(?:,|;|\n)\s*/).map((entry) => entry.trim()).filter(Boolean);
}

function normalizeOrderLineItemRow(value: unknown): NormalizedOrderLineItem | null {
  const row = asRecord(value);
  const item = String(row.item ?? "").trim();
  const quantity = String(row.quantity ?? "").trim() || "1";
  if (!item) return null;
  const unitPrice = parseMoneyValue(row.unit_price);
  const lineTotal = parseMoneyValue(row.line_total);
  return {
    item,
    quantity,
    ...(unitPrice ? { unitPrice } : {}),
    ...(lineTotal ? { lineTotal } : {}),
  };
}

function normalizeFieldKey(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findFieldValue(fields: Record<string, unknown>, ...keys: string[]): string | null {
  const wanted = new Set(keys.map((key) => normalizeFieldKey(key)).filter(Boolean));
  if (!wanted.size) return null;
  for (const [key, value] of Object.entries(fields)) {
    if (!wanted.has(normalizeFieldKey(key))) continue;
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
}

function normalizeOrderLineItemKey(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeOrderLineItems(fields: Record<string, unknown>): NormalizedOrderLineItem[] {
  const lineItems = Array.isArray(fields.line_items)
    ? fields.line_items.map(normalizeOrderLineItemRow).filter((entry): entry is NormalizedOrderLineItem => Boolean(entry))
    : [];
  const pricedLineItems = Array.isArray(fields.priced_line_items)
    ? fields.priced_line_items.map(normalizeOrderLineItemRow).filter((entry): entry is NormalizedOrderLineItem => Boolean(entry))
    : [];

  if (lineItems.length) {
    if (!pricedLineItems.length) return lineItems;
    const pricedByKey = new Map(pricedLineItems.map((entry) => [normalizeOrderLineItemKey(entry.item), entry]));
    const merged = lineItems.map((entry) => {
      const priced = pricedByKey.get(normalizeOrderLineItemKey(entry.item));
      if (!priced) return entry;
      return {
        ...entry,
        ...(priced.unitPrice ? { unitPrice: priced.unitPrice } : {}),
        ...(priced.lineTotal ? { lineTotal: priced.lineTotal } : {}),
      };
    });
    for (const priced of pricedLineItems) {
      const exists = merged.some((entry) => normalizeOrderLineItemKey(entry.item) === normalizeOrderLineItemKey(priced.item));
      if (!exists) merged.push(priced);
    }
    return merged;
  }
  if (pricedLineItems.length) return pricedLineItems;

  const items = asStringList(fields.items ?? fields.product);
  const quantities = asStringList(fields.quantity);
  return items.map((item, index) => ({
    item,
    quantity: quantities[index] ?? quantities[quantities.length - 1] ?? "1",
  }));
}

export function computeOrderExpectedAmount(fields: Record<string, unknown>): string | null {
  const explicitTotal = parseMoneyValue(fields.total ?? fields.total_cost ?? fields.totalcost ?? fields.amount);
  if (explicitTotal) return explicitTotal;

  const items = normalizeOrderLineItems(fields);
  if (!items.length) return null;
  let total = 0;
  for (const item of items) {
    const quantity = Number(String(item.quantity || "1").replace(/[^\d]/g, "") || "1");
    const unitPrice = parseMoneyValue(item.unitPrice);
    if (!unitPrice) return null;
    total += Number(unitPrice) * Math.max(1, quantity || 1);
  }
  return total.toFixed(2);
}

export function formatOrderItemsSummary(fields: Record<string, unknown>): string {
  const items = normalizeOrderLineItems(fields);
  if (!items.length) return "No items listed";
  return items
    .map((item) => {
      const price = item.unitPrice ? ` x ${item.unitPrice}` : "";
      return `${item.item} (qty ${item.quantity}${price})`;
    })
    .join(", ");
}

export function buildOrderApprovalMessages(input: {
  orderId: string;
  customerName?: string | null;
  itemsSummary: string;
  expectedAmount: string | null;
  paymentReference: string | null;
  orderSettings: OrderFlowSettings;
}): OrderApprovalMessage[] {
  const messages: OrderApprovalMessage[] = [];
  const introLines = [
    input.customerName ? `Hi ${input.customerName}, your order has been approved.` : "Your order has been approved.",
    `Order number: ${input.orderId.slice(0, 8).toUpperCase()}`,
    `Items: ${input.itemsSummary}`,
  ];
  if (input.expectedAmount) {
    introLines.push(`Total due: ${input.orderSettings.currency} ${input.expectedAmount}`);
  }
  if (input.paymentReference) {
    introLines.push(`Payment reference: ${input.paymentReference}`);
  }
  messages.push({ type: "text", text: introLines.join("\n") });

  const bankQr = input.orderSettings.bankQr;
  if (input.orderSettings.paymentMethod === "bank_qr") {
    const paymentLines = ["Please complete the payment and send the payment slip image or PDF in this chat."];
    if (bankQr.showBankDetails) {
      if (bankQr.bankName) paymentLines.push(`Bank: ${bankQr.bankName}`);
      if (bankQr.accountName) paymentLines.push(`Account name: ${bankQr.accountName}`);
      if (bankQr.accountNumber) paymentLines.push(`Account number: ${bankQr.accountNumber}`);
      if (bankQr.accountInstructions) paymentLines.push(bankQr.accountInstructions);
    }
    messages.push({ type: "text", text: paymentLines.join("\n") });
    if (bankQr.showQr && bankQr.qrImageUrl) {
      messages.push({
        type: "image",
        imageUrl: bankQr.qrImageUrl,
        caption: "Scan this QR and send the payment slip here once the transfer is complete.",
      });
    }
  } else if (input.orderSettings.paymentMethod === "cod") {
    messages.push({
      type: "text",
      text: "Cash on delivery is set for this order. We will keep you updated here as the delivery moves forward.",
    });
  } else {
    messages.push({
      type: "text",
      text: "Our team will continue processing this order and send delivery updates in this chat.",
    });
  }

  return messages;
}

export function buildOrderApprovalEmail(input: {
  orderId: string;
  customerName?: string | null;
  itemsSummary: string;
  expectedAmount: string | null;
  paymentReference: string | null;
  orderSettings: OrderFlowSettings;
}): OrderEmailMessage {
  const ref = input.orderId.slice(0, 8).toUpperCase();
  const lead = input.customerName
    ? `Hi ${input.customerName}, your order has been approved and is now in our operations queue.`
    : "Your order has been approved and is now in our operations queue.";
  const lines = [`Order number: ${ref}`, `Items: ${input.itemsSummary}`];
  if (input.expectedAmount) {
    lines.push(`Total due: ${input.orderSettings.currency} ${input.expectedAmount}`);
  }
  if (input.paymentReference) {
    lines.push(`Payment reference: ${input.paymentReference}`);
  }

  let imageUrl: string | null = null;
  if (input.orderSettings.paymentMethod === "bank_qr") {
    lines.push("Please complete the payment and reply to the same WhatsApp chat with the payment slip image or PDF.");
    if (input.orderSettings.bankQr.showBankDetails) {
      if (input.orderSettings.bankQr.bankName) lines.push(`Bank: ${input.orderSettings.bankQr.bankName}`);
      if (input.orderSettings.bankQr.accountName) lines.push(`Account name: ${input.orderSettings.bankQr.accountName}`);
      if (input.orderSettings.bankQr.accountNumber) lines.push(`Account number: ${input.orderSettings.bankQr.accountNumber}`);
      if (input.orderSettings.bankQr.accountInstructions) lines.push(input.orderSettings.bankQr.accountInstructions);
    }
    if (input.orderSettings.bankQr.showQr && input.orderSettings.bankQr.qrImageUrl) {
      imageUrl = input.orderSettings.bankQr.qrImageUrl;
      lines.push(`QR image: ${input.orderSettings.bankQr.qrImageUrl}`);
    }
  } else if (input.orderSettings.paymentMethod === "cod") {
    lines.push("Payment method: Cash on delivery.");
  } else {
    lines.push("Our team will continue processing the order and email you as it moves forward.");
  }

  return {
    subject: `Order approved: ${ref}`,
    text: [lead, ...lines].join("\n"),
    html: renderOrderEmailHtml({
      heading: `Order ${ref} approved`,
      lead,
      lines,
      imageUrl,
    }),
  };
}

export function buildPaymentSubmittedEmail(input: {
  customerName?: string | null;
  orderId: string;
  currency: string;
  expectedAmount?: string | null;
  submittedAmount?: string | null;
  paymentReference?: string | null;
  aiCheckStatus?: string | null;
  aiCheckNotes?: string | null;
}): OrderEmailMessage {
  const ref = String(input.orderId || "").slice(0, 8).toUpperCase();
  const lead = input.customerName
    ? `Hi ${input.customerName}, we received the payment proof for order ${ref}.`
    : `We received the payment proof for order ${ref}.`;
  const lines = [
    `Order number: ${ref}`,
    input.paymentReference ? `Payment reference: ${input.paymentReference}` : "",
    input.expectedAmount ? `Expected amount: ${input.currency} ${input.expectedAmount}` : "",
    input.submittedAmount ? `Submitted amount: ${input.currency} ${input.submittedAmount}` : "",
    input.aiCheckStatus === "passed"
      ? "Our automated check found the proof broadly consistent with the order details. It is now waiting for final staff verification."
      : "The payment proof has been submitted for manual finance review.",
    input.aiCheckNotes ? `Review note: ${input.aiCheckNotes}` : "",
    "We will email you again as soon as the finance review is complete.",
  ].filter(Boolean);
  return {
    subject: `Payment proof received: ${ref}`,
    text: [lead, ...lines].join("\n"),
    html: renderOrderEmailHtml({
      heading: `Payment proof received for ${ref}`,
      lead,
      lines,
    }),
  };
}

export function extractOrderFulfillmentSeed(input: {
  fields: Record<string, unknown>;
  customerName?: string | null;
  customerPhone?: string | null;
}): OrderFulfillmentSeed {
  const fields = input.fields;
  return {
    recipientName:
      findFieldValue(fields, "recipientname", "receivername", "contactname", "deliveryname", "name") ??
      (String(input.customerName ?? "").trim() || null),
    recipientPhone:
      findFieldValue(fields, "recipientphone", "receiverphone", "deliveryphone", "contactphone", "phone", "phonenumber") ??
      (String(input.customerPhone ?? "").trim() || null),
    shippingAddress:
      findFieldValue(fields, "shippingaddress", "deliveryaddress", "address", "deliverylocation", "location"),
    deliveryArea:
      findFieldValue(fields, "deliveryarea", "area", "city", "town", "district", "region"),
    deliveryNotes:
      findFieldValue(fields, "deliverynotes", "deliverynote", "notes", "note", "landmark", "instructions"),
  };
}

export function buildFulfillmentStatusMessages(input: {
  customerName?: string | null;
  orderId: string;
  fulfillmentStatus: OrderFulfillmentStatus;
  courierName?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  scheduledDeliveryAt?: Date | string | null;
  note?: string | null;
}): OrderApprovalMessage[] {
  const ref = String(input.orderId || "").slice(0, 8).toUpperCase();
  const customerLine = input.customerName ? `Hi ${input.customerName},` : "Hello,";
  const statusLabel = formatOrderFulfillmentStatus(input.fulfillmentStatus);
  const lines = [customerLine];
  if (input.fulfillmentStatus === "on_hold") {
    lines.push(`Your order ${ref} is on hold while we complete the remaining checks.`);
  } else if (input.fulfillmentStatus === "queued") {
    lines.push(`Your order ${ref} is now queued for fulfilment.`);
  } else if (input.fulfillmentStatus === "preparing") {
    lines.push(`We have started preparing your order ${ref}.`);
  } else if (input.fulfillmentStatus === "packed") {
    lines.push(`Your order ${ref} has been packed and is waiting for courier handoff.`);
  } else if (input.fulfillmentStatus === "dispatched") {
    lines.push(`Your order ${ref} has been dispatched.`);
  } else if (input.fulfillmentStatus === "out_for_delivery") {
    lines.push(`Your order ${ref} is out for delivery.`);
  } else if (input.fulfillmentStatus === "delivered") {
    lines.push(`Your order ${ref} has been marked as delivered.`);
  } else if (input.fulfillmentStatus === "failed_delivery") {
    lines.push(`We could not complete the delivery for order ${ref} on this attempt.`);
  } else if (input.fulfillmentStatus === "returned") {
    lines.push(`Order ${ref} has been marked as returned to the sender.`);
  } else {
    lines.push(`Your order ${ref} is now ${statusLabel.toLowerCase()}.`);
  }

  if (input.courierName) {
    lines.push(`Courier: ${input.courierName}`);
  }
  if (input.trackingNumber) {
    lines.push(`Tracking number: ${input.trackingNumber}`);
  }
  if (input.trackingUrl) {
    lines.push(`Tracking link: ${input.trackingUrl}`);
  }
  if (input.scheduledDeliveryAt) {
    const dt = new Date(input.scheduledDeliveryAt);
    if (!Number.isNaN(dt.getTime())) {
      lines.push(`Scheduled delivery: ${dt.toLocaleString()}`);
    }
  }
  if (input.note) {
    lines.push(`Note: ${String(input.note).trim()}`);
  }
  return [{ type: "text", text: lines.join("\n") }];
}

export function buildFulfillmentStatusEmail(input: {
  customerName?: string | null;
  orderId: string;
  fulfillmentStatus: OrderFulfillmentStatus;
  courierName?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  scheduledDeliveryAt?: Date | string | null;
  note?: string | null;
}): OrderEmailMessage {
  const ref = String(input.orderId || "").slice(0, 8).toUpperCase();
  const statusLabel = formatOrderFulfillmentStatus(input.fulfillmentStatus);
  const lead = input.customerName
    ? `Hi ${input.customerName}, here is the latest update for order ${ref}.`
    : `Here is the latest update for order ${ref}.`;
  const lines = [`Status: ${statusLabel}`];
  if (input.courierName) lines.push(`Courier: ${input.courierName}`);
  if (input.trackingNumber) lines.push(`Tracking number: ${input.trackingNumber}`);
  if (input.trackingUrl) lines.push(`Tracking link: ${input.trackingUrl}`);
  if (input.scheduledDeliveryAt) {
    const dt = new Date(input.scheduledDeliveryAt);
    if (!Number.isNaN(dt.getTime())) {
      lines.push(`Scheduled delivery: ${dt.toLocaleString()}`);
    }
  }
  if (input.note) lines.push(`Note: ${String(input.note).trim()}`);
  return {
    subject: `Order update: ${ref} ${statusLabel}`,
    text: [lead, ...lines].join("\n"),
    html: renderOrderEmailHtml({
      heading: `Order ${ref} update`,
      lead,
      lines,
    }),
  };
}

export function buildManualCollectionMessages(input: {
  customerName?: string | null;
  orderId: string;
  currency: string;
  paidAmount?: string | number | null;
  invoiceUrl?: string | null;
}): OrderApprovalMessage[] {
  const ref = String(input.orderId || "").slice(0, 8).toUpperCase();
  const lines = [
    input.customerName ? `Hi ${input.customerName}, we have recorded your payment for order ${ref}.` : `We have recorded your payment for order ${ref}.`,
    input.paidAmount ? `Amount received: ${input.currency} ${String(input.paidAmount).trim()}.` : null,
    "We will continue with fulfilment and keep you updated in this chat.",
    input.invoiceUrl ? `Invoice: ${input.invoiceUrl}` : null,
  ].filter(Boolean);
  return [{ type: "text", text: lines.join("\n") }];
}

export function buildManualCollectionEmail(input: {
  customerName?: string | null;
  orderId: string;
  currency: string;
  paidAmount?: string | number | null;
  invoiceUrl?: string | null;
}): OrderEmailMessage {
  const ref = String(input.orderId || "").slice(0, 8).toUpperCase();
  const lead = input.customerName
    ? `Hi ${input.customerName}, your payment for order ${ref} has been confirmed.`
    : `Your payment for order ${ref} has been confirmed.`;
  const lines = [
    input.paidAmount ? `Amount received: ${input.currency} ${String(input.paidAmount).trim()}` : "",
    "Your order is now confirmed and queued for fulfilment.",
    "We will email you again when the order is dispatched.",
    input.invoiceUrl ? `Invoice link: ${input.invoiceUrl}` : "",
  ].filter(Boolean);
  return {
    subject: `Order confirmed: ${ref}`,
    text: [lead, ...lines].join("\n"),
    html: renderOrderEmailHtml({
      heading: `Order ${ref} confirmed`,
      lead,
      lines,
    }),
  };
}

export async function logOrderEvent(params: {
  businessId: string;
  orderId: string;
  eventType: string;
  actorType: "user" | "bot" | "system";
  actorId?: string | null;
  actorLabel?: string | null;
  payload?: Record<string, unknown>;
}) {
  await db.insert(orderEvents).values({
    businessId: params.businessId,
    orderId: params.orderId,
    eventType: params.eventType,
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel ?? null,
    payload: params.payload ?? {},
  });
}

export async function persistOutboundThreadMessage(params: {
  businessId?: string;
  threadId: string;
  messageType: string;
  textBody?: string | null;
  externalMessageId?: string | null;
  meta?: Record<string, unknown>;
}) {
  const now = new Date();
  if (params.externalMessageId) {
    const [existing] = await db
      .select()
      .from(threadMessages)
      .where(eq(threadMessages.externalMessageId, params.externalMessageId))
      .limit(1);
    if (existing) {
      return existing;
    }
  }
  const [saved] = await db
    .insert(threadMessages)
    .values({
      threadId: params.threadId,
      externalMessageId: params.externalMessageId ?? null,
      direction: "outbound",
      messageType: params.messageType,
      textBody: params.textBody ?? null,
      meta: params.meta ?? {},
      createdAt: now,
    })
    .returning();

  await db
    .update(messageThreads)
    .set({
      lastMessageAt: now,
      updatedAt: now,
    })
    .where(eq(messageThreads.id, params.threadId));

  if (saved && params.businessId) {
    await publishPortalEvent({
      businessId: params.businessId,
      entity: "thread_message",
      op: "insert",
      entityId: saved.id,
      payload: toPortalPayload({ message: saved }),
      createdAt: saved.createdAt ?? now,
    });
  }

  return saved ?? null;
}
