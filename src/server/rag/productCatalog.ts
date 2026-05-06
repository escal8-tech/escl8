import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  inventoryProductPriceOptions,
  inventoryProducts,
} from "../../../drizzle/schema";
import type { SpreadsheetRow } from "./extractText";
import {
  deriveInventoryProductFromFields,
  getBusinessStockSettings,
} from "@/server/inventory/stockMapping";

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

function searchTextForRow(row: SpreadsheetRow): string {
  const derived = deriveInventoryProductFromFields(row.fields || {});
  return [
    derived.name,
    derived.itemCode,
    derived.specification,
    derived.description,
    derived.category,
    derived.brand,
    derived.model,
    derived.searchText,
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
  const stockSettings = await getBusinessStockSettings(params.businessId);

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
      const derived = deriveInventoryProductFromFields(row.fields || {}, stockSettings);
      const name = normalizeText(derived.name);
      if (!name) continue;

      const sourceRowKey = stableSourceRowKey({
        source: params.source,
        sheetName: row.sheetName,
        rowNumber: row.rowNumber,
      });
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
          itemCode: derived.itemCode,
          name,
          specification: derived.specification,
          description: derived.description,
          category: derived.category,
          brand: derived.brand,
          model: derived.model,
          mediaUrl: derived.mediaUrl,
          mediaType: derived.mediaType,
          mediaFilename: derived.mediaFilename,
          quantityOnHand: derived.quantityOnHand,
          quantityInitial: derived.quantityInitial,
          quantityUnit: derived.quantityUnit,
          searchText: derived.searchText || searchTextForRow(row),
          rawFields: row.fields || {},
          status: "active",
          indexedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!product) continue;
      refs.set(sourceRowKey, { productId: product.id, sourceRowKey });

      for (const field of derived.priceFields) {
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
