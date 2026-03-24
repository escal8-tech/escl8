"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useToast } from "@/components/ToastProvider";
import { showErrorToast, showInfoToast, showSuccessToast } from "@/components/toast-utils";
import { trpc } from "@/utils/trpc";
import { useRouter, useSearchParams } from "next/navigation";
import { TableSelect } from "@/app/portal/components/TableToolbarControls";
import { PortalDataTable } from "@/app/portal/components/PortalDataTable";
import { TablePagination } from "@/app/portal/components/TablePagination";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { RowActionsMenu } from "@/app/portal/components/RowActionsMenu";

type TicketStatus = "open" | "in_progress" | "resolved";
type TicketOutcome = "pending" | "won" | "lost";
type TicketEventRow = {
  id: string;
  eventType: string;
  actorType: string;
  actorLabel?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt?: Date | string | null;
};
type TicketRow = {
  [key: string]: unknown;
  id: string;
  status: string;
  orderId?: string | null;
  orderStatus?: string | null;
  orderPaymentMethod?: string | null;
  orderUpdatedAt?: Date | string | null;
  title?: string | null;
  summary?: string | null;
  notes?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  customerId?: string | null;
  threadId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  source?: string | null;
  ticketTypeKey?: string | null;
  ticketTypeId?: string | null;
  businessId?: string | null;
  whatsappIdentityId?: string | null;
  fields?: Record<string, unknown> | null;
  createdBy?: string | null;
  resolvedAt?: Date | string | null;
  closedAt?: Date | string | null;
  priority?: string | null;
  outcome?: string | null;
  lossReason?: string | null;
  slaDueAt?: Date | string | null;
};

const STATUS_OPTIONS: TicketStatus[] = ["open", "in_progress", "resolved"];
const OUTCOME_OPTIONS: TicketOutcome[] = ["pending", "won", "lost"];
const ORDER_STAGE_OPTIONS = [
  "pending_approval",
  "approved",
  "awaiting_payment",
  "payment_submitted",
  "payment_rejected",
  "paid",
  "refund_pending",
  "refunded",
  "denied",
] as const;
type OrderStage = (typeof ORDER_STAGE_OPTIONS)[number];
type TicketListFilter = "all" | TicketStatus | OrderStage;
const LOSS_REASON_OPTIONS = [
  "Price too high",
  "No response",
  "Competitor chosen",
  "Out of stock",
  "Not ready to buy",
  "Other",
];
const PAGE_SIZE = 20;

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function toDateTimeLocalValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${mins}`;
}

function formatSlaCountdown(
  value: Date | string | null | undefined,
  nowMs: number,
): { label: string; tone: "ok" | "warn" | "danger" | "muted" } {
  if (!value) return { label: "No SLA", tone: "muted" };
  const due = new Date(value).getTime();
  if (!Number.isFinite(due)) return { label: "No SLA", tone: "muted" };
  const diffMs = due - nowMs;
  const abs = Math.abs(diffMs);
  const minutes = Math.floor(abs / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const compact = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  if (diffMs < 0) return { label: `Overdue by ${compact}`, tone: "danger" };
  if (diffMs < 60 * 60 * 1000) return { label: `${compact} left`, tone: "warn" };
  return { label: `${compact} left`, tone: "ok" };
}

function getTicketValue(ticket: TicketRow, camelKey: string, snakeKey?: string): unknown {
  if (ticket[camelKey] != null) return ticket[camelKey];
  if (snakeKey && ticket[snakeKey] != null) return ticket[snakeKey];
  return null;
}

function getTicketString(ticket: TicketRow, camelKey: string, snakeKey?: string): string {
  const value = getTicketValue(ticket, camelKey, snakeKey);
  if (value == null) return "";
  return String(value);
}

function getTicketFields(ticket: TicketRow): Record<string, unknown> {
  const value = getTicketValue(ticket, "fields");
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function toStringList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? "").trim()).filter(Boolean);
  }
  const txt = String(value).trim();
  return txt ? [txt] : [];
}

function toLooseStringList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? "").trim()).filter(Boolean);
  }
  const raw = String(value).trim();
  if (!raw) return [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v ?? "").trim()).filter(Boolean);
      }
    } catch {
      // Fall through to delimiter split.
    }
  }
  const parts = raw.split(/\s*(?:,|;|\n)\s*/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [raw];
}

function parseQty(value: unknown): string {
  const txt = String(value ?? "").trim();
  if (!txt) return "1";
  const m = txt.match(/\d+/);
  if (!m) return "1";
  const qty = Number(m[0]);
  if (!Number.isFinite(qty) || qty <= 0) return "1";
  return String(Math.floor(qty));
}

type OrderPair = { item: string; quantity: string };
type OrderEditorLine = { item: string; quantity: string; unitPrice: string };

function parseArrayField(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  const raw = value.trim();
  if (!raw.startsWith("[") || !raw.endsWith("]")) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeOrderItemKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parseMoneyInput(value: unknown): number | null {
  const cleaned = String(value ?? "").trim().replace(/[^0-9.,-]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",") && !cleaned.includes(".")
    ? cleaned.replace(/,/g, ".")
    : cleaned.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoneyInput(value: number): string {
  return value.toFixed(2);
}

function normalizeMoneyInput(value: unknown): string {
  const parsed = parseMoneyInput(value);
  return parsed == null ? "" : formatMoneyInput(parsed);
}

function dedupeOrderPairs(pairs: OrderPair[]): OrderPair[] {
  if (!pairs.length) return [];
  const out: OrderPair[] = [];
  const byKey = new Map<string, number>();
  for (const pair of pairs) {
    const item = String(pair.item ?? "").trim();
    if (!item) continue;
    const key = item.toLowerCase().replace(/\s+/g, " ").trim();
    const quantity = parseQty(pair.quantity);
    const idx = byKey.get(key);
    if (idx == null) {
      byKey.set(key, out.length);
      out.push({ item, quantity });
      continue;
    }
    const prev = Number(parseQty(out[idx].quantity));
    const next = Number(quantity);
    out[idx] = { item: out[idx].item, quantity: String(Math.max(prev, next)) };
  }
  return out;
}

function buildOrderPairs(fields: Record<string, unknown>): OrderPair[] {
  let fromLineItems: unknown = fields["line_items"];
  if (typeof fromLineItems === "string") {
    const raw = fromLineItems.trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      try {
        fromLineItems = JSON.parse(raw);
      } catch {
        fromLineItems = fields["line_items"];
      }
    }
  }
  if (Array.isArray(fromLineItems)) {
    const pairs = fromLineItems
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const item = String((entry as Record<string, unknown>).item ?? "").trim();
        const quantity = parseQty((entry as Record<string, unknown>).quantity);
        if (!item) return null;
        return { item, quantity };
      })
      .filter((entry): entry is OrderPair => Boolean(entry));
    if (pairs.length) return dedupeOrderPairs(pairs);
  }
  const items = toLooseStringList(fields["items"] ?? fields["product"]);
  if (!items.length) return [];
  const quantities = toLooseStringList(fields["quantity"]).map((q) => parseQty(q));
  const pairs = items.map((item, idx) => ({
    item,
    quantity: quantities[idx] ?? quantities[quantities.length - 1] ?? "1",
  }));
  return dedupeOrderPairs(pairs);
}

function buildOrderEditorLines(fields: Record<string, unknown>): OrderEditorLine[] {
  const lineItemsRaw = parseArrayField(fields["line_items"]);
  const pricedLineItemsRaw = parseArrayField(fields["priced_line_items"]);
  const priceByKey = new Map<string, string>();

  for (const row of [...lineItemsRaw, ...pricedLineItemsRaw]) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const key = normalizeOrderItemKey(record.item);
    const unitPrice = normalizeMoneyInput(record.unit_price);
    if (key && unitPrice) priceByKey.set(key, unitPrice);
  }

  const orderedRows = lineItemsRaw.length
    ? lineItemsRaw
    : pricedLineItemsRaw.length
      ? pricedLineItemsRaw
      : buildOrderPairs(fields);

  const lines = orderedRows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const record = row as Record<string, unknown>;
      const item = String(record.item ?? "").trim();
      const quantity = parseQty(record.quantity);
      if (!item) return null;
      return {
        item,
        quantity,
        unitPrice: normalizeMoneyInput(record.unit_price) || priceByKey.get(normalizeOrderItemKey(item)) || "",
      };
    })
    .filter((row): row is OrderEditorLine => Boolean(row));

  if (lines.length) return lines;
  return buildOrderPairs(fields).map((row) => ({
    item: row.item,
    quantity: row.quantity,
    unitPrice: priceByKey.get(normalizeOrderItemKey(row.item)) || "",
  }));
}

function getOrderDraftTotal(fields: Record<string, unknown>): string {
  for (const key of ["total", "total_cost", "totalcost", "amount"]) {
    const value = normalizeMoneyInput(fields[key]);
    if (value) return value;
  }
  return "";
}

function computeOrderEditorLineTotal(line: OrderEditorLine): string {
  const unitPrice = parseMoneyInput(line.unitPrice);
  if (unitPrice == null) return "";
  const quantity = Number(parseQty(line.quantity));
  return formatMoneyInput(unitPrice * Math.max(1, quantity || 1));
}

function computeOrderEditorTotal(lines: OrderEditorLine[]): string {
  if (!lines.length) return "";
  let total = 0;
  for (const line of lines) {
    const unitPrice = parseMoneyInput(line.unitPrice);
    if (unitPrice == null) return "";
    const quantity = Number(parseQty(line.quantity));
    total += unitPrice * Math.max(1, quantity || 1);
  }
  return formatMoneyInput(total);
}

function applyOrderEditorToFields(
  baseFields: Record<string, unknown>,
  lines: OrderEditorLine[],
  totalInput: string,
): Record<string, unknown> {
  const nextFields: Record<string, unknown> = { ...baseFields };
  const normalizedLines = lines
    .map((line) => ({
      item: String(line.item ?? "").trim(),
      quantity: parseQty(line.quantity),
      unitPrice: normalizeMoneyInput(line.unitPrice),
    }))
    .filter((line) => line.item);

  if (normalizedLines.length) {
    const items = normalizedLines.map((line) => line.item);
    const quantities = normalizedLines.map((line) => line.quantity);
    const lineItems = normalizedLines.map((line) => {
      const row: Record<string, unknown> = {
        item: line.item,
        quantity: line.quantity,
      };
      if (line.unitPrice) {
        row.unit_price = line.unitPrice;
        row.line_total = formatMoneyInput(Number(line.quantity) * Number(line.unitPrice));
      }
      return row;
    });

    nextFields.items = items;
    nextFields.product = items[0];
    nextFields.quantity = quantities;
    nextFields.line_items = lineItems;

    const allPriced = lineItems.every((row) => typeof row.unit_price === "string" && row.unit_price.trim());
    if (allPriced) {
      nextFields.priced_line_items = lineItems.map((row) => ({
        item: row.item,
        quantity: row.quantity,
        unit_price: row.unit_price,
        line_total: row.line_total,
      }));
    } else {
      delete nextFields.priced_line_items;
    }
  } else {
    delete nextFields.items;
    delete nextFields.product;
    delete nextFields.quantity;
    delete nextFields.line_items;
    delete nextFields.priced_line_items;
  }

  const normalizedTotal = normalizeMoneyInput(totalInput) || computeOrderEditorTotal(normalizedLines);
  if (normalizedTotal) {
    nextFields.total = normalizedTotal;
  } else {
    delete nextFields.total;
  }
  delete nextFields.total_cost;
  delete nextFields.totalcost;
  delete nextFields.amount;
  return nextFields;
}

function formatItemsCell(fields: Record<string, unknown>): string {
  const pairs = buildOrderPairs(fields);
  if (pairs.length) {
    return pairs.map((pair) => `${pair.item} x ${pair.quantity}`).join(", ");
  }

  const primaryNarrative =
    firstFieldText(fields, ["issue", "details", "reason", "requestdetails", "request"]) ||
    firstFieldText(fields, ["summary", "title"]);
  const referenceBits = [
    firstFieldText(fields, ["orderid", "referenceid", "refid"]),
    firstFieldText(fields, ["warrantynumber", "serial", "serialnumber"]),
    firstFieldText(fields, ["invoice", "receipt"]),
  ].filter(Boolean);

  const combined = [primaryNarrative, ...referenceBits].filter(Boolean).join(" | ").trim();
  if (!combined) return "-";
  return combined.length > 140 ? `${combined.slice(0, 137)}...` : combined;
}

const INVALID_CUSTOMER_NAME_TOKENS = new Set([
  "yes",
  "yep",
  "yeah",
  "ok",
  "okay",
  "sure",
  "confirm",
  "confirmed",
  "correct",
  "right",
  "done",
  "ordercreation",
  "order",
  "orders",
  "paymentstatus",
  "refund",
  "cancellation",
  "complaint",
  "warrantyclaim",
  "invoice",
]);

function isLikelyInvalidCustomerName(value: string): boolean {
  const txt = value.trim();
  if (!txt) return true;
  const lowered = txt.toLowerCase().replace(/\s+/g, " ").trim();
  if (!lowered) return true;
  if (/\d/.test(lowered)) return true;
  if (INVALID_CUSTOMER_NAME_TOKENS.has(lowered)) return true;
  return false;
}

function firstFieldText(fields: Record<string, unknown>, aliases: string[]): string {
  const normalized = new Set(aliases.map((a) => a.toLowerCase().replace(/[^a-z0-9]/g, "")));
  for (const [rawKey, rawValue] of Object.entries(fields)) {
    const key = rawKey.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!normalized.has(key)) continue;
    const values = toLooseStringList(rawValue);
    const first = values.find(Boolean);
    if (first) return first;
  }
  return "";
}

function prettifyFieldLabel(key: string): string {
  const cleaned = String(key ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!cleaned) return "Field";
  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatOrderLineItemsFromFields(fields: Record<string, unknown>): string | null {
  const lineItemsRaw = fields["line_items"];
  if (Array.isArray(lineItemsRaw)) {
    const pairs = lineItemsRaw
      .map((entry) => {
        if (!entry || typeof entry !== "object") return "";
        const item = String((entry as Record<string, unknown>).item ?? "").trim();
        const qty = String((entry as Record<string, unknown>).quantity ?? "").trim();
        const unitPrice = String((entry as Record<string, unknown>).unit_price ?? "").trim();
        const lineTotal = String((entry as Record<string, unknown>).line_total ?? "").trim();
        if (!item && !qty && !unitPrice) return "";
        if (!item) return `qty ${qty}`;
        if (!qty && !unitPrice) return item;
        if (qty && unitPrice && lineTotal) return `${item} (qty ${qty} x ${unitPrice} = ${lineTotal})`;
        if (qty && unitPrice) return `${item} (qty ${qty} x ${unitPrice})`;
        if (qty) return `${item} (qty ${qty})`;
        return item;
      })
      .filter(Boolean);
    if (pairs.length) return pairs.join("; ");
  }
  const items = toStringList(fields["items"]);
  const quantities = toStringList(fields["quantity"]);
  if (!items.length) return null;
  if (!quantities.length) return items.join("; ");
  const max = Math.min(items.length, quantities.length);
  if (max <= 0) return items.join("; ");
  const pairs: string[] = [];
  for (let i = 0; i < max; i++) {
    pairs.push(`${items[i]} (qty ${quantities[i]})`);
  }
  if (items.length > max) {
    for (let i = max; i < items.length; i++) pairs.push(items[i]);
  }
  return pairs.join("; ");
}

function formatFieldValue(value: unknown, key?: string, fields?: Record<string, unknown>): string {
  if (value == null) return "-";
  if (fields && (key === "items" || key === "line_items")) {
    const paired = formatOrderLineItemsFromFields(fields);
    if (paired) return paired;
  }
  if (Array.isArray(value)) {
    const parts = value.map((v) => String(v ?? "").trim()).filter(Boolean);
    return parts.length ? parts.join(", ") : "-";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

type ImportantFieldRow = {
  key: string;
  label: string;
  value: string;
};

function getImportantFieldRows(fields: Record<string, unknown>): ImportantFieldRow[] {
  const preferredKeys = [
    "issue",
    "details",
    "reason",
    "requestdetails",
    "orderid",
    "paymentstatus",
    "paymentreference",
    "expectedamount",
    "paidamount",
    "referenceid",
    "warrantynumber",
    "invoice",
    "line_items",
    "items",
    "product",
    "quantity",
    "name",
    "contact",
    "phone",
    "customerphone",
  ];
  const seen = new Set<string>();
  const rows: ImportantFieldRow[] = [];

  for (const preferredKey of preferredKeys) {
    for (const [rawKey, rawValue] of Object.entries(fields)) {
      const normalizedKey = rawKey.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (normalizedKey !== preferredKey.replace(/[^a-z0-9]/g, "")) continue;
      const value = formatFieldValue(rawValue, rawKey, fields).trim();
      if (!value || value === "-" || seen.has(normalizedKey)) continue;
      rows.push({
        key: rawKey,
        label: prettifyFieldLabel(rawKey),
        value,
      });
      seen.add(normalizedKey);
    }
  }

  return rows;
}

function priorityPillStyle(priorityRaw: string): CSSProperties {
  const priority = priorityRaw.toLowerCase();
  if (priority === "urgent") {
    return {
      background: "rgba(239, 68, 68, 0.16)",
      color: "#fca5a5",
      border: "1px solid rgba(239, 68, 68, 0.35)",
    };
  }
  if (priority === "high") {
    return {
      background: "rgba(249, 115, 22, 0.14)",
      color: "#fdba74",
      border: "1px solid rgba(249, 115, 22, 0.3)",
    };
  }
  if (priority === "normal") {
    return {
      background: "rgba(56, 189, 248, 0.12)",
      color: "#7dd3fc",
      border: "1px solid rgba(56, 189, 248, 0.28)",
    };
  }
  return {
    background: "rgba(148, 163, 184, 0.12)",
    color: "#cbd5e1",
    border: "1px solid rgba(148, 163, 184, 0.28)",
  };
}

function normalizeTicketTypeLabel(typeKey: string, label: string): string {
  if (typeKey === "ordercreation") return "Orders";
  return label;
}

function isOrderTicketRow(ticket: TicketRow): boolean {
  return getTicketString(ticket, "ticketTypeKey", "ticket_type_key").toLowerCase() === "ordercreation";
}

function resolveOrderStage(ticket: TicketRow): OrderStage {
  const orderStatus = getTicketString(ticket, "orderStatus", "order_status").toLowerCase();
  if (ORDER_STAGE_OPTIONS.includes(orderStatus as OrderStage)) {
    return orderStatus as OrderStage;
  }
  const outcome = getTicketString(ticket, "outcome", "outcome").toLowerCase();
  if (outcome === "lost") return "denied";
  if (outcome === "won") return "approved";
  return "pending_approval";
}

function formatOrderStage(stage: OrderStage): string {
  if (stage === "pending_approval") return "Pending approval";
  return formatStatus(stage);
}

function describeOrderStage(stage: OrderStage): string {
  if (stage === "pending_approval") return "Review the ticket, confirm details, then approve or deny it.";
  if (stage === "approved") return "Approved and moved into the Orders workspace for fulfilment tracking.";
  if (stage === "awaiting_payment") return "Approved and waiting for the customer to send payment proof.";
  if (stage === "payment_submitted") return "Payment proof received and waiting for staff review.";
  if (stage === "payment_rejected") return "Customer needs to resend payment proof.";
  if (stage === "paid") return "Payment approved and revenue captured.";
  if (stage === "refund_pending") return "Refund is being processed.";
  if (stage === "refunded") return "Refund completed and order closed.";
  return "Order flow closed without approval.";
}

function orderStagePillStyle(stage: OrderStage): CSSProperties {
  if (stage === "paid") {
    return {
      background: "rgba(34, 197, 94, 0.12)",
      color: "#86efac",
      border: "1px solid rgba(34, 197, 94, 0.28)",
    };
  }
  if (stage === "awaiting_payment" || stage === "payment_submitted") {
    return {
      background: "rgba(245, 158, 11, 0.12)",
      color: "#fcd34d",
      border: "1px solid rgba(245, 158, 11, 0.28)",
    };
  }
  if (stage === "approved") {
    return {
      background: "rgba(56, 189, 248, 0.12)",
      color: "#7dd3fc",
      border: "1px solid rgba(56, 189, 248, 0.28)",
    };
  }
  if (stage === "refund_pending") {
    return {
      background: "rgba(249, 115, 22, 0.12)",
      color: "#fdba74",
      border: "1px solid rgba(249, 115, 22, 0.28)",
    };
  }
  if (stage === "refunded") {
    return {
      background: "rgba(139, 92, 246, 0.12)",
      color: "#c4b5fd",
      border: "1px solid rgba(139, 92, 246, 0.28)",
    };
  }
  if (stage === "payment_rejected" || stage === "denied") {
    return {
      background: "rgba(239, 68, 68, 0.12)",
      color: "#fca5a5",
      border: "1px solid rgba(239, 68, 68, 0.28)",
    };
  }
  return {
    background: "rgba(148, 163, 184, 0.12)",
    color: "#cbd5e1",
    border: "1px solid rgba(148, 163, 184, 0.28)",
  };
}

function canApproveOrderStage(stage: OrderStage): boolean {
  return stage === "pending_approval";
}

function canDenyOrderStage(stage: OrderStage): boolean {
  return !["paid", "refund_pending", "refunded", "denied"].includes(stage);
}

export default function TicketsPage() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const router = useRouter();
  const [filtersByType, setFiltersByType] = useState<Record<string, TicketListFilter>>({});
  const [ticketIdQuery, setTicketIdQuery] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updatingOutcomeId, setUpdatingOutcomeId] = useState<string | null>(null);
  const [orderActionTicketId, setOrderActionTicketId] = useState<string | null>(null);
  const [denyDialogTicket, setDenyDialogTicket] = useState<TicketRow | null>(null);
  const [denyReasonDraft, setDenyReasonDraft] = useState("Out of stock");
  const [pendingBotCustomerIds, setPendingBotCustomerIds] = useState<Record<string, boolean>>({});
  const [botPausedOverrides, setBotPausedOverrides] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(0);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const searchParams = useSearchParams();
  const queryTypeKey = (searchParams?.get("type") || "").toLowerCase();
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const ticketTypesQuery = trpc.tickets.listTypes.useQuery({ includeDisabled: true });
  const ticketListInput = useMemo(() => ({ limit: 400 }), []);
  const ticketsQuery = trpc.tickets.listTickets.useQuery(ticketListInput);
  const updateStatus = trpc.tickets.updateTicketStatus.useMutation({
    onSuccess: async () => {
      await ticketsQuery.refetch();
    },
    onSettled: () => setUpdatingId(null),
  });
  const updateOutcome = trpc.tickets.updateTicketOutcome.useMutation({
    onSuccess: async () => {
      await Promise.all([ticketsQuery.refetch(), performanceQuery.refetch()]);
    },
    onSettled: () => setUpdatingOutcomeId(null),
  });
  const invalidateTickets = useCallback(async () => {
    await Promise.all([
      utils.tickets.listTickets.invalidate(),
      utils.tickets.listTypes.invalidate(),
    ]);
  }, [utils]);

  useLivePortalEvents({
    ticketListInputs: [ticketListInput],
    onCatchup: invalidateTickets,
  });
  const toggleBot = trpc.customers.setBotPaused.useMutation({
    onMutate: async (vars) => {
      setPendingBotCustomerIds((prev) => ({ ...prev, [vars.customerId]: true }));
      setBotPausedOverrides((prev) => ({ ...prev, [vars.customerId]: vars.botPaused }));
    },
    onError: (_error, vars) => {
      setBotPausedOverrides((prev) => {
        const next = { ...prev };
        delete next[vars.customerId];
        return next;
      });
    },
    onSettled: async (_data, _error, vars) => {
      if (vars?.customerId) {
        setPendingBotCustomerIds((prev) => {
          const next = { ...prev };
          delete next[vars.customerId];
          return next;
        });
        setBotPausedOverrides((prev) => {
          const next = { ...prev };
          delete next[vars.customerId];
          return next;
        });
      }
      await utils.customers.getBotPausedByIds.invalidate();
    },
  });
  const ticketsData = useMemo(() => ticketsQuery.data ?? [], [ticketsQuery.data]);
  const ticketTypesData = useMemo(() => ticketTypesQuery.data ?? [], [ticketTypesQuery.data]);

  const approveOrderTicket = trpc.tickets.approveOrderTicket.useMutation({
    onSuccess: async (result, vars) => {
      await Promise.all([
        utils.tickets.listTickets.invalidate(),
        utils.tickets.listTicketEvents.invalidate(),
        utils.tickets.getPerformance.invalidate(),
        utils.orders.listOrders.invalidate(),
        utils.orders.getStats.invalidate(),
      ]);
      if (selectedTicketId === vars.id) {
        setSelectedTicketId(null);
      }
      if (result.delivery && !result.delivery.ok && result.delivery.error) {
        showInfoToast(toast, {
          title: "Ticket approved",
          message: `Ticket was approved, but payment instructions could not be sent: ${result.delivery.error}`,
          durationMs: 6200,
        });
        return;
      }
      showSuccessToast(toast, {
        title: "Ticket approved",
        message:
          String(result.order?.paymentMethod || "").toLowerCase() === "bank_qr"
            ? "Ticket was approved and payment instructions were sent to the customer."
            : "Ticket was approved successfully.",
      });
    },
    onError: (error) => {
      showErrorToast(toast, {
        title: "Approval failed",
        message: error.message || "Failed to approve order ticket.",
      });
    },
    onSettled: () => setOrderActionTicketId(null),
  });
  const denyOrderTicket = trpc.tickets.denyOrderTicket.useMutation({
    onSuccess: async (_result, vars) => {
      await Promise.all([
        utils.tickets.listTickets.invalidate(),
        utils.tickets.listTicketEvents.invalidate(),
        utils.tickets.getPerformance.invalidate(),
        utils.orders.listOrders.invalidate(),
        utils.orders.getStats.invalidate(),
      ]);
      if (selectedTicketId === vars.id) {
        setSelectedTicketId(null);
      }
      setDenyDialogTicket(null);
      showSuccessToast(toast, {
        title: "Ticket denied",
        message: "Ticket was denied successfully.",
      });
    },
    onError: (error) => {
      showErrorToast(toast, {
        title: "Denial failed",
        message: error.message || "Failed to deny order ticket.",
      });
    },
    onSettled: () => setOrderActionTicketId(null),
  });

  const groupedTickets = useMemo(() => {
    const ticketsByType = new Map<string, TicketRow[]>();
    for (const ticket of ticketsData as TicketRow[]) {
      const key = ticket.ticketTypeKey || "untyped";
      const current = ticketsByType.get(key) ?? [];
      current.push(ticket);
      ticketsByType.set(key, current);
    }

    const groups: Array<{
      typeKey: string;
      label: string;
      enabled: boolean;
      rows: TicketRow[];
    }> = [];

    for (const type of ticketTypesData) {
      groups.push({
        typeKey: type.key,
        label: normalizeTicketTypeLabel(type.key, type.label),
        enabled: type.enabled,
        rows: ticketsByType.get(type.key) ?? [],
      });
      ticketsByType.delete(type.key);
    }

    for (const [typeKey, rows] of ticketsByType.entries()) {
      groups.push({
        typeKey,
        label: typeKey,
        enabled: true,
        rows,
      });
    }

    return groups;
  }, [ticketTypesData, ticketsData]);

  const normalizedGroups = useMemo(() => groupedTickets.sort((a, b) => a.label.localeCompare(b.label)), [groupedTickets]);

  const effectiveTypeKey = useMemo(() => {
    if (!normalizedGroups.length) return null;
    if (queryTypeKey && normalizedGroups.some((g) => g.typeKey === queryTypeKey)) return queryTypeKey;
    return normalizedGroups[0]?.typeKey ?? null;
  }, [normalizedGroups, queryTypeKey]);
  const performanceQuery = trpc.tickets.getPerformance.useQuery(
    effectiveTypeKey ? { typeKey: effectiveTypeKey, windowDays: 30 } : { windowDays: 30 },
  );

  const activeGroup = useMemo(
    () => normalizedGroups.find((g) => g.typeKey === effectiveTypeKey) ?? null,
    [normalizedGroups, effectiveTypeKey],
  );
  const activeFilterKey = effectiveTypeKey ?? "__all";
  const statusFilter = filtersByType[activeFilterKey] ?? "all";
  const isOrderTicketView = activeGroup?.typeKey === "ordercreation";
  const filteredRows = useMemo(() => {
    let rows = activeGroup?.rows ?? [];
    if (isOrderTicketView && statusFilter !== "all") {
      rows = rows.filter((ticket) => resolveOrderStage(ticket) === statusFilter);
    } else if (!isOrderTicketView && statusFilter !== "all") {
      rows = rows.filter((ticket) => {
        const normalizedStatus = ticket.status === "closed" ? "resolved" : ticket.status;
        return normalizedStatus === statusFilter;
      });
    }
    const q = ticketIdQuery.trim().toLowerCase().replace(/^#/, "");
    if (!q) return rows;
    return rows.filter((ticket) => {
      const full = ticket.id.toLowerCase();
      const short = shortId(ticket.id).toLowerCase();
      return full.includes(q) || short.includes(q);
    });
  }, [activeGroup?.rows, isOrderTicketView, statusFilter, ticketIdQuery]);
  const typeRequiresNameMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const type of ticketTypesData as Array<Record<string, unknown>>) {
      const key = String(type.key ?? "").trim().toLowerCase();
      if (!key) continue;
      const required = toLooseStringList((type.requiredFields ?? type.required_fields) as unknown)
        .map((field) => field.toLowerCase().replace(/[^a-z0-9]/g, ""));
      map.set(key, required.includes("name") || required.includes("customername"));
    }
    return map;
  }, [ticketTypesData]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = useMemo(
    () => filteredRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [filteredRows, safePage],
  );
  const customerIdsOnPage = useMemo(() => {
    const ids = new Set<string>();
    for (const row of pageRows) {
      const customerId = getTicketString(row as TicketRow, "customerId", "customer_id");
      if (customerId) ids.add(customerId);
    }
    return Array.from(ids);
  }, [pageRows]);
  const customerBotPausedMapQuery = trpc.customers.getBotPausedByIds.useQuery(
    { ids: customerIdsOnPage },
    { enabled: customerIdsOnPage.length > 0 },
  );
  const selectedTicket = useMemo(() => {
    if (!selectedTicketId) return null;
    return (ticketsData as TicketRow[]).find((t) => t.id === selectedTicketId) ?? null;
  }, [selectedTicketId, ticketsData]);
  const getThreadHref = useCallback((ticket: TicketRow) => {
    const params = new URLSearchParams();
    if (ticket.threadId) params.set("threadId", ticket.threadId);
    else if (ticket.customerId) params.set("customerId", ticket.customerId);
    else if (ticket.customerPhone) params.set("phone", ticket.customerPhone);
    const query = params.toString();
    return query ? `/portal/messages?${query}` : "/portal/messages";
  }, []);

  const handleApproveTicket = async (ticketId: string) => {
    setOrderActionTicketId(ticketId);
    try {
      await approveOrderTicket.mutateAsync({ id: ticketId });
    } catch {
      // Toast is handled by the mutation onError path.
    }
  };

  const openDenyDialog = (ticket: TicketRow) => {
    setDenyDialogTicket(ticket);
    setDenyReasonDraft(getTicketString(ticket, "lossReason", "loss_reason") || "Out of stock");
  };

  const handleConfirmDeny = async () => {
    if (!denyDialogTicket) return;
    const normalizedReason = denyReasonDraft.trim() || "Denied";
    setOrderActionTicketId(denyDialogTicket.id);
    try {
      await denyOrderTicket.mutateAsync({
        id: denyDialogTicket.id,
        reason: normalizedReason,
      });
    } catch {
      // Toast is handled by the mutation onError path.
    }
  };

  return (
    <>
    <PortalDataTable
      search={{
        value: ticketIdQuery,
        onChange: (value) => {
          setTicketIdQuery(value);
          setPage(0);
        },
        placeholder: "Search ticket ID...",
        style: { width: "min(520px, 52vw)", minWidth: 220, flex: "0 1 520px" },
      }}
      countText={`${filteredRows.length} ticket${filteredRows.length !== 1 ? "s" : ""}`}
      endControls={(
        <>
          <label htmlFor="ticket-status-filter" style={{ color: "var(--muted)", fontSize: 12 }}>
            {isOrderTicketView ? "Stage" : "Status"}
          </label>
        <TableSelect
          id="ticket-status-filter"
          style={{ width: isOrderTicketView ? 170 : 120 }}
          value={statusFilter}
          onChange={(e) => {
            const nextFilter = e.target.value as TicketListFilter;
            setFiltersByType((prev) => ({ ...prev, [activeFilterKey]: nextFilter }));
            setPage(0);
          }}
        >
          {isOrderTicketView ? (
            <>
              <option value="all">All stages</option>
              <option value="pending_approval">Pending Approval</option>
              <option value="approved">Approved</option>
              <option value="awaiting_payment">Awaiting Payment</option>
              <option value="payment_submitted">Payment Review</option>
              <option value="payment_rejected">Payment Rejected</option>
              <option value="paid">Paid</option>
              <option value="refund_pending">Refund Pending</option>
              <option value="refunded">Refunded</option>
              <option value="denied">Denied</option>
            </>
          ) : (
            <>
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="resolved">Resolved</option>
            </>
          )}
        </TableSelect>
        </>
      )}
      footer={(
        <TablePagination
          page={safePage}
          totalPages={totalPages}
          shownCount={pageRows.length}
          totalCount={filteredRows.length}
          canPrev={safePage > 0}
          canNext={safePage < totalPages - 1}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
        />
      )}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <div className="card">
          <div className="card-body" style={{ padding: "10px 12px" }}>
            <div className="text-muted" style={{ fontSize: 11 }}>30d Conversion</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{performanceQuery.data?.conversionRate ?? 0}%</div>
            <div className="text-muted" style={{ fontSize: 11 }}>
              Won {performanceQuery.data?.wonCount ?? 0} / Lost {performanceQuery.data?.lostCount ?? 0}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body" style={{ padding: "10px 12px" }}>
            <div className="text-muted" style={{ fontSize: 11 }}>SLA On-Time</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{performanceQuery.data?.slaOnTimeRate ?? 0}%</div>
            <div className="text-muted" style={{ fontSize: 11 }}>
              {performanceQuery.data?.resolvedOnTime ?? 0} on-time / {performanceQuery.data?.resolvedTotal ?? 0} resolved
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body" style={{ padding: "10px 12px" }}>
            <div className="text-muted" style={{ fontSize: 11 }}>Overdue Open</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fca5a5" }}>{performanceQuery.data?.overdueOpen ?? 0}</div>
            <div className="text-muted" style={{ fontSize: 11 }}>Needs attention now</div>
          </div>
        </div>
        <div className="card">
          <div className="card-body" style={{ padding: "10px 12px" }}>
            <div className="text-muted" style={{ fontSize: 11 }}>Tickets (30d)</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{performanceQuery.data?.total ?? 0}</div>
            <div className="text-muted" style={{ fontSize: 11 }}>{activeGroup?.label ?? "All types"}</div>
          </div>
        </div>
      </div>

      {!normalizedGroups.length ? (
        <div className="empty-state" style={{ flex: 1 }}>
          <div className="empty-state-title">No tickets found</div>
        </div>
      ) : activeGroup ? (
        <div style={{ overflowX: "hidden", overflowY: "auto", flex: 1, minHeight: 0 }}>
          <table className="table table-clickable portal-modern-table" style={{ width: "100%", tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", width: "16%" }}>Ticket</th>
                <th style={{ textAlign: "left", width: "20%" }}>Customer</th>
                <th style={{ textAlign: "left", width: "24%" }}>Items</th>
                <th style={{ textAlign: "left", width: "10%" }}>Priority</th>
                <th style={{ textAlign: "left", width: "10%" }}>SLA</th>
                <th style={{ textAlign: "center", width: "8%" }}>Bot</th>
                <th style={{ textAlign: "left", width: isOrderTicketView ? "14%" : "9%" }}>
                  {isOrderTicketView ? "Stage" : "Status"}
                </th>
                {!isOrderTicketView ? (
                  <th style={{ textAlign: "right", width: "9%" }}>Outcome</th>
                ) : null}
                <th style={{ textAlign: "center", width: isOrderTicketView ? "12%" : "4%" }} />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((ticket) => {
                const fields = getTicketFields(ticket as TicketRow);
                const typeKey = getTicketString(ticket as TicketRow, "ticketTypeKey", "ticket_type_key").toLowerCase();
                const isOrderRow = typeKey === "ordercreation";
                const orderStage = resolveOrderStage(ticket as TicketRow);
                const requiresName = Boolean(typeRequiresNameMap.get(typeKey));
                const phoneFromTicket = getTicketString(ticket as TicketRow, "customerPhone", "customer_phone").trim();
                const phoneFromFields = firstFieldText(fields, ["contact", "phone", "phoneNumber", "mobile", "whatsapp", "customerPhone"]);
                const customerPhone = phoneFromTicket || phoneFromFields;
                const nameFromFields = firstFieldText(fields, ["name", "customerName", "customer_name"]);
                const nameFromTicket = getTicketString(ticket as TicketRow, "customerName", "customer_name").trim();
                const rawCustomerName = nameFromFields || nameFromTicket;
                const customerName = rawCustomerName && !isLikelyInvalidCustomerName(rawCustomerName) ? rawCustomerName : "";
                const customerPrimary = requiresName ? (customerName || customerPhone || "-") : (customerPhone || "-");
                const customerSecondary = requiresName
                  ? (customerPhone && customerPhone !== customerPrimary ? customerPhone : (!customerPhone ? "No phone" : ""))
                  : (!customerPhone ? "No phone" : "");
                const itemsLabel = formatItemsCell(fields);
                const ticketDate = formatDate(
                  (getTicketValue(ticket as TicketRow, "updatedAt", "updated_at") as Date | string | null | undefined) ?? ticket.createdAt,
                );
                return (
                  <tr
                    key={ticket.id}
                    onClick={(e) => {
                      const target = e.target as HTMLElement | null;
                      const interactive = target?.closest(
                        "button, a, input, textarea, select, [role='button'], .portal-select-trigger, .portal-select-content, .portal-select-item",
                      );
                      if (interactive) return;
                      setSelectedTicketId(ticket.id);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      <div style={{ display: "grid", gap: 3 }}>
                        <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700 }} title={ticket.id}>
                          #{shortId(ticket.id)}
                        </div>
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>
                          {ticketDate}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "grid", gap: 3 }}>
                        <div style={{ wordBreak: "break-word" }}>{customerPrimary}</div>
                        {customerSecondary ? (
                          <div style={{ color: "var(--muted)", fontSize: 12, wordBreak: "break-word" }}>
                            {customerSecondary}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          display: "block",
                          color: "var(--foreground)",
                          fontSize: 13,
                          lineHeight: 1.35,
                          whiteSpace: "normal",
                          wordBreak: "break-word",
                        }}
                        title={itemsLabel}
                      >
                        {itemsLabel}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          ...priorityPillStyle(getTicketString(ticket, "priority") || "normal"),
                          padding: "4px 10px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          letterSpacing: "0.01em",
                          textTransform: "uppercase",
                          display: "inline-flex",
                        }}
                      >
                        {(getTicketString(ticket, "priority") || "normal")}
                      </span>
                    </td>
                    <td>
                      {(() => {
                        const sla = formatSlaCountdown(
                          getTicketValue(ticket, "slaDueAt", "sla_due_at") as Date | string | null | undefined,
                          nowMs,
                        );
                        const toneColor =
                          sla.tone === "danger" ? "#fca5a5" : sla.tone === "warn" ? "#fdba74" : sla.tone === "ok" ? "#86efac" : "var(--muted)";
                        return <span style={{ fontSize: 12, color: toneColor }}>{sla.label}</span>;
                      })()}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {getTicketString(ticket, "customerId", "customer_id") ? (
                        (() => {
                          const customerId = getTicketString(ticket, "customerId", "customer_id");
                          const paused = botPausedOverrides[customerId] ?? Boolean(customerBotPausedMapQuery.data?.[customerId]);
                          const isPending = Boolean(pendingBotCustomerIds[customerId]);
                          return (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isPending) return;
                                toggleBot.mutate({ customerId, botPaused: !paused });
                              }}
                              disabled={isPending}
                              style={{ width: "100%", justifyContent: "center", opacity: isPending ? 0.6 : 1 }}
                            >
                              {paused ? "Resume" : "Pause"}
                            </button>
                          );
                        })()
                      ) : (
                        <span className="text-muted" style={{ fontSize: 12 }}>-</span>
                      )}
                    </td>
                    <td style={{ textAlign: isOrderRow ? "left" : "right" }}>
                      {isOrderRow ? (
                        <div style={{ display: "grid", gap: 4 }}>
                          <span
                            style={{
                              ...orderStagePillStyle(orderStage),
                              padding: "4px 10px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 700,
                              letterSpacing: "0.01em",
                              textTransform: "uppercase",
                              display: "inline-flex",
                              width: "fit-content",
                            }}
                          >
                            {formatOrderStage(orderStage)}
                          </span>
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>
                            {describeOrderStage(orderStage)}
                          </div>
                        </div>
                      ) : (
                        <TableSelect
                          style={{ width: "100%" }}
                          value={(ticket.status === "closed" ? "resolved" : ticket.status) as TicketStatus}
                          disabled={updatingId === ticket.id}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const nextStatus = e.target.value as TicketStatus;
                            setUpdatingId(ticket.id);
                            updateStatus.mutate({ id: ticket.id, status: nextStatus });
                          }}
                        >
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </TableSelect>
                      )}
                    </td>
                    {!isOrderTicketView ? (
                      <td style={{ textAlign: "right" }}>
                        <TableSelect
                          style={{ width: "100%" }}
                          value={(getTicketString(ticket, "outcome", "outcome") || "pending") as TicketOutcome}
                          disabled={updatingOutcomeId === ticket.id || ticket.status !== "resolved"}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const nextOutcome = e.target.value as TicketOutcome;
                            setUpdatingOutcomeId(ticket.id);
                            updateOutcome.mutate({
                              id: ticket.id,
                              outcome: nextOutcome,
                              lossReason:
                                nextOutcome === "lost"
                                  ? getTicketString(ticket, "lossReason", "loss_reason") || "Other"
                                  : undefined,
                            });
                          }}
                        >
                          {OUTCOME_OPTIONS.map((outcome) => (
                            <option key={outcome} value={outcome}>
                              {outcome}
                            </option>
                          ))}
                        </TableSelect>
                      </td>
                    ) : null}
                    <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      {isOrderRow ? (
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={orderActionTicketId !== null || !canApproveOrderStage(orderStage)}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleApproveTicket(ticket.id);
                            }}
                          >
                            {orderActionTicketId === ticket.id && canApproveOrderStage(orderStage) ? "Approving..." : "Approve"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={orderActionTicketId !== null || !canDenyOrderStage(orderStage)}
                            onClick={(e) => {
                              e.stopPropagation();
                              openDenyDialog(ticket as TicketRow);
                            }}
                          >
                            Deny
                          </button>
                          <RowActionsMenu
                            items={[
                              {
                                label: "Open Details",
                                onSelect: () => setSelectedTicketId(ticket.id),
                              },
                              {
                                label: "Open Thread",
                                onSelect: () => router.push(getThreadHref(ticket as TicketRow)),
                              },
                              {
                                label: "Customer Details",
                                disabled: !getTicketString(ticket as TicketRow, "customerId", "customer_id"),
                                onSelect: () => {
                                  const customerId = getTicketString(ticket as TicketRow, "customerId", "customer_id");
                                  if (!customerId) return;
                                  router.push(`/portal/customers?customerId=${encodeURIComponent(customerId)}`);
                                },
                              },
                            ]}
                          />
                        </div>
                      ) : (
                        <RowActionsMenu
                          items={[
                            {
                              label: "Open Thread",
                              onSelect: () => router.push(getThreadHref(ticket as TicketRow)),
                            },
                            {
                              label: "Customer Details",
                              disabled: !getTicketString(ticket as TicketRow, "customerId", "customer_id"),
                              onSelect: () => {
                                const customerId = getTicketString(ticket as TicketRow, "customerId", "customer_id");
                                if (!customerId) return;
                                router.push(`/portal/customers?customerId=${encodeURIComponent(customerId)}`);
                              },
                            },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={isOrderTicketView ? 8 : 9} style={{ color: "var(--muted)", textAlign: "center", padding: "20px 10px" }}>
                    {ticketIdQuery ? (
                      "No ticket IDs match your search."
                    ) : (
                      <div style={{ display: "grid", placeItems: "center", gap: 10, padding: "8px 0" }}>
                        <div
                          aria-hidden
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 12,
                            display: "grid",
                            placeItems: "center",
                            color: "#D4A84B",
                            border: "1px solid rgba(212, 168, 75, 0.45)",
                            background: "linear-gradient(135deg, rgba(212,168,75,0.16), rgba(212,168,75,0.06))",
                          }}
                        >
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M8 21h8" />
                            <path d="M12 17v4" />
                            <path d="M7 4h10v6a5 5 0 0 1-10 0V4z" />
                            <path d="M17 6h3a2 2 0 0 1-2 2h-1" />
                            <path d="M7 6H4a2 2 0 0 0 2 2h1" />
                          </svg>
                        </div>
                        <div style={{ color: "var(--foreground, #e2e8f0)", fontWeight: 600 }}>
                          Congratulations!
                        </div>
                        <div style={{ color: "var(--muted)", fontSize: 13 }}>
                          Well done, no pending tickets in this type.
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
      <TicketDetailsDrawer
        key={selectedTicket?.id ?? "ticket-details"}
        ticket={selectedTicket}
        onClose={() => setSelectedTicketId(null)}
        threadHref={selectedTicket ? getThreadHref(selectedTicket) : "/portal/messages"}
        nowMs={nowMs}
      />
    </PortalDataTable>
    {denyDialogTicket ? (
      <>
        <div className="drawer-backdrop open" onClick={() => setDenyDialogTicket(null)} />
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 4200,
            display: "grid",
            placeItems: "center",
            padding: 20,
            pointerEvents: "none",
          }}
        >
          <div
            className="card"
            style={{
              width: "min(520px, calc(100vw - 32px))",
              pointerEvents: "auto",
              border: "1px solid rgba(212, 168, 75, 0.28)",
              boxShadow: "0 26px 64px rgba(0, 0, 0, 0.42)",
            }}
          >
            <div className="card-body" style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>Deny order ticket</div>
                <div className="text-muted" style={{ fontSize: 13 }}>
                  Add the internal reason for denying this order. The ticket will close and the order stage will move to denied.
                </div>
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>Reason</div>
                <textarea
                  value={denyReasonDraft}
                  onChange={(e) => setDenyReasonDraft(e.target.value)}
                  placeholder="Out of stock"
                  style={{
                    width: "100%",
                    minHeight: 110,
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    background: "var(--card)",
                    color: "var(--foreground)",
                    padding: "10px 12px",
                    resize: "vertical",
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={orderActionTicketId !== null}
                  onClick={() => setDenyDialogTicket(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={orderActionTicketId !== null}
                  onClick={() => void handleConfirmDeny()}
                >
                  {orderActionTicketId === denyDialogTicket.id ? "Denying..." : "Confirm Deny"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    ) : null}
    </>
  );
}

function TicketDetailsDrawer({
  ticket,
  onClose,
  threadHref,
  nowMs,
}: {
  ticket: TicketRow | null;
  onClose: () => void;
  threadHref: string;
  nowMs: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [updatingOutcome, setUpdatingOutcome] = useState(false);
  const [updatingSla, setUpdatingSla] = useState(false);
  const [savingTicket, setSavingTicket] = useState(false);
  const ticketId = ticket?.id ?? "";
  const updateOutcome = trpc.tickets.updateTicketOutcome.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.tickets.listTickets.invalidate(),
        utils.tickets.getPerformance.invalidate(),
      ]);
      showSuccessToast(toast, {
        title: "Outcome updated",
        message: "Ticket outcome saved successfully.",
      });
    },
    onError: (error) => {
      showErrorToast(toast, {
        title: "Update failed",
        message: error.message || "Ticket outcome could not be saved.",
      });
    },
    onSettled: () => setUpdatingOutcome(false),
  });
  const updateSlaDueAt = trpc.tickets.updateTicketSlaDueAt.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.tickets.listTickets.invalidate(),
        utils.tickets.listTicketEvents.invalidate(),
        utils.tickets.getPerformance.invalidate(),
      ]);
      showSuccessToast(toast, {
        title: "SLA updated",
        message: "Ticket SLA saved successfully.",
      });
    },
    onError: (error) => {
      showErrorToast(toast, {
        title: "Update failed",
        message: error.message || "Ticket SLA could not be saved.",
      });
    },
    onSettled: () => setUpdatingSla(false),
  });
  const updateTicket = trpc.tickets.updateTicket.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.tickets.listTickets.invalidate(),
        utils.tickets.listTicketEvents.invalidate(),
      ]);
      showSuccessToast(toast, {
        title: "Ticket updated",
        message: "Ticket details saved successfully.",
      });
    },
    onError: (error) => {
      showErrorToast(toast, {
        title: "Save failed",
        message: error.message || "Ticket details could not be saved.",
      });
    },
    onSettled: () => setSavingTicket(false),
  });
  const eventsQuery = trpc.tickets.listTicketEvents.useQuery(
    { ticketId, limit: 80 },
    { enabled: Boolean(ticketId) },
  );
  const slaDueAtRaw = ticket
    ? (getTicketValue(ticket, "slaDueAt", "sla_due_at") as Date | string | null | undefined)
    : null;
  const fields = ticket ? getTicketFields(ticket) : {};
  const initialCustomerName = ticket
    ? (
        firstFieldText(fields, ["name", "customerName", "customer_name"]) ||
        getTicketString(ticket, "customerName", "customer_name")
      )
    : "";
  const initialCustomerPhone = ticket
    ? (
        firstFieldText(fields, ["contact", "phone", "phoneNumber", "mobile", "whatsapp", "customerPhone"]) ||
        getTicketString(ticket, "customerPhone", "customer_phone")
      )
    : "";
  const [slaInput, setSlaInput] = useState(() => toDateTimeLocalValue(slaDueAtRaw));
  const [draftTitle, setDraftTitle] = useState(() => ticket?.title || "");
  const [draftSummary, setDraftSummary] = useState(() => ticket?.summary || "");
  const [draftNotes, setDraftNotes] = useState(() => ticket?.notes || "");
  const [draftCustomerName, setDraftCustomerName] = useState(() => initialCustomerName);
  const [draftCustomerPhone, setDraftCustomerPhone] = useState(() => initialCustomerPhone);
  const [draftOrderLines, setDraftOrderLines] = useState<OrderEditorLine[]>(() => buildOrderEditorLines(fields));
  const [draftOrderTotal, setDraftOrderTotal] = useState(() => getOrderDraftTotal(fields));
  const [draftFieldsText, setDraftFieldsText] = useState(() => JSON.stringify(fields, null, 2));
  if (!ticket) return null;
  const isOrderTicket = isOrderTicketRow(ticket);
  const orderStage = resolveOrderStage(ticket);
  const computedOrderTotal = computeOrderEditorTotal(draftOrderLines);
  const fieldRows = Object.entries(fields);
  const importantFieldRows = getImportantFieldRows(fields);
  const status = getTicketString(ticket, "status");
  const outcome = (getTicketString(ticket, "outcome", "outcome") || "pending") as TicketOutcome;
  const lossReason = getTicketString(ticket, "lossReason", "loss_reason");
  const slaDueAt = slaDueAtRaw;
  const slaCountdown = formatSlaCountdown(slaDueAt, nowMs);
  const priority = getTicketString(ticket, "priority");
  const source = getTicketString(ticket, "source");
  const typeKey = getTicketString(ticket, "ticketTypeKey", "ticket_type_key");
  const createdBy = getTicketString(ticket, "createdBy", "created_by");
  const customerName = initialCustomerName;
  const customerPhone = initialCustomerPhone;
  const customerId = getTicketString(ticket, "customerId", "customer_id");
  const customerHref = customerId ? `/portal/customers?customerId=${encodeURIComponent(customerId)}` : null;
  const createdAt = getTicketValue(ticket, "createdAt", "created_at") as Date | string | null | undefined;
  const updatedAt = getTicketValue(ticket, "updatedAt", "updated_at") as Date | string | null | undefined;
  const resolvedAt = getTicketValue(ticket, "resolvedAt", "resolved_at") as Date | string | null | undefined;
  const closedAt = getTicketValue(ticket, "closedAt", "closed_at") as Date | string | null | undefined;

  const handleSaveTicket = () => {
    let parsedFields: Record<string, unknown>;
    try {
      parsedFields = draftFieldsText.trim() ? (JSON.parse(draftFieldsText) as Record<string, unknown>) : {};
    } catch {
      showErrorToast(toast, {
        title: "Invalid JSON",
        message: "Fields must be valid JSON before saving.",
      });
      return;
    }
    if (isOrderTicket) {
      parsedFields = applyOrderEditorToFields(parsedFields, draftOrderLines, draftOrderTotal);
    }
    setSavingTicket(true);
    updateTicket.mutate({
      id: ticket.id,
      title: draftTitle,
      summary: draftSummary,
      notes: draftNotes,
      customerName: draftCustomerName,
      customerPhone: draftCustomerPhone,
      fields: parsedFields,
    });
  };

  return (
    <>
      <div className="drawer-backdrop open" onClick={onClose} />
      <div className="drawer open">
        <div className="drawer-header">
          <h3 className="drawer-title">Ticket Details</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close details">
            x
          </button>
        </div>
        <div className="drawer-body">
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 12 }}>
                <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--muted)" }}>
                  #{shortId(ticket.id)} ({ticket.id})
                </div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{ticket.title || ticket.summary || "Untitled ticket"}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Status</div>
                    <div>{formatStatus(status || "open")}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Priority</div>
                    <div>{formatStatus(priority || "-")}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>{isOrderTicket ? "Order Stage" : "Outcome"}</div>
                    <div>{isOrderTicket ? formatOrderStage(orderStage) : outcome}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>SLA Due</div>
                    <div>{formatDate(slaDueAt)}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>SLA Timer</div>
                    <div>{slaCountdown.label}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Type</div>
                    <div>{formatStatus(typeKey || "-")}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Source</div>
                    <div>{source || "-"}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Created</div>
                    <div>{formatDate(createdAt)}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Updated</div>
                    <div>{formatDate(updatedAt)}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Resolved</div>
                    <div>{formatDate(resolvedAt)}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Closed</div>
                    <div>{formatDate(closedAt)}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Created By</div>
                    <div>{createdBy || "-"}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card" style={{ order: -1 }}>
              <div className="card-body" style={{ display: "grid", gap: 10 }}>
                <div>
                  <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>SLA due date</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="datetime-local"
                      value={slaInput}
                      onChange={(e) => setSlaInput(e.target.value)}
                      style={{
                        width: "100%",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        background: "var(--card)",
                        color: "var(--foreground)",
                        padding: "8px 10px",
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={updatingSla}
                      onClick={() => {
                        setUpdatingSla(true);
                        updateSlaDueAt.mutate({
                          id: ticket.id,
                          slaDueAt: slaInput ? new Date(slaInput) : null,
                        });
                      }}
                    >
                      Save SLA
                    </button>
                  </div>
                </div>
                {isOrderTicket ? (
                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      padding: 12,
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      background: "rgba(255, 255, 255, 0.02)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Current stage</div>
                        <span
                          style={{
                            ...orderStagePillStyle(orderStage),
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            display: "inline-flex",
                          }}
                        >
                          {formatOrderStage(orderStage)}
                        </span>
                      </div>
                      <div style={{ maxWidth: 320 }}>
                        <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Workflow note</div>
                        <div style={{ fontSize: 13, color: "var(--foreground)" }}>{describeOrderStage(orderStage)}</div>
                      </div>
                    </div>
                    {lossReason ? (
                      <div>
                        <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Last denial reason</div>
                        <div style={{ fontSize: 13 }}>{lossReason}</div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                    <div>
                      <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Outcome</div>
                      <TableSelect
                        style={{ width: "100%" }}
                        value={outcome}
                        disabled={updatingOutcome || status !== "resolved"}
                        onChange={(e) => {
                          const nextOutcome = e.target.value as TicketOutcome;
                          setUpdatingOutcome(true);
                          updateOutcome.mutate({
                            id: ticket.id,
                            outcome: nextOutcome,
                            lossReason: nextOutcome === "lost" ? lossReason || "Other" : undefined,
                          });
                        }}
                      >
                        {OUTCOME_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </TableSelect>
                    </div>
                    <div>
                      <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Loss reason</div>
                      <TableSelect
                        style={{ width: "100%" }}
                        value={lossReason || "Other"}
                        disabled={updatingOutcome || outcome !== "lost"}
                        onChange={(e) => {
                          setUpdatingOutcome(true);
                          updateOutcome.mutate({
                            id: ticket.id,
                            outcome: "lost",
                            lossReason: e.target.value,
                          });
                        }}
                      >
                        {LOSS_REASON_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </TableSelect>
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-muted" style={{ fontSize: 12 }}>Customer</div>
                  <div style={{ fontWeight: 500 }}>{customerName || customerPhone || "-"}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Customer ID</div>
                    <div style={{ fontFamily: "monospace", fontSize: 12 }}>{customerId || "-"}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Customer Phone</div>
                    <div style={{ fontFamily: "monospace", fontSize: 12 }}>{customerPhone || "-"}</div>
                  </div>
                </div>
                <div>
                  <div className="text-muted" style={{ fontSize: 12 }}>Summary</div>
                  <p style={{ margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {ticket.summary || ticket.title || "No summary available."}
                  </p>
                </div>
                {importantFieldRows.length ? (
                  <div>
                    <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>Captured Details</div>
                    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                      {importantFieldRows.map((row) => (
                        <div
                          key={row.key}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "140px minmax(0, 1fr)",
                            gap: 10,
                            padding: "8px 10px",
                            borderBottom: "1px solid var(--border)",
                          }}
                        >
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>{row.label}</div>
                          <div style={{ fontSize: 13, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{row.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {ticket.notes ? (
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Notes</div>
                    <p style={{ margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{ticket.notes}</p>
                  </div>
                ) : null}
                {isOrderTicket ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>Edit Ticket</div>
                    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                      <div>
                        <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Title</div>
                        <input
                          type="text"
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          style={{
                            width: "100%",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            background: "var(--card)",
                            color: "var(--foreground)",
                            padding: "8px 10px",
                          }}
                        />
                      </div>
                      <div>
                        <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Customer Name</div>
                        <input
                          type="text"
                          value={draftCustomerName}
                          onChange={(e) => setDraftCustomerName(e.target.value)}
                          style={{
                            width: "100%",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            background: "var(--card)",
                            color: "var(--foreground)",
                            padding: "8px 10px",
                          }}
                        />
                      </div>
                      <div>
                        <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Summary</div>
                        <textarea
                          value={draftSummary}
                          onChange={(e) => setDraftSummary(e.target.value)}
                          style={{
                            width: "100%",
                            minHeight: 90,
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            background: "var(--card)",
                            color: "var(--foreground)",
                            padding: "8px 10px",
                          }}
                        />
                      </div>
                      <div>
                        <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Customer Phone</div>
                        <input
                          type="text"
                          value={draftCustomerPhone}
                          onChange={(e) => setDraftCustomerPhone(e.target.value)}
                          style={{
                            width: "100%",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            background: "var(--card)",
                            color: "var(--foreground)",
                            padding: "8px 10px",
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Internal Notes</div>
                      <textarea
                        value={draftNotes}
                        onChange={(e) => setDraftNotes(e.target.value)}
                        style={{
                          width: "100%",
                          minHeight: 80,
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          background: "var(--card)",
                          color: "var(--foreground)",
                          padding: "8px 10px",
                        }}
                      />
                    </div>
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>Order Items</div>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setDraftOrderLines((current) => [...current, { item: "", quantity: "1", unitPrice: "" }])}
                        >
                          Add Item
                        </button>
                      </div>
                      {draftOrderLines.length ? (
                        <div style={{ display: "grid", gap: 10 }}>
                          {draftOrderLines.map((line, index) => (
                            <div
                              key={`order-line-${index}`}
                              style={{
                                display: "grid",
                                gap: 8,
                                gridTemplateColumns: "minmax(0, 1.8fr) 96px 120px auto",
                                alignItems: "end",
                              }}
                            >
                              <div>
                                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Item</div>
                                <input
                                  type="text"
                                  value={line.item}
                                  onChange={(e) =>
                                    setDraftOrderLines((current) =>
                                      current.map((entry, entryIndex) =>
                                        entryIndex === index ? { ...entry, item: e.target.value } : entry,
                                      ),
                                    )
                                  }
                                  style={{
                                    width: "100%",
                                    border: "1px solid var(--border)",
                                    borderRadius: 8,
                                    background: "var(--card)",
                                    color: "var(--foreground)",
                                    padding: "8px 10px",
                                  }}
                                />
                              </div>
                              <div>
                                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Qty</div>
                                <input
                                  type="number"
                                  min={1}
                                  value={line.quantity}
                                  onChange={(e) =>
                                    setDraftOrderLines((current) =>
                                      current.map((entry, entryIndex) =>
                                        entryIndex === index ? { ...entry, quantity: e.target.value } : entry,
                                      ),
                                    )
                                  }
                                  style={{
                                    width: "100%",
                                    border: "1px solid var(--border)",
                                    borderRadius: 8,
                                    background: "var(--card)",
                                    color: "var(--foreground)",
                                    padding: "8px 10px",
                                  }}
                                />
                              </div>
                              <div>
                                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Unit Price</div>
                                <input
                                  type="text"
                                  value={line.unitPrice}
                                  onChange={(e) =>
                                    setDraftOrderLines((current) =>
                                      current.map((entry, entryIndex) =>
                                        entryIndex === index ? { ...entry, unitPrice: e.target.value } : entry,
                                      ),
                                    )
                                  }
                                  placeholder="Optional"
                                  style={{
                                    width: "100%",
                                    border: "1px solid var(--border)",
                                    borderRadius: 8,
                                    background: "var(--card)",
                                    color: "var(--foreground)",
                                    padding: "8px 10px",
                                  }}
                                />
                              </div>
                              <div style={{ display: "grid", gap: 6 }}>
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  onClick={() =>
                                    setDraftOrderLines((current) => current.filter((_, entryIndex) => entryIndex !== index))
                                  }
                                >
                                  Remove
                                </button>
                                <div className="text-muted" style={{ fontSize: 11, textAlign: "right" }}>
                                  Line Total: {computeOrderEditorLineTotal(line) || "-"}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-muted" style={{ fontSize: 13 }}>No order items yet.</div>
                      )}
                    </div>
                    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                      <div>
                        <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Order Total</div>
                        <input
                          type="text"
                          value={draftOrderTotal}
                          onChange={(e) => setDraftOrderTotal(e.target.value)}
                          placeholder={computedOrderTotal || "Optional"}
                          style={{
                            width: "100%",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            background: "var(--card)",
                            color: "var(--foreground)",
                            padding: "8px 10px",
                          }}
                        />
                      </div>
                      <div>
                        <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Computed Total</div>
                        <div
                          style={{
                            minHeight: 40,
                            display: "flex",
                            alignItems: "center",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            padding: "8px 10px",
                          }}
                        >
                          {computedOrderTotal || "-"}
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Advanced Fields JSON</div>
                      <textarea
                        value={draftFieldsText}
                        onChange={(e) => setDraftFieldsText(e.target.value)}
                        style={{
                          width: "100%",
                          minHeight: 180,
                          fontFamily: "monospace",
                          fontSize: 12,
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          background: "var(--card)",
                          color: "var(--foreground)",
                          padding: "8px 10px",
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button type="button" className="btn btn-primary" disabled={savingTicket} onClick={handleSaveTicket}>
                        {savingTicket ? "Saving..." : "Save Ticket"}
                      </button>
                    </div>
                  </div>
                ) : null}
                <div>
                  <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>Fields</div>
                  {fieldRows.length ? (
                    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                      {fieldRows.map(([key, value]) => (
                        <div
                          key={key}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "140px minmax(0, 1fr)",
                            gap: 10,
                            padding: "8px 10px",
                            borderBottom: "1px solid var(--border)",
                          }}
                        >
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>{key}</div>
                          <div style={{ fontSize: 13, wordBreak: "break-word" }}>
                            {formatFieldValue(value, key, fields)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted" style={{ margin: 0 }}>No structured fields provided.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 8 }}>
                <div className="text-muted" style={{ fontSize: 12 }}>Ticket Timeline</div>
                {!eventsQuery.data?.length ? (
                  <div className="text-muted" style={{ fontSize: 13 }}>No change history yet.</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {(eventsQuery.data as TicketEventRow[]).map((evt) => {
                      const payload = evt.payload ?? {};
                      const pretty = (() => {
                        if (evt.eventType === "status_changed") {
                          return `Status ${(payload.from as string) || "-"} -> ${(payload.to as string) || "-"}`;
                        }
                        if (evt.eventType === "outcome_changed") {
                          return `Outcome ${(payload.from as string) || "-"} -> ${(payload.to as string) || "-"}`;
                        }
                        if (evt.eventType === "sla_changed") {
                          return `SLA ${formatDate(payload.from as string | null | undefined)} -> ${formatDate(payload.to as string | null | undefined)}`;
                        }
                        if (evt.eventType === "created") {
                          return "Ticket created";
                        }
                        return evt.eventType.replace(/_/g, " ");
                      })();
                      return (
                        <div
                          key={evt.id}
                          style={{
                            border: "1px solid var(--border)",
                            borderRadius: 10,
                            padding: "8px 10px",
                            display: "grid",
                            gap: 4,
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{pretty}</div>
                          {(payload.lossReason as string | undefined) ? (
                            <div style={{ fontSize: 12, color: "var(--muted)" }}>
                              Loss reason: {String(payload.lossReason)}
                            </div>
                          ) : null}
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            {formatDate(evt.createdAt)} by {evt.actorLabel || evt.actorType || "system"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onClose();
                  router.push(threadHref);
                }}
              >
                Open Thread
              </button>
              {customerHref ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    onClose();
                    router.push(customerHref);
                  }}
                  style={{ marginLeft: 10 }}
                >
                  Customer Details
                </button>
              ) : (
                <button type="button" className="btn btn-ghost" disabled style={{ marginLeft: 10 }}>
                  Customer Details
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
