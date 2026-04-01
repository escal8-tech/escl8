import { storePrivateFileAtPath } from "@/lib/storage";
import {
  normalizeOrderLineItems,
  parseMoneyValue,
  type NormalizedOrderLineItem,
} from "@/server/services/orderFlow";

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(currency: string, value: string | number | null | undefined): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return `${currency} ${String(value || "").trim() || "0.00"}`.trim();
  }
  return `${currency} ${numeric.toFixed(2)}`;
}

function makeInvoiceNumber(orderId: string, issuedAt: Date): string {
  return `INV-${issuedAt.toISOString().slice(0, 10).replace(/-/g, "")}-${orderId.slice(0, 8).toUpperCase()}`;
}

function resolveLineItems(ticketSnapshot: Record<string, unknown>): NormalizedOrderLineItem[] {
  const fields =
    ticketSnapshot.fields && typeof ticketSnapshot.fields === "object" && !Array.isArray(ticketSnapshot.fields)
      ? (ticketSnapshot.fields as Record<string, unknown>)
      : {};
  return normalizeOrderLineItems(fields);
}

function renderInvoiceHtml(input: {
  invoiceNumber: string;
  issuedAt: Date;
  orderId: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  paymentReference: string | null;
  items: NormalizedOrderLineItem[];
  currency: string;
  expectedAmount: string | null;
  paidAmount: string | null;
}): string {
  const itemRows = input.items.length
    ? input.items.map((item) => {
        const quantity = String(item.quantity || "1").trim() || "1";
        const unitPrice = item.unitPrice ? formatMoney(input.currency, item.unitPrice) : "-";
        const lineTotal = item.lineTotal ? formatMoney(input.currency, item.lineTotal) : "-";
        return `
          <tr>
            <td>${escapeHtml(item.item)}</td>
            <td>${escapeHtml(quantity)}</td>
            <td>${escapeHtml(unitPrice)}</td>
            <td>${escapeHtml(lineTotal)}</td>
          </tr>
        `;
      }).join("")
    : `
      <tr>
        <td colspan="4">Order items were captured in the chat and are available in the linked order record.</td>
      </tr>
    `;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.invoiceNumber)}</title>
    <style>
      body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: #f4f6fb; color: #101828; }
      .page { max-width: 880px; margin: 0 auto; padding: 32px 20px; }
      .card { background: #ffffff; border: 1px solid #d8dee9; border-radius: 20px; overflow: hidden; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08); }
      .header { padding: 28px 32px; background: linear-gradient(135deg, #0f172a, #1d3557); color: #f8fafc; }
      .header h1 { margin: 0; font-size: 28px; }
      .header p { margin: 8px 0 0; color: #cbd5e1; font-size: 14px; }
      .section { padding: 24px 32px; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 18px; }
      .label { font-size: 11px; color: #667085; text-transform: uppercase; letter-spacing: 0.08em; }
      .value { margin-top: 4px; font-size: 15px; font-weight: 600; color: #111827; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 12px 10px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
      th { color: #475467; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
      .totals { display: grid; gap: 10px; justify-items: end; margin-top: 18px; }
      .total-row { display: flex; gap: 24px; font-size: 15px; }
      .total-row strong { min-width: 120px; text-align: right; }
      .footer { padding: 18px 32px 28px; color: #667085; font-size: 12px; }
      @media (max-width: 640px) {
        .section, .header, .footer { padding: 20px; }
        .grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="card">
        <div class="header">
          <h1>Order Invoice</h1>
          <p>${escapeHtml(input.invoiceNumber)} · Issued ${escapeHtml(input.issuedAt.toLocaleString())}</p>
        </div>
        <div class="section">
          <div class="grid">
            <div>
              <div class="label">Order Reference</div>
              <div class="value">${escapeHtml(input.orderId.slice(0, 8).toUpperCase())}</div>
            </div>
            <div>
              <div class="label">Payment Reference</div>
              <div class="value">${escapeHtml(input.paymentReference || "Not set")}</div>
            </div>
            <div>
              <div class="label">Customer</div>
              <div class="value">${escapeHtml(input.customerName || "Unknown customer")}</div>
            </div>
            <div>
              <div class="label">Contact</div>
              <div class="value">${escapeHtml(input.customerEmail || input.customerPhone || "No contact saved")}</div>
            </div>
          </div>
        </div>
        <div class="section">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
          <div class="totals">
            <div class="total-row"><strong>Expected</strong><span>${escapeHtml(formatMoney(input.currency, input.expectedAmount || "0.00"))}</span></div>
            <div class="total-row"><strong>Paid</strong><span>${escapeHtml(formatMoney(input.currency, input.paidAmount || input.expectedAmount || "0.00"))}</span></div>
          </div>
        </div>
        <div class="footer">Generated by the Escl8 order workflow. Share this link with the customer when payment is approved.</div>
      </div>
    </div>
  </body>
</html>`;
}

export async function createOrderInvoiceArtifact(input: {
  businessId: string;
  order: {
    id: string;
    currency?: string | null;
    customerName?: string | null;
    customerEmail?: string | null;
    customerPhone?: string | null;
    paymentReference?: string | null;
    expectedAmount?: string | number | null;
    paidAmount?: string | number | null;
    ticketSnapshot?: Record<string, unknown> | null;
  };
  issuedAt?: Date;
}) {
  const issuedAt = input.issuedAt ?? new Date();
  const invoiceNumber = makeInvoiceNumber(input.order.id, issuedAt);
  const fileName = `${invoiceNumber}.html`;
  const ticketSnapshot =
    input.order.ticketSnapshot && typeof input.order.ticketSnapshot === "object" && !Array.isArray(input.order.ticketSnapshot)
      ? (input.order.ticketSnapshot as Record<string, unknown>)
      : {};
  const items = resolveLineItems(ticketSnapshot);
  const currency = String(input.order.currency || "LKR").trim() || "LKR";
  const expectedAmount = parseMoneyValue(input.order.expectedAmount) ?? parseMoneyValue(input.order.paidAmount) ?? "0.00";
  const paidAmount = parseMoneyValue(input.order.paidAmount) ?? expectedAmount;
  const html = renderInvoiceHtml({
    invoiceNumber,
    issuedAt,
    orderId: input.order.id,
    customerName: String(input.order.customerName || "").trim() || null,
    customerEmail: String(input.order.customerEmail || "").trim() || null,
    customerPhone: String(input.order.customerPhone || "").trim() || null,
    paymentReference: String(input.order.paymentReference || "").trim() || null,
    items,
    currency,
    expectedAmount,
    paidAmount,
  });

  const stored = await storePrivateFileAtPath({
    blobPath: `${input.businessId}/order-invoices/${input.order.id}/${fileName}`,
    buffer: Buffer.from(html, "utf8"),
    fileName,
    contentType: "text/html; charset=utf-8",
    readTtlHours: 24 * 30,
  });

  return {
    invoiceNumber,
    fileName,
    url: stored.url,
    storagePath: stored.blobPath,
    generatedAt: issuedAt,
  };
}
