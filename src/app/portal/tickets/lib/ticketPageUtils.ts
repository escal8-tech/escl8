import { getPortalTicketTypeLabel } from "@/app/portal/lib/ticketTypes";

export type TicketStatus = "open" | "in_progress" | "resolved";
export type TicketOutcome = "pending" | "won" | "lost";

export type TicketEventRow = {
  id: string;
  eventType: string;
  actorType: string;
  actorLabel?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt?: Date | string | null;
};

export type TicketRow = {
  [key: string]: unknown;
  id: string;
  ticketNumber?: string | null;
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

export const STATUS_OPTIONS: TicketStatus[] = ["open", "in_progress", "resolved"];
export const OUTCOME_OPTIONS: TicketOutcome[] = ["pending", "won", "lost"];
export const ORDER_STAGE_OPTIONS = [
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

export type OrderStage = (typeof ORDER_STAGE_OPTIONS)[number];
export type TicketListFilter = "all" | TicketStatus | OrderStage;

export const LOSS_REASON_OPTIONS = [
  "Price too high",
  "No response",
  "Competitor chosen",
  "Out of stock",
  "Not ready to buy",
  "Other",
];

export const PAGE_SIZE = 20;

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function formatTicketReference(ticket: TicketRow): string {
  const preferred = getTicketString(ticket, "ticketNumber", "ticket_number").trim();
  if (preferred) return preferred;
  return shortId(String(ticket.id || "").trim());
}

export function toDateTimeLocalValue(value: Date | string | null | undefined): string {
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

export function formatSlaCountdown(
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

export function getTicketValue(ticket: TicketRow, camelKey: string, snakeKey?: string): unknown {
  if (ticket[camelKey] != null) return ticket[camelKey];
  if (snakeKey && ticket[snakeKey] != null) return ticket[snakeKey];
  return null;
}

export function getTicketString(ticket: TicketRow, camelKey: string, snakeKey?: string): string {
  const value = getTicketValue(ticket, camelKey, snakeKey);
  if (value == null) return "";
  return String(value);
}

export function getTicketFields(ticket: TicketRow): Record<string, unknown> {
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

export function formatStatus(status: string): string {
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

export function toLooseStringList(value: unknown): string[] {
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

export type OrderPair = { item: string; quantity: string };
export type OrderEditorLine = { item: string; quantity: string; unitPrice: string };

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

export function buildOrderEditorLines(fields: Record<string, unknown>): OrderEditorLine[] {
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

export function getOrderDraftTotal(fields: Record<string, unknown>): string {
  for (const key of ["total", "total_cost", "totalcost", "amount"]) {
    const value = normalizeMoneyInput(fields[key]);
    if (value) return value;
  }
  return "";
}

export function computeOrderEditorLineTotal(line: OrderEditorLine): string {
  const unitPrice = parseMoneyInput(line.unitPrice);
  if (unitPrice == null) return "";
  const quantity = Number(parseQty(line.quantity));
  return formatMoneyInput(unitPrice * Math.max(1, quantity || 1));
}

export function computeOrderEditorTotal(lines: OrderEditorLine[]): string {
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

export function applyOrderEditorToFields(
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

export function formatItemsCell(fields: Record<string, unknown>): string {
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
  "generalsupport",
  "paymentstatus",
  "refund",
  "cancellation",
  "complaint",
  "warrantyclaim",
  "invoice",
]);

export function isLikelyInvalidCustomerName(value: string): boolean {
  const txt = value.trim();
  if (!txt) return true;
  const lowered = txt.toLowerCase().replace(/\s+/g, " ").trim();
  if (!lowered) return true;
  if (/\d/.test(lowered)) return true;
  if (INVALID_CUSTOMER_NAME_TOKENS.has(lowered)) return true;
  return false;
}

export function firstFieldText(fields: Record<string, unknown>, aliases: string[]): string {
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

export function formatFieldValue(value: unknown, key?: string, fields?: Record<string, unknown>): string {
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

export type ImportantFieldRow = {
  key: string;
  label: string;
  value: string;
};

export function getImportantFieldRows(fields: Record<string, unknown>): ImportantFieldRow[] {
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

export function priorityPillClass(priorityRaw: string): string {
  const priority = priorityRaw.toLowerCase();
  if (priority === "urgent") return "portal-pill portal-pill--danger";
  if (priority === "high") return "portal-pill portal-pill--warning";
  if (priority === "normal") return "portal-pill portal-pill--info";
  return "portal-pill portal-pill--neutral";
}

export function getTicketTypeLabel(typeKey: string): string {
  return getPortalTicketTypeLabel(typeKey);
}

export function isOrderTicketRow(ticket: TicketRow): boolean {
  return getTicketString(ticket, "ticketTypeKey", "ticket_type_key").toLowerCase() === "ordercreation";
}

export function resolveOrderStage(ticket: TicketRow): OrderStage {
  const orderStatus = getTicketString(ticket, "orderStatus", "order_status").toLowerCase();
  if (ORDER_STAGE_OPTIONS.includes(orderStatus as OrderStage)) {
    return orderStatus as OrderStage;
  }
  const outcome = getTicketString(ticket, "outcome", "outcome").toLowerCase();
  if (outcome === "lost") return "denied";
  if (outcome === "won") return "approved";
  return "pending_approval";
}

export function formatOrderStage(stage: OrderStage): string {
  if (stage === "pending_approval") return "Pending approval";
  return formatStatus(stage);
}

export function describeOrderStage(stage: OrderStage): string {
  if (stage === "pending_approval") return "Review the ticket, confirm details, then approve or deny it.";
  if (stage === "approved") return "Approved and moved into the Payment Status queue.";
  if (stage === "awaiting_payment") return "Approved and waiting for the customer to send payment proof.";
  if (stage === "payment_submitted") return "Payment proof received and waiting for staff review.";
  if (stage === "payment_rejected") return "Customer needs to resend payment proof.";
  if (stage === "paid") return "Payment approved and moved into the Order Status queue.";
  if (stage === "refund_pending") return "Refund is being processed.";
  if (stage === "refunded") return "Refund completed and order closed.";
  return "Order flow closed without approval.";
}

export function orderStagePillClass(stage: OrderStage): string {
  if (stage === "paid") return "portal-pill portal-pill--success";
  if (stage === "awaiting_payment" || stage === "payment_submitted") return "portal-pill portal-pill--warning";
  if (stage === "approved") return "portal-pill portal-pill--info";
  if (stage === "refund_pending") return "portal-pill portal-pill--warning";
  if (stage === "refunded") return "portal-pill portal-pill--neutral";
  if (stage === "payment_rejected" || stage === "denied") return "portal-pill portal-pill--danger";
  return "portal-pill portal-pill--neutral";
}

export function canApproveOrderStage(stage: OrderStage): boolean {
  return stage === "pending_approval";
}

export function canDenyOrderStage(stage: OrderStage): boolean {
  return !["paid", "refund_pending", "refunded", "denied"].includes(stage);
}
