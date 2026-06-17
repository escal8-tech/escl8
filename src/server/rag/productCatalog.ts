import crypto from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  businesses,
  commerceProducts,
} from "../../../drizzle/schema";
import type { SpreadsheetRow } from "./extractText";
import {
  deriveInventoryProductFromFields,
  getBusinessStockSettings,
} from "@/server/inventory/stockMapping";
import { normalizeStockSettings, type BusinessStockSettings } from "@/lib/stock-settings";
import { acquireInventoryBusinessLock } from "@/server/inventory/locks";
import {
  upsertCommerceProductFromInventory,
} from "@/server/commerce/inventoryBridge";

export type IndexedProductRef = {
  productId: string;
  sourceRowKey: string;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeIdentity(value: unknown): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function identityHash(parts: string[]): string {
  return crypto
    .createHash("sha256")
    .update(parts.filter(Boolean).join("::"))
    .digest("hex")
    .slice(0, 32);
}

function legacySourceRowKey(params: {
  source: string;
  sheetName: string;
  rowNumber: number;
}): string {
  const raw = `${params.source}::${params.sheetName}::${params.rowNumber}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function productIdentityBaseKey(input: {
  itemCode?: unknown;
  name?: unknown;
  specification?: unknown;
  description?: unknown;
  model?: unknown;
}): string {
  const itemCode = normalizeIdentity(input.itemCode);
  if (itemCode) return `stock:v2:item-code:${identityHash([itemCode])}`;

  const name = normalizeIdentity(input.name);
  if (!name) return "";

  const detail = normalizeIdentity(input.specification || input.description || input.model);
  return `stock:v2:name-spec:${identityHash([name, detail])}`;
}

function stableSourceRowKey(params: {
  source: string;
  row: SpreadsheetRow;
  stockSettings?: Awaited<ReturnType<typeof getBusinessStockSettings>>;
  duplicateIndex?: number;
}): string {
  const derived = deriveInventoryProductFromFields(params.row.fields || {}, params.stockSettings);
  const baseKey = productIdentityBaseKey({
    itemCode: derived.itemCode,
    name: derived.name,
    specification: derived.specification,
    description: derived.description,
    model: derived.model,
  });
  const suffix = params.duplicateIndex && params.duplicateIndex > 1 ? `:${params.duplicateIndex}` : "";
  return baseKey ? `${baseKey}${suffix}` : legacySourceRowKey({
    source: params.source,
    sheetName: params.row.sheetName,
    rowNumber: params.row.rowNumber,
  });
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
    await acquireInventoryBusinessLock(tx, params.businessId);

    // ============================================================
    // COMPLETE WIPE: Delete ALL old inventory data for this business
    // This is a weekly stock refresh system - no merging, no archiving
    // ============================================================
    
    // 1. Delete ALL commerce products that came from inventory bridge for this business
    const deletedProducts = await tx.execute(sql`
      DELETE FROM commerce_products
      WHERE business_id = ${params.businessId}
        AND metadata->>'bridge' = 'inventory'
      RETURNING id
    `);
    const existingCount = deletedProducts.rows?.length ?? 0;
    
    // 2. Delete orphaned commerce records (balances, movements, prices)
    await tx.execute(sql`
      DELETE FROM commerce_stock_balances
      WHERE business_id = ${params.businessId}
        AND NOT EXISTS (SELECT 1 FROM commerce_products cp WHERE cp.id = commerce_stock_balances.product_id)
    `);
    
    await tx.execute(sql`
      DELETE FROM commerce_stock_movements
      WHERE business_id = ${params.businessId}
        AND NOT EXISTS (SELECT 1 FROM commerce_products cp WHERE cp.id = commerce_stock_movements.product_id)
    `);

    await tx.execute(sql`
      DELETE FROM commerce_product_prices
      WHERE business_id = ${params.businessId}
        AND NOT EXISTS (SELECT 1 FROM commerce_products cp WHERE cp.id = commerce_product_prices.product_id)
    `);

    // 8. CLEAR saved column mappings in businesses.settings
    // When a new inventory document is uploaded, old mappings are wiped
    const [biz] = await tx
      .select({ settings: businesses.settings })
      .from(businesses)
      .where(eq(businesses.id, params.businessId))
      .limit(1);
    
    if (biz) {
      const currentSettings = biz.settings as Record<string, unknown> || {};
      const nextSettings = {
        ...currentSettings,
        stock: {
          schemaVersion: 1,
          columnMapping: [],
          updatedAt: new Date().toISOString(),
        },
      };
      await tx
        .update(businesses)
        .set({ settings: nextSettings, updatedAt: new Date() })
        .where(eq(businesses.id, params.businessId));
      
      // Also update commerce settings to clear column mapping
      await tx.execute(sql`
        UPDATE commerce_settings
        SET column_mapping = '[]'::jsonb,
            updated_at = now()
        WHERE business_id = ${params.businessId}
      `);
    }

    // ============================================================
    // INSERT FRESH: Insert new products from the new document
    // ============================================================
    const now = new Date();

    // Track duplicate sourceRowKeys within this batch (for rows with identical product identity)
    const sourceRowKeyCounts = new Map<string, number>();

    for (const row of rows) {
      const derived = deriveInventoryProductFromFields(row.fields || {}, stockSettings);
      const name = normalizeText(derived.name);
      if (!name) continue;

      const sourceRowKeyBase = stableSourceRowKey({
        source: params.source,
        row,
        stockSettings,
      });
      const duplicateIndex = (sourceRowKeyCounts.get(sourceRowKeyBase) ?? 0) + 1;
      sourceRowKeyCounts.set(sourceRowKeyBase, duplicateIndex);
      const sourceRowKey = duplicateIndex === 1 ? sourceRowKeyBase : `${sourceRowKeyBase}:${duplicateIndex}`;
      const legacyKey = legacySourceRowKey({ source: params.source, sheetName: row.sheetName, rowNumber: row.rowNumber });
      const itemCodeKey = normalizeIdentity(derived.itemCode);

      // Upsert commerce product directly
      const productId = crypto.randomUUID();
      const product = await upsertCommerceProductFromInventory(tx, {
        businessId: params.businessId,
        productId: productId,
        trainingDocumentId: params.trainingDocumentId || null,
        source: params.source,
        sourceFilename: params.sourceFilename || null,
        sourceSheet: row.sheetName || "",
        sourceRowNumber: row.rowNumber,
        sourceRowKey,
        derived,
        rawFields: row.fields || {},
        stockSettings,
        status: "active",
      });

      if (!product) continue;
      refs.set(sourceRowKey, { productId: product.id, sourceRowKey });
    }

    console.log(`[rag:inventory] Complete refresh: deleted ${existingCount} old products, inserted ${refs.size} new products for businessId=${params.businessId}`);
  });

  return refs;
}

export function sourceRowKeyForSpreadsheetRow(params: {
  source: string;
  row: SpreadsheetRow;
  stockSettings?: Awaited<ReturnType<typeof getBusinessStockSettings>>;
  duplicateIndex?: number;
}): string {
  return stableSourceRowKey({
    source: params.source,
    row: params.row,
    stockSettings: params.stockSettings,
    duplicateIndex: params.duplicateIndex,
  });
}
