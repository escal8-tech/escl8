/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  inventoryProductPriceOptions,
  inventoryProducts,
} from "../../../drizzle/schema";
import type { SpreadsheetRow } from "./extractText";
import {
  isInventoryPriceKey,
  isMeaningfulInventoryValue,
  normalizeHeaderKey,
  summarizeInventoryRow,
} from "./inventoryFields";

export type IndexedProductRef = {
  productId: string;
  sourceRowKey: string;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stableSourceRowKey(params: {
  source: string;
  sheetName: string;
  rowNumber: number;
}): string {
  const raw = `${params.source}::${params.sheetName}::${params.rowNumber}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function parsePriceAmount(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text || !/\d/.test(text)) return null;
  const match = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount.toFixed(2);
}

function firstField(fields: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = normalizeText(fields[normalizeHeaderKey(key)]);
    if (value && isMeaningfulInventoryValue(value)) return value;
  }
  return "";
}

function pickMedia(fields: Record<string, string>): { url: string; type: string; filename: string } {
  const preferredKeys = [
    "product_link_for_images",
    "product_image",
    "product_image_url",
    "image",
    "image_url",
    "image_link",
    "photo",
    "photo_url",
    "picture",
    "picture_url",
    "pdf",
    "pdf_url",
    "document",
    "document_url",
    "brochure",
    "brochure_url",
  ].map(normalizeHeaderKey);

  for (const key of preferredKeys) {
    const value = normalizeText(fields[key]);
    if (!value) continue;
    const match = value.match(/https?:\/\/[^\s|,<>"]+/i);
    if (!match) continue;
    const url = match[0].replace(/[.)\],;]+$/g, "");
    const path = new URL(url).pathname.toLowerCase();
    const type = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt)$/.test(path)
      ? "document"
      : /\.(jpg|jpeg|png|webp|gif|bmp)$/.test(path)
        ? "image"
        : key.includes("pdf") || key.includes("document") || key.includes("brochure")
          ? "document"
          : "image";
    const filename = decodeURIComponent(path.split("/").pop() || "").slice(0, 240);
    return { url, type, filename };
  }
  return { url: "", type: "", filename: "" };
}

function searchTextForRow(row: SpreadsheetRow): string {
  const summary = summarizeInventoryRow(row);
  return [
    summary.product,
    summary.itemCode,
    summary.specification,
    summary.displayText,
    Object.entries(row.fields || {}).map(([key, value]) => `${key} ${value}`).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function replaceInventoryProductsForRows(params: {
  businessId: string;
  trainingDocumentId?: string | null;
  source: string;
  sourceFilename?: string;
  rows: SpreadsheetRow[];
}): Promise<Map<string, IndexedProductRef>> {
  const refs = new Map<string, IndexedProductRef>();
  const rows = (params.rows || []).filter((row) => row && row.fields && Object.keys(row.fields).length > 0);
  if (!params.businessId || !params.source || rows.length === 0) return refs;

  await db.transaction(async (tx) => {
    if (params.trainingDocumentId) {
      await tx
        .delete(inventoryProducts)
        .where(
          and(
            eq(inventoryProducts.businessId, params.businessId),
            eq(inventoryProducts.trainingDocumentId, params.trainingDocumentId),
          ),
        );
    } else {
      await tx
        .delete(inventoryProducts)
        .where(and(eq(inventoryProducts.businessId, params.businessId), eq(inventoryProducts.source, params.source)));
    }

    for (const row of rows) {
      const summary = summarizeInventoryRow(row);
      const name = normalizeText(summary.product || firstField(row.fields, ["product_name", "product", "item_name", "item", "model", "title"]));
      if (!name) continue;

      const sourceRowKey = stableSourceRowKey({
        source: params.source,
        sheetName: row.sheetName,
        rowNumber: row.rowNumber,
      });
      const media = pickMedia(row.fields || {});
      const now = new Date();
      const [product] = await tx
        .insert(inventoryProducts)
        .values({
          businessId: params.businessId,
          trainingDocumentId: params.trainingDocumentId || null,
          source: params.source,
          sourceFilename: params.sourceFilename || null,
          sourceSheet: row.sheetName || "",
          sourceRowNumber: row.rowNumber,
          sourceRowKey,
          itemCode: summary.itemCode || null,
          name,
          specification: summary.specification || null,
          description: firstField(row.fields, ["product_description", "description", "details", "features"]) || null,
          category: firstField(row.fields, ["category", "type", "group"]) || null,
          brand: firstField(row.fields, ["brand", "make"]) || null,
          model: firstField(row.fields, ["model", "model_name", "model_number", "model_no"]) || null,
          mediaUrl: media.url || null,
          mediaType: media.type || null,
          mediaFilename: media.filename || null,
          searchText: searchTextForRow(row),
          rawFields: row.fields || {},
          status: "active",
          indexedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!product) continue;
      refs.set(sourceRowKey, { productId: product.id, sourceRowKey });

      const priceFields = Object.entries(row.fields || {})
        .map(([key, value], index) => ({
          sourceKey: normalizeHeaderKey(key) || `price_${index + 1}`,
          label: key,
          valueText: normalizeText(value),
          amount: parsePriceAmount(value),
          sortOrder: index,
        }))
        .filter((field) => isInventoryPriceKey(field.sourceKey) && field.valueText && /\d/.test(field.valueText));

      for (const field of priceFields) {
        await tx.insert(inventoryProductPriceOptions).values({
          businessId: params.businessId,
          productId: product.id,
          sourceKey: field.sourceKey,
          label: field.label || field.sourceKey,
          valueText: field.valueText,
          amount: field.amount,
          currency: "LKR",
          sortOrder: field.sortOrder,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  });

  return refs;
}

export function sourceRowKeyForSpreadsheetRow(params: {
  source: string;
  row: SpreadsheetRow;
}): string {
  return stableSourceRowKey({
    source: params.source,
    sheetName: params.row.sheetName,
    rowNumber: params.row.rowNumber,
  });
}
