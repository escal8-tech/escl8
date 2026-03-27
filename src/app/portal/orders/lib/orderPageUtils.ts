import { normalizeOrderFlowSettings } from "@/lib/order-settings";
import {
  normalizeOrderFulfillmentStatus,
  type OrderFulfillmentStatus,
} from "@/lib/order-operations";

export type OrderPaymentRow = {
  id: string;
  status: string;
  currency?: string | null;
  expectedAmount?: string | number | null;
  paidAmount?: string | number | null;
  referenceCode?: string | null;
  proofUrl?: string | null;
  aiCheckStatus?: string | null;
  aiCheckNotes?: string | null;
  createdAt?: Date | string | null;
};

export type OrderRow = {
  id: string;
  status: string;
  fulfillmentStatus?: string | null;
  currency?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  shippingAddress?: string | null;
  deliveryArea?: string | null;
  deliveryNotes?: string | null;
  courierName?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  dispatchReference?: string | null;
  scheduledDeliveryAt?: Date | string | null;
  fulfillmentNotes?: string | null;
  packedAt?: Date | string | null;
  dispatchedAt?: Date | string | null;
  outForDeliveryAt?: Date | string | null;
  deliveredAt?: Date | string | null;
  failedDeliveryAt?: Date | string | null;
  returnedAt?: Date | string | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  paymentConfigSnapshot?: Record<string, unknown> | null;
  expectedAmount?: string | number | null;
  paidAmount?: string | number | null;
  refundAmount?: string | number | null;
  refundReason?: string | null;
  refundRequestedAt?: Date | string | null;
  refundedAt?: Date | string | null;
  ticketSnapshot?: Record<string, unknown> | null;
  botDisplayPhoneNumber?: string | null;
  lastInboundAt?: Date | string | null;
  whatsappWindowExpiresAt?: Date | string | null;
  whatsappWindowOpen?: boolean;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  latestPayment?: OrderPaymentRow | null;
};

export type OrderEventRow = {
  id: string;
  eventType: string;
  actorType: string;
  actorLabel?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt?: Date | string | null;
};

export const PAGE_SIZE = 20;
export const PROGRESS_FLOW: OrderFulfillmentStatus[] = [
  "on_hold",
  "queued",
  "preparing",
  "packed",
  "dispatched",
  "out_for_delivery",
  "delivered",
];

export const OPERATIONS_FILTERS = [
  { key: "all", label: "All Orders" },
  { key: "needs_action", label: "Needs Action" },
  { key: "on_hold", label: "On Hold" },
  { key: "active", label: "In Fulfilment" },
  { key: "in_transit", label: "In Transit" },
  { key: "delivered", label: "Delivered" },
  { key: "exceptions", label: "Exceptions" },
  { key: "refunds", label: "Refunds" },
] as const;

export type OperationsFilterKey = (typeof OPERATIONS_FILTERS)[number]["key"];

export const RANGE_OPTIONS = [
  { value: 7, label: "7D" },
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
  { value: 365, label: "12M" },
] as const;

export const METHOD_FILTER_OPTIONS = [
  { value: "all", label: "All Methods" },
  { value: "manual", label: "Manual" },
  { value: "bank_qr", label: "Bank QR" },
  { value: "cod", label: "Cash On Delivery" },
] as const;

export type RangeDays = (typeof RANGE_OPTIONS)[number]["value"];
export type OrderDateField = "updatedAt" | "createdAt";
export type OrderMethodFilter = (typeof METHOD_FILTER_OPTIONS)[number]["value"];

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function toDateTimeLocalValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hour = String(parsed.getHours()).padStart(2, "0");
  const minute = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function toIsoFromDateTimeLocal(value: string): string | undefined {
  const normalized = String(value || "").trim();
  if (!normalized) return undefined;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

export function formatMoney(currency: string | null | undefined, value: string | number | null | undefined): string {
  if (value == null || value === "") return "-";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${currency || ""} ${value}`.trim();
  return `${currency || "LKR"} ${amount.toFixed(2)}`;
}

export function numericAmount(value: string | number | null | undefined): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export function formatOrderItems(snapshot: Record<string, unknown>): string {
  const fields = asRecord(snapshot.fields);
  const pricedLineItems = Array.isArray(fields.priced_line_items) ? fields.priced_line_items : [];
  const lineItems = Array.isArray(fields.line_items) ? fields.line_items : [];
  const source = pricedLineItems.length ? pricedLineItems : lineItems;
  const rows = source
    .map((entry) => {
      const row = asRecord(entry);
      const item = String(row.item ?? "").trim();
      const quantity = String(row.quantity ?? "").trim();
      if (!item) return "";
      return quantity ? `${item} x ${quantity}` : item;
    })
    .filter(Boolean);
  if (rows.length) return rows.join(", ");

  const items = Array.isArray(fields.items) ? fields.items : [];
  const quantities = Array.isArray(fields.quantity) ? fields.quantity : [];
  if (!items.length) return "No items listed";
  return items
    .map((item, index) => `${String(item ?? "").trim()} x ${String(quantities[index] ?? quantities[0] ?? 1).trim()}`)
    .join(", ");
}

export function normalizeStatusLabel(value: string | null | undefined): string {
  return String(value || "-").replace(/_/g, " ");
}

export function getOrderStatus(order: OrderRow): string {
  return String(order.status || "").toLowerCase();
}

export function getFulfillmentStatus(order: OrderRow): OrderFulfillmentStatus {
  return normalizeOrderFulfillmentStatus(order.fulfillmentStatus);
}

export function resolveOrderAmount(order: OrderRow): string | number | null | undefined {
  return order.paidAmount ?? order.refundAmount ?? order.expectedAmount;
}

function isManualCollectionOrder(order: OrderRow): boolean {
  const method = String(order.paymentMethod || "").toLowerCase();
  return method === "manual" || method === "cod";
}

export function canRecordManualPayment(order: OrderRow): boolean {
  return isManualCollectionOrder(order) && getOrderStatus(order) === "approved";
}

export function needsPaymentDetailsWorkflow(order: OrderRow): boolean {
  const method = String(order.paymentMethod || "").trim().toLowerCase();
  const status = getOrderStatus(order);
  return method === "bank_qr" && ["awaiting_payment", "payment_rejected"].includes(status);
}

function resolveWhatsAppWindowExpiresAt(order: OrderRow): Date | null {
  const parsed = order.whatsappWindowExpiresAt ? new Date(order.whatsappWindowExpiresAt) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

export function isWhatsAppWindowOpen(order: OrderRow, nowTs: number): boolean {
  const expiresAt = resolveWhatsAppWindowExpiresAt(order);
  if (expiresAt) return expiresAt.getTime() > nowTs;
  return Boolean(order.whatsappWindowOpen);
}

function formatCountdownParts(totalSeconds: number): string {
  const remaining = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${remaining % 60}s`;
}

export function describeWhatsAppWindow(order: OrderRow, nowTs: number): string {
  const expiresAt = resolveWhatsAppWindowExpiresAt(order);
  if (!expiresAt) {
    return "No inbound customer reply recorded for this bot thread yet.";
  }
  const deltaSeconds = Math.round((expiresAt.getTime() - nowTs) / 1000);
  if (deltaSeconds > 0) {
    return `Window open for ${formatCountdownParts(deltaSeconds)} more.`;
  }
  return `Window closed ${formatCountdownParts(Math.abs(deltaSeconds))} ago.`;
}

function getStoredOrderSettings(order: OrderRow) {
  const snapshot = asRecord(order.paymentConfigSnapshot);
  return normalizeOrderFlowSettings({
    orderFlow: {
      ticketToOrderEnabled: true,
      paymentMethod: snapshot.paymentMethod ?? order.paymentMethod ?? "manual",
      currency: snapshot.currency ?? order.currency ?? "LKR",
      bankQr: asRecord(snapshot.bankQr),
    },
  });
}

export function buildManualPaymentInstructions(order: OrderRow): string {
  const settings = getStoredOrderSettings(order);
  const bankQr = settings.bankQr;
  const botNumber = String(order.botDisplayPhoneNumber || "").trim();
  const orderReference = String(order.paymentReference || order.id.slice(0, 8).toUpperCase()).trim();
  const lines = [
    order.customerName ? `Hi ${order.customerName}, your order has been approved.` : "Your order has been approved.",
    `Order reference: ${orderReference}`,
    `Total due: ${formatMoney(settings.currency, order.expectedAmount)}`,
  ];
  if (bankQr.showBankDetails) {
    if (bankQr.bankName) lines.push(`Bank: ${bankQr.bankName}`);
    if (bankQr.accountName) lines.push(`Account name: ${bankQr.accountName}`);
    if (bankQr.accountNumber) lines.push(`Account number: ${bankQr.accountNumber}`);
    if (bankQr.accountInstructions) lines.push(bankQr.accountInstructions);
  }
  if (bankQr.showQr && bankQr.qrImageUrl) {
    lines.push(`QR: ${bankQr.qrImageUrl}`);
  }
  lines.push(
    botNumber
      ? `After payment, send the slip image or PDF to this bot number: ${botNumber}`
      : "After payment, send the slip image or PDF back to the same bot chat.",
  );
  lines.push(`Please include order reference ${orderReference} with the slip.`);
  return lines.join("\n");
}

export function describeFinanceState(order: OrderRow, latestPayment?: OrderPaymentRow | null): string {
  const status = getOrderStatus(order);
  const method = String(order.paymentMethod || "").toLowerCase();
  if (status === "paid") return "Payment captured";
  if (status === "refund_pending") return "Refund pending";
  if (status === "refunded") return "Refunded";
  if (status === "payment_submitted") return "Payment review";
  if (status === "payment_rejected") return "Payment rejected";
  if (status === "awaiting_payment") return "Awaiting payment";
  if (status === "denied") return "Not approved";
  if (method === "manual") return "Manual collection";
  if (method === "cod") return "Cash on delivery";
  if (latestPayment?.aiCheckStatus) return `AI ${normalizeStatusLabel(latestPayment.aiCheckStatus)}`;
  return normalizeStatusLabel(status || method || "pending");
}

export function financeToneClass(order: OrderRow): string {
  const status = getOrderStatus(order);
  if (status === "paid") return "portal-pill portal-pill--success";
  if (status === "payment_submitted") return "portal-pill portal-pill--warning";
  if (status === "awaiting_payment" || status === "approved") return "portal-pill portal-pill--neutral";
  if (status === "payment_rejected" || status === "denied" || status === "refunded") {
    return "portal-pill portal-pill--danger";
  }
  return "portal-pill portal-pill--warning";
}

export function fulfillmentToneClass(value: unknown): string {
  const status = normalizeOrderFulfillmentStatus(value);
  if (status === "delivered") return "portal-pill portal-pill--success";
  if (status === "out_for_delivery" || status === "dispatched") return "portal-pill portal-pill--info";
  if (status === "packed" || status === "preparing") return "portal-pill portal-pill--warning";
  if (status === "failed_delivery" || status === "returned") return "portal-pill portal-pill--danger";
  return "portal-pill portal-pill--neutral";
}

export function getDeliverySummary(order: OrderRow): string {
  const area = String(order.deliveryArea || "").trim();
  const address = String(order.shippingAddress || "").trim();
  const courier = String(order.courierName || "").trim();
  const tracking = String(order.trackingNumber || order.dispatchReference || "").trim();
  if (courier && tracking) return `${courier} • ${tracking}`;
  if (courier) return courier;
  if (area && address) return `${area} • ${address}`;
  if (area) return area;
  if (address) return address;
  return "Missing delivery details";
}

export function getDeliveryHint(order: OrderRow): string {
  if (order.trackingUrl) return "Tracking link available";
  if (order.scheduledDeliveryAt) return `Scheduled ${formatDate(order.scheduledDeliveryAt)}`;
  if (order.recipientName || order.recipientPhone) {
    return [order.recipientName, order.recipientPhone].filter(Boolean).join(" • ");
  }
  return "Add recipient, address, and courier details";
}

export function orderNeedsAttention(order: OrderRow, latestPayment?: OrderPaymentRow | null): boolean {
  const status = getOrderStatus(order);
  const fulfillment = getFulfillmentStatus(order);
  if (status === "payment_submitted" || status === "payment_rejected") return true;
  if (fulfillment === "failed_delivery" || fulfillment === "returned") return true;
  if (fulfillment === "packed" && !order.courierName && !order.trackingNumber && !order.dispatchReference) return true;
  if (latestPayment?.status === "submitted") return true;
  return false;
}

export function matchesOperationsFilter(
  order: OrderRow,
  latestPayment: OrderPaymentRow | null,
  filter: OperationsFilterKey,
): boolean {
  const status = getOrderStatus(order);
  const fulfillment = getFulfillmentStatus(order);
  if (filter === "all") return true;
  if (filter === "needs_action") return orderNeedsAttention(order, latestPayment);
  if (filter === "on_hold") return fulfillment === "on_hold";
  if (filter === "active") return ["queued", "preparing", "packed", "dispatched", "out_for_delivery"].includes(fulfillment);
  if (filter === "in_transit") return fulfillment === "dispatched" || fulfillment === "out_for_delivery";
  if (filter === "delivered") return fulfillment === "delivered";
  if (filter === "exceptions") return fulfillment === "failed_delivery" || fulfillment === "returned";
  if (filter === "refunds") return status === "refund_pending" || status === "refunded";
  return true;
}

export function formatEventSummary(event: OrderEventRow): string | null {
  const payload = asRecord(event.payload);
  const candidates = [
    payload.notes,
    payload.note,
    payload.reason,
    payload.paymentStatus,
    payload.refundAmount,
    payload.trackingNumber,
  ];
  for (const value of candidates) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
}

export function buildFulfillmentActions(
  order: OrderRow,
): Array<{ label: string; nextStatus: OrderFulfillmentStatus; tone?: "primary" | "ghost" }> {
  const fulfillment = getFulfillmentStatus(order);
  if (fulfillment === "on_hold" && getOrderStatus(order) === "paid") {
    return [{ label: "Release To Queue", nextStatus: "queued", tone: "primary" }];
  }
  if (fulfillment === "queued") {
    return [{ label: "Start Preparing", nextStatus: "preparing", tone: "primary" }];
  }
  if (fulfillment === "preparing") {
    return [{ label: "Mark Packed", nextStatus: "packed", tone: "primary" }];
  }
  if (fulfillment === "packed") {
    return [{ label: "Dispatch Order", nextStatus: "dispatched", tone: "primary" }];
  }
  if (fulfillment === "dispatched") {
    return [
      { label: "Out For Delivery", nextStatus: "out_for_delivery", tone: "primary" },
      { label: "Failed Delivery", nextStatus: "failed_delivery", tone: "ghost" },
    ];
  }
  if (fulfillment === "out_for_delivery") {
    return [
      { label: "Mark Delivered", nextStatus: "delivered", tone: "primary" },
      { label: "Failed Delivery", nextStatus: "failed_delivery", tone: "ghost" },
    ];
  }
  if (fulfillment === "failed_delivery") {
    return [
      { label: "Re-Queue", nextStatus: "queued", tone: "primary" },
      { label: "Mark Returned", nextStatus: "returned", tone: "ghost" },
    ];
  }
  if (fulfillment === "delivered") {
    return [{ label: "Mark Returned", nextStatus: "returned", tone: "ghost" }];
  }
  return [];
}
