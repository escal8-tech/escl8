import { and, eq, isNull } from "drizzle-orm";
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";

import { buildPrivateBlobReadUrl, storePrivateFileAtPath } from "@/lib/storage";
import { businesses, orders } from "../../../drizzle/schema";
import { db } from "../db/client";
import {
  normalizeOrderLineItems,
  parseMoneyValue,
  type NormalizedOrderLineItem,
} from "./orderFlow";

const LONG_READ_TTL_HOURS = 24 * 365 * 2;
const DEFAULT_PRIMARY = "#0E1B40";
const DEFAULT_SECONDARY = "#D4A457";

export type OrderInvoiceArtifact = {
  invoiceNumber: string;
  fileName: string;
  url: string;
  storagePath: string;
  generatedAt: Date;
};

export type OrderInvoiceDocumentMessage = {
  type: "document";
  document: {
    link: string;
    filename: string;
    caption?: string;
  };
};

export type OrderInvoiceEmailMessage = {
  subject: string;
  text: string;
  html: string;
};

type OrderRow = typeof orders.$inferSelect;
type BusinessInvoiceConfig = {
  id: string;
  name: string | null;
  settings: Record<string, unknown> | null;
};

type InvoiceCustomization = {
  businessName: string;
  logoBlobPath: string;
  logoContainer: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  footerNote: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanText(value: unknown, limit = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeToken(value: unknown, fallback = "invoice"): string {
  const token = String(value ?? "").replace(/[^A-Za-z0-9._-]/g, "_").replace(/^[_\-.]+|[_\-.]+$/g, "");
  return token || fallback;
}

function normalizeHex(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return raw.toUpperCase();
  if (/^[0-9A-Fa-f]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
  return fallback;
}

function colorFromHex(value: string, fallback = DEFAULT_PRIMARY): RGB {
  const hex = normalizeHex(value, fallback).replace("#", "");
  return rgb(
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  );
}

function normalizeCustomization(settings: Record<string, unknown> | null, businessName: string | null): InvoiceCustomization {
  const root = asRecord(settings);
  const customization = Object.keys(asRecord(root.customization)).length
    ? asRecord(root.customization)
    : asRecord(root.branding);
  return {
    businessName: cleanText(customization.businessName ?? businessName ?? "Business", 120) || "Business",
    logoBlobPath: cleanText(customization.logoBlobPath ?? customization.logo_blob_path, 1024),
    logoContainer: cleanText(customization.logoContainer ?? customization.logo_container, 80),
    logoUrl: cleanText(customization.logoUrl ?? customization.logo_url, 1200),
    primaryColor: normalizeHex(customization.primaryColor ?? customization.primary_color, DEFAULT_PRIMARY),
    secondaryColor: normalizeHex(customization.secondaryColor ?? customization.secondary_color, DEFAULT_SECONDARY),
    address: cleanText(customization.address, 300),
    phone: cleanText(customization.phone, 120),
    email: cleanText(customization.email, 160),
    website: cleanText(customization.website, 200),
    footerNote:
      cleanText(customization.invoiceFooterNote ?? customization.footerNote, 240) ||
      "Please keep this invoice for your records. Payment approval is completed by staff after validation.",
  };
}

function formatMoney(currency: string, value: unknown): string {
  const normalized = parseMoneyValue(value) ?? "0.00";
  return `${currency} ${Number(normalized).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function moneyNumber(value: unknown): number {
  const normalized = parseMoneyValue(value);
  return normalized ? Number(normalized) : 0;
}

function makeInvoiceNumber(orderId: string, issuedAt: Date): string {
  const orderToken = safeToken(orderId.slice(0, 8).toUpperCase(), "ORDER");
  return `INV-${issuedAt.toISOString().slice(0, 10).replace(/-/g, "")}-${orderToken}`;
}

function resolveLineItems(ticketSnapshot: Record<string, unknown>): NormalizedOrderLineItem[] {
  const fields = asRecord(ticketSnapshot.fields);
  const nested = normalizeOrderLineItems(fields);
  if (nested.length) return nested;
  return normalizeOrderLineItems(ticketSnapshot);
}

function drawWrappedText(params: {
  page: PDFPage;
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  font: PDFFont;
  size: number;
  color?: RGB;
  lineHeight?: number;
  maxLines?: number;
}): number {
  const words = cleanText(params.text, 2000).split(/\s+/).filter(Boolean);
  const lineHeight = params.lineHeight ?? params.size + 4;
  const lines: string[] = [];
  let line = "";

  for (const word of words.length ? words : [""]) {
    const candidate = `${line} ${word}`.trim();
    if (line && params.font.widthOfTextAtSize(candidate, params.size) > params.maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);

  const finalLines = params.maxLines ? lines.slice(0, params.maxLines) : lines;
  finalLines.forEach((value, index) => {
    params.page.drawText(value, {
      x: params.x,
      y: params.y - index * lineHeight,
      size: params.size,
      font: params.font,
      color: params.color ?? colorFromHex("#111827"),
    });
  });
  return params.y - Math.max(1, finalLines.length) * lineHeight;
}

function addUrlAnnotation(page: PDFPage, input: { url: string; x: number; y: number; width: number; height: number }) {
  const url = cleanText(input.url, 2000);
  if (!url) return;
  const annotation = page.doc.context.register(
    page.doc.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Link"),
      Rect: [input.x, input.y, input.x + input.width, input.y + input.height],
      Border: [0, 0, 0],
      A: {
        Type: PDFName.of("Action"),
        S: PDFName.of("URI"),
        URI: PDFString.of(url),
      },
    }),
  );
  page.node.addAnnot(annotation);
}

async function loadInvoiceLogo(pdf: PDFDocument, customization: InvoiceCustomization): Promise<{ image: PDFImage; width: number; height: number } | null> {
  const logoUrl = customization.logoBlobPath
    ? buildPrivateBlobReadUrl(customization.logoBlobPath, LONG_READ_TTL_HOURS, customization.logoContainer || undefined)
    : customization.logoUrl;
  const url = cleanText(logoUrl, 2000);
  if (!url) return null;

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const bytes = new Uint8Array(await response.arrayBuffer());
    const image = contentType.includes("png") || url.toLowerCase().includes(".png")
      ? await pdf.embedPng(bytes)
      : await pdf.embedJpg(bytes);
    return { image, width: image.width, height: image.height };
  } catch {
    return null;
  }
}

async function buildOrderInvoicePdf(input: {
  order: OrderRow;
  business: BusinessInvoiceConfig;
  invoiceNumber: string;
  issuedAt: Date;
  trackingUrl?: string | null;
}): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [595.28, 841.89];
  const customization = normalizeCustomization(input.business.settings, input.business.name);
  const logo = await loadInvoiceLogo(pdf, customization);
  const primary = colorFromHex(customization.primaryColor);
  const secondary = colorFromHex(customization.secondaryColor, DEFAULT_SECONDARY);
  const text = colorFromHex("#111827");
  const muted = colorFromHex("#64748B");
  const border = colorFromHex("#E2E8F0");
  const soft = colorFromHex("#F8FAFC");
  const currency = cleanText(input.order.currency || "LKR", 12) || "LKR";
  const ticketSnapshot = asRecord(input.order.ticketSnapshot);
  const items = resolveLineItems(ticketSnapshot);
  const expected = moneyNumber(input.order.expectedAmount ?? input.order.paidAmount);
  const itemTotal = items.reduce((sum, item) => {
    const quantity = Number(String(item.quantity || "1").replace(/[^\d.]/g, "")) || 1;
    const lineTotal = moneyNumber(item.lineTotal);
    const unitPrice = moneyNumber(item.unitPrice);
    return sum + (lineTotal || unitPrice * quantity);
  }, 0);
  const total = expected || itemTotal;
  const rows = items.length
    ? items
    : [{ item: "Order items captured in chat", quantity: "1", unitPrice: total.toFixed(2), lineTotal: total.toFixed(2) }];

  let pageNo = 0;
  let page = pdf.addPage(pageSize);
  let y = 0;

  function drawHeader() {
    pageNo += 1;
    const width = page.getWidth();
    const height = page.getHeight();
    page.drawRectangle({ x: 0, y: height - 12, width, height: 12, color: primary });
    page.drawRectangle({ x: width * 0.68, y: height - 12, width: width * 0.32, height: 12, color: secondary });
    const brandTextX = logo ? 120 : 36;
    if (logo) {
      const maxLogoWidth = 70;
      const maxLogoHeight = 54;
      const scale = Math.min(maxLogoWidth / logo.width, maxLogoHeight / logo.height, 1);
      const logoWidth = logo.width * scale;
      const logoHeight = logo.height * scale;
      page.drawImage(logo.image, {
        x: 36,
        y: height - 100,
        width: logoWidth,
        height: logoHeight,
      });
    }
    page.drawText(customization.businessName, { x: brandTextX, y: height - 70, size: logo ? 22 : 20, font: fontBold, color: text });
    const contact = [customization.address, customization.phone, customization.email, customization.website].filter(Boolean).join(" | ");
    if (contact) {
      drawWrappedText({ page, text: contact, x: brandTextX, y: height - 91, maxWidth: logo ? 270 : 300, font, size: 8.5, color: muted, maxLines: 2 });
    }
    page.drawText("INVOICE", { x: width - 144, y: height - 62, size: 19, font: fontBold, color: text });
    page.drawText(input.invoiceNumber, { x: width - 190, y: height - 82, size: 10, font: fontBold, color: text });
    page.drawText(input.issuedAt.toLocaleDateString("en-GB"), { x: width - 123, y: height - 98, size: 9, font, color: muted });
    if (pageNo > 1) page.drawText(`Page ${pageNo}`, { x: width - 74, y: height - 114, size: 8, font, color: muted });
    page.drawLine({ start: { x: 36, y: height - 130 }, end: { x: width - 36, y: height - 130 }, thickness: 1, color: border });
    y = height - 158;
  }

  function drawFooter() {
    const width = page.getWidth();
    page.drawRectangle({ x: 0, y: 28, width, height: 52, color: primary });
    page.drawRectangle({ x: width * 0.72, y: 28, width: width * 0.28, height: 52, color: secondary });
    page.drawText(customization.businessName, { x: 36, y: 59, size: 9, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText(customization.footerNote.slice(0, 96), { x: 36, y: 43, size: 7.5, font, color: rgb(1, 1, 1) });
  }

  function ensureSpace(minY = 118) {
    if (y >= minY) return;
    drawFooter();
    page = pdf.addPage(pageSize);
    drawHeader();
  }

  drawHeader();
  const width = page.getWidth();
  const customer = cleanText(input.order.recipientName || input.order.customerName || "WhatsApp Customer", 120) || "WhatsApp Customer";
  const customerContact = cleanText(input.order.recipientPhone || input.order.customerPhone || input.order.customerEmail, 160);
  const deliveryArea = cleanText(input.order.deliveryArea, 180);
  const shippingAddress = cleanText(input.order.shippingAddress, 500);
  const deliveryNotes = cleanText(input.order.deliveryNotes, 500);
  const fulfillmentLines = [
    shippingAddress && shippingAddress.toLowerCase() !== "pickup" ? shippingAddress : "",
    deliveryArea && deliveryArea.toLowerCase() !== "pickup" ? deliveryArea : "",
    deliveryNotes && !deliveryNotes.toLowerCase().includes("[pickup]") ? deliveryNotes : "",
  ].filter(Boolean);
  const isPickup = shippingAddress.toLowerCase() === "pickup"
    || deliveryArea.toLowerCase() === "pickup"
    || deliveryNotes.toLowerCase().includes("[pickup]");
  const orderRef = cleanText(input.order.id.slice(0, 8).toUpperCase(), 30);
  const paymentRef = cleanText(input.order.paymentReference, 120) || "-";
  const trackingUrl = cleanText(input.trackingUrl, 2000);

  page.drawText("Invoice To", { x: 36, y, size: 9, font: fontBold, color: muted });
  page.drawText(customer, { x: 36, y: y - 20, size: 14, font: fontBold, color: text });
  if (customerContact) page.drawText(customerContact, { x: 36, y: y - 38, size: 9, font, color: muted });
  if (isPickup) {
    page.drawText("Pickup order", { x: 36, y: y - 56, size: 9, font: fontBold, color: muted });
  } else if (fulfillmentLines.length) {
    drawWrappedText({
      page,
      text: fulfillmentLines.join(" | "),
      x: 36,
      y: y - 56,
      maxWidth: 300,
      font,
      size: 8.5,
      color: muted,
      maxLines: 3,
    });
  }
  page.drawText(`Order reference: ${orderRef}`, { x: width / 2 + 12, y, size: 9, font, color: text });
  page.drawText(`Payment reference: ${paymentRef}`, { x: width / 2 + 12, y: y - 18, size: 9, font, color: text });
  page.drawText(`Currency: ${currency}`, { x: width / 2 + 12, y: y - 36, size: 9, font, color: text });
  y -= fulfillmentLines.length || isPickup ? 106 : 82;

  page.drawRectangle({ x: 36, y: y - 20, width: width - 72, height: 26, color: primary });
  page.drawText("ITEM", { x: 48, y: y - 11, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("QTY", { x: width - 210, y: y - 11, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("UNIT", { x: width - 146, y: y - 11, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText("TOTAL", { x: width - 82, y: y - 11, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  y -= 38;

  rows.forEach((item, index) => {
    ensureSpace();
    const quantity = Math.max(1, Number(String(item.quantity || "1").replace(/[^\d.]/g, "")) || 1);
    const unitPrice = moneyNumber(item.unitPrice);
    const lineTotal = moneyNumber(item.lineTotal) || unitPrice * quantity;
    const freeDelivery = /delivery/i.test(String(item.item || "")) && lineTotal <= 0;
    const itemY = y;
    const label = `${index + 1}. ${cleanText(item.item, 220)}`;
    const nextY = drawWrappedText({ page, text: label, x: 48, y: itemY, maxWidth: 290, font, size: 9.5, color: text, maxLines: 3 });
    page.drawText(String(quantity), { x: width - 210, y: itemY, size: 9, font, color: text });
    page.drawText(freeDelivery ? "Free" : formatMoney(currency, unitPrice), { x: width - 166, y: itemY, size: 9, font, color: text });
    page.drawText(freeDelivery ? "Free" : formatMoney(currency, lineTotal), { x: width - 100, y: itemY, size: 9, font: fontBold, color: text });
    y = Math.min(itemY - 28, nextY - 8);
    page.drawLine({ start: { x: 42, y: y + 12 }, end: { x: width - 42, y: y + 12 }, thickness: 0.7, color: border });
  });

  ensureSpace(178);
  page.drawRectangle({ x: width - 250, y: y - 68, width: 214, height: 58, color: soft });
  page.drawText("Total due", { x: width - 230, y: y - 35, size: 10, font, color: muted });
  page.drawText(formatMoney(currency, total), { x: width - 154, y: y - 36, size: 15, font: fontBold, color: text });
  y -= 92;
  if (trackingUrl) {
    ensureSpace(160);
    page.drawText("Order tracking", { x: 36, y, size: 9, font: fontBold, color: text });
    const label = trackingUrl.length > 92 ? `${trackingUrl.slice(0, 89)}...` : trackingUrl;
    const linkY = y - 17;
    const linkWidth = Math.min(font.widthOfTextAtSize(label, 8.5), width - 72);
    page.drawText(label, { x: 36, y: linkY, size: 8.5, font, color: secondary });
    page.drawLine({ start: { x: 36, y: linkY - 2 }, end: { x: 36 + linkWidth, y: linkY - 2 }, thickness: 0.5, color: secondary });
    addUrlAnnotation(page, { url: trackingUrl, x: 36, y: linkY - 3, width: linkWidth, height: 12 });
    y -= 38;
  }
  drawWrappedText({ page, text: customization.footerNote, x: 36, y, maxWidth: width - 72, font, size: 9, color: muted, maxLines: 3 });
  drawFooter();

  return Buffer.from(await pdf.save());
}

function orderInvoiceContainer(): string {
  return String(
    process.env.ORDER2_INVOICE_BLOB_CONTAINER ||
      process.env.ORDER_INVOICE_BLOB_CONTAINER ||
      process.env.AGENT_INVOICE_BLOB_CONTAINER ||
      "agent-invoices",
  ).trim() || "agent-invoices";
}

async function markInvoiceFailed(input: { businessId: string; orderId: string; invoiceNumber: string; error?: string }) {
  await db
    .update(orders)
    .set({
      invoiceNumber: input.invoiceNumber,
      invoiceStatus: "failed",
      updatedAt: new Date(),
    })
    .where(and(eq(orders.businessId, input.businessId), eq(orders.id, input.orderId)));
}

async function markInvoiceGenerated(input: {
  businessId: string;
  orderId: string;
  artifact: OrderInvoiceArtifact;
  deliveryMethod?: "whatsapp" | "email" | null;
  currentStatus?: string | null;
}) {
  const now = new Date();
  const alreadySent = String(input.currentStatus || "").trim().toLowerCase() === "sent";
  const update: Partial<typeof orders.$inferInsert> = {
    invoiceNumber: input.artifact.invoiceNumber,
    invoiceUrl: input.artifact.url,
    invoiceStoragePath: input.artifact.storagePath,
    invoiceFileName: input.artifact.fileName,
    invoiceStatus: alreadySent ? "sent" : "generated",
    invoiceGeneratedAt: input.artifact.generatedAt,
    updatedAt: now,
  };
  if (!alreadySent) {
    update.invoiceDeliveryMethod = null;
    update.invoiceSentAt = null;
  }
  await db
    .update(orders)
    .set(update)
    .where(and(eq(orders.businessId, input.businessId), eq(orders.id, input.orderId)));
}

export async function markOrderInvoiceDelivered(input: {
  businessId: string;
  orderId: string;
  deliveryMethod: "whatsapp" | "email";
  invoiceNumber?: string | null;
}) {
  const businessId = cleanText(input.businessId, 160);
  const orderId = cleanText(input.orderId, 160);
  if (!businessId || !orderId) return null;

  const now = new Date();
  const update: Partial<typeof orders.$inferInsert> = {
    invoiceStatus: "sent",
    invoiceDeliveryMethod: input.deliveryMethod,
    invoiceSentAt: now,
    updatedAt: now,
  };
  const invoiceNumber = cleanText(input.invoiceNumber, 100);
  if (invoiceNumber) update.invoiceNumber = invoiceNumber;

  const [updated] = await db
    .update(orders)
    .set(update)
    .where(and(eq(orders.businessId, businessId), eq(orders.id, orderId)))
    .returning();
  return updated ?? null;
}

function existingArtifact(order: OrderRow, containerName: string): OrderInvoiceArtifact | null {
  const invoiceNumber = cleanText(order.invoiceNumber, 100);
  const fileName = cleanText(order.invoiceFileName, 180);
  const storagePath = cleanText(order.invoiceStoragePath, 800);
  if (!invoiceNumber || !fileName || !storagePath) return null;
  const url = buildPrivateBlobReadUrl(storagePath, LONG_READ_TTL_HOURS, containerName) || cleanText(order.invoiceUrl, 2000);
  if (!url) return null;
  return {
    invoiceNumber,
    fileName,
    url,
    storagePath,
    generatedAt: order.invoiceGeneratedAt ?? new Date(),
  };
}

export async function createOrderInvoiceArtifact(input: {
  businessId: string;
  order: OrderRow;
  business?: BusinessInvoiceConfig | null;
  issuedAt?: Date;
  trackingUrl?: string | null;
}): Promise<OrderInvoiceArtifact> {
  const issuedAt = input.issuedAt ?? new Date();
  const invoiceNumber = cleanText(input.order.invoiceNumber, 100) || makeInvoiceNumber(input.order.id, issuedAt);
  const fileName = `${safeToken(invoiceNumber)}.pdf`;
  const business = input.business ?? {
    id: input.businessId,
    name: null,
    settings: null,
  };
  const pdfBuffer = await buildOrderInvoicePdf({
    order: input.order,
    business,
    invoiceNumber,
    issuedAt,
    trackingUrl: input.trackingUrl ?? null,
  });
  const containerName = orderInvoiceContainer();
  const stored = await storePrivateFileAtPath({
    blobPath: `${safeToken(input.businessId)}/order2-invoices/${issuedAt.toISOString().slice(0, 10)}/${safeToken(input.order.id)}/${fileName}`,
    buffer: pdfBuffer,
    fileName,
    contentType: "application/pdf",
    readTtlHours: LONG_READ_TTL_HOURS,
    containerName,
  });
  return {
    invoiceNumber,
    fileName,
    url: stored.url,
    storagePath: stored.blobPath,
    generatedAt: issuedAt,
  };
}

export async function createOrderInvoiceForOrder(input: {
  businessId: string;
  orderId: string;
  forceRegenerate?: boolean;
  deliveryMethod?: "whatsapp" | "email" | null;
  trackingUrl?: string | null;
}): Promise<OrderInvoiceArtifact | null> {
  const businessId = cleanText(input.businessId, 160);
  const orderId = cleanText(input.orderId, 160);
  if (!businessId || !orderId) return null;

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.businessId, businessId), eq(orders.id, orderId)))
    .limit(1);
  if (!order) return null;

  const [business] = await db
    .select({ id: businesses.id, name: businesses.name, settings: businesses.settings })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  const containerName = orderInvoiceContainer();
  if (!input.forceRegenerate) {
    const existing = existingArtifact(order, containerName);
    if (existing) {
      if (String(order.invoiceStatus || "").trim().toLowerCase() !== "sent") {
        await markInvoiceGenerated({
          businessId,
          orderId,
          artifact: existing,
          deliveryMethod: input.deliveryMethod ?? null,
          currentStatus: order.invoiceStatus,
        });
      }
      return existing;
    }
  }

  const now = new Date();
  const [claimed] = await db
    .update(orders)
    .set({
      invoiceStatus: "generating",
      updatedAt: now,
    })
    .where(
      and(
        eq(orders.businessId, businessId),
        eq(orders.id, orderId),
        order.invoiceStatus === null ? isNull(orders.invoiceStatus) : eq(orders.invoiceStatus, order.invoiceStatus),
      ),
    )
    .returning();

  if (!claimed) {
    const [latest] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.businessId, businessId), eq(orders.id, orderId)))
      .limit(1);
    const latestArtifact = latest ? existingArtifact(latest, containerName) : null;
    if (latestArtifact) {
      if (String(latest?.invoiceStatus || "").trim().toLowerCase() !== "sent") {
        await markInvoiceGenerated({
          businessId,
          orderId,
          artifact: latestArtifact,
          deliveryMethod: input.deliveryMethod ?? null,
          currentStatus: latest?.invoiceStatus ?? null,
        });
      }
      return latestArtifact;
    }
    return null;
  }

  try {
    const artifact = await createOrderInvoiceArtifact({
      businessId,
      order,
      business: business ? { id: business.id, name: business.name, settings: business.settings ?? null } : null,
      issuedAt: now,
      trackingUrl: input.trackingUrl ?? null,
    });
    await markInvoiceGenerated({
      businessId,
      orderId,
      artifact,
      deliveryMethod: input.deliveryMethod ?? null,
      currentStatus: order.invoiceStatus,
    });
    return artifact;
  } catch (error) {
    await markInvoiceFailed({
      businessId,
      orderId,
      invoiceNumber: cleanText(order.invoiceNumber, 100) || makeInvoiceNumber(order.id, now),
      error: error instanceof Error ? error.message : "Invoice generation failed.",
    });
    throw error;
  }
}

export function buildOrderInvoiceDocumentMessage(input: {
  artifact: OrderInvoiceArtifact;
  language?: string | null;
  trackingUrl?: string | null;
}): OrderInvoiceDocumentMessage {
  return {
    type: "document",
    document: {
      link: input.artifact.url,
      filename: input.artifact.fileName,
    },
  };
}

export function buildOrderInvoiceEmailMessage(input: {
  artifact: OrderInvoiceArtifact;
  orderId: string;
  customerName?: string | null;
  trackingUrl?: string | null;
}): OrderInvoiceEmailMessage {
  const customerName = cleanText(input.customerName, 120);
  const greeting = customerName ? `Hi ${customerName},` : "Hi,";
  const subject = `Invoice ${input.artifact.invoiceNumber}`;
  const invoiceUrl = input.artifact.url;
  const trackingUrl = cleanText(input.trackingUrl, 2000);
  const safeGreeting = escapeHtml(greeting);
  const safeOrderRef = escapeHtml(input.orderId.slice(0, 8).toUpperCase());
  const safeInvoiceNumber = escapeHtml(input.artifact.invoiceNumber);
  const safeInvoiceUrl = escapeHtml(invoiceUrl);
  const safeTrackingUrl = escapeHtml(trackingUrl);
  const text = [
    greeting,
    "",
    `Your invoice for order ${input.orderId.slice(0, 8).toUpperCase()} is ready.`,
    "",
    `Invoice: ${input.artifact.invoiceNumber}`,
    `Download: ${invoiceUrl}`,
    trackingUrl ? `Track order: ${trackingUrl}` : "",
    "",
    "Thank you.",
  ].filter((line) => line !== "").join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <p>${safeGreeting}</p>
      <p>Your invoice for order <strong>${safeOrderRef}</strong> is ready.</p>
      <p><strong>Invoice:</strong> ${safeInvoiceNumber}</p>
      <p><a href="${safeInvoiceUrl}" style="color:#0f766e">Download invoice PDF</a></p>
      ${trackingUrl ? `<p><a href="${safeTrackingUrl}" style="color:#0f766e">Track your order</a></p>` : ""}
      <p>Thank you.</p>
    </div>
  `.trim();
  return { subject, text, html };
}
