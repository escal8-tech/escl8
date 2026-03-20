import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { messageThreads, orderEvents, threadMessages } from "../../../drizzle/schema";
import type { OrderFlowSettings } from "@/lib/order-settings";

export type OrderApprovalMessage =
  | { type: "text"; text: string }
  | { type: "image"; imageUrl: string; caption?: string };

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

export function normalizeOrderLineItems(fields: Record<string, unknown>): NormalizedOrderLineItem[] {
  const pricedRaw = fields.priced_line_items;
  if (Array.isArray(pricedRaw)) {
    const items = pricedRaw
      .map((entry) => {
        const row = asRecord(entry);
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
      })
      .filter((entry): entry is NormalizedOrderLineItem => Boolean(entry));
    if (items.length) return items;
  }

  const lineItemsRaw = fields.line_items;
  if (Array.isArray(lineItemsRaw)) {
    const items = lineItemsRaw
      .map((entry) => {
        const row = asRecord(entry);
        const item = String(row.item ?? "").trim();
        const quantity = String(row.quantity ?? "").trim() || "1";
        if (!item) return null;
        const unitPrice = parseMoneyValue(row.unit_price);
        return {
          item,
          quantity,
          ...(unitPrice ? { unitPrice } : {}),
        };
      })
      .filter((entry): entry is NormalizedOrderLineItem => Boolean(entry));
    if (items.length) return items;
  }

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
  let pricedCount = 0;
  for (const item of items) {
    const quantity = Number(String(item.quantity || "1").replace(/[^\d]/g, "") || "1");
    const unitPrice = parseMoneyValue(item.unitPrice);
    if (!unitPrice) continue;
    total += Number(unitPrice) * Math.max(1, quantity || 1);
    pricedCount += 1;
  }
  if (!pricedCount) return null;
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
    `Order reference: ${input.orderId.slice(0, 8).toUpperCase()}`,
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
  }

  return messages;
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
  threadId: string;
  messageType: string;
  textBody?: string | null;
  externalMessageId?: string | null;
  meta?: Record<string, unknown>;
}) {
  const now = new Date();
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

  return saved ?? null;
}
