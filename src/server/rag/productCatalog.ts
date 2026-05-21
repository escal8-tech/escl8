import crypto from "crypto";
import { and, eq, notInArray } from "drizzle-orm";
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
import { acquireInventoryBusinessLock } from "@/server/inventory/locks";
import {
  archiveCommerceProductsMissingFromInventoryScope,
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

function addUniqueMap<T>(map: Map<string, T | null>, key: string, value: T) {
  if (!key) return;
  if (!map.has(key)) {
    map.set(key, value);
    return;
  }
  if (map.get(key) !== value) {
    map.set(key, null);
  }
}

function firstUnused<T extends { id: string }>(map: Map<string, T | null>, key: string, usedIds: Set<string>): T | null {
  const row = map.get(key);
  if (!row || usedIds.has(row.id)) return null;
  return row;
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

    const scopeWhere = eq(inventoryProducts.businessId, params.businessId);

    const existingProducts = await tx
      .select()
      .from(inventoryProducts)
      .where(scopeWhere);

    const existingBySourceRowKey = new Map<string, (typeof existingProducts)[number] | null>();
    const existingByItemCode = new Map<string, (typeof existingProducts)[number] | null>();
    const existingByIdentity = new Map<string, (typeof existingProducts)[number] | null>();
    const existingByLegacySourceRowKey = new Map<string, (typeof existingProducts)[number] | null>();

    for (const product of existingProducts) {
      const rawFields = product.rawFields && typeof product.rawFields === "object" ? product.rawFields as Record<string, string> : {};
      const derived = deriveInventoryProductFromFields(rawFields, stockSettings);
      const itemCode = normalizeIdentity(derived.itemCode || product.itemCode);
      const identityKey = productIdentityBaseKey({
        itemCode: derived.itemCode || product.itemCode,
        name: derived.name || product.name,
        specification: derived.specification || product.specification,
        description: derived.description || product.description,
        model: derived.model || product.model,
      });
      addUniqueMap(existingBySourceRowKey, product.sourceRowKey, product);
      addUniqueMap(existingByItemCode, itemCode, product);
      addUniqueMap(existingByIdentity, identityKey, product);
      addUniqueMap(existingByLegacySourceRowKey, legacySourceRowKey({
        source: params.source,
        sheetName: product.sourceSheet || "",
        rowNumber: product.sourceRowNumber,
      }), product);
    }

    const sourceRowKeyCounts = new Map<string, number>();
    const usedProductIds = new Set<string>();
    const activeProductIds = new Set<string>();

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
      const identityKey = productIdentityBaseKey({
        itemCode: derived.itemCode,
        name,
        specification: derived.specification,
        description: derived.description,
        model: derived.model,
      });
      const now = new Date();

      const existing =
        firstUnused(existingBySourceRowKey, sourceRowKey, usedProductIds)
        || firstUnused(existingByItemCode, itemCodeKey, usedProductIds)
        || firstUnused(existingByIdentity, identityKey, usedProductIds)
        || firstUnused(existingByLegacySourceRowKey, legacyKey, usedProductIds);

      const productValues = {
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
        updatedAt: now,
      };

      const [product] = existing
        ? await tx
            .update(inventoryProducts)
            .set(productValues)
            .where(eq(inventoryProducts.id, existing.id))
            .returning()
        : await tx
            .insert(inventoryProducts)
            .values({
              businessId: params.businessId,
              ...productValues,
              createdAt: now,
            })
            .returning();

      if (!product) continue;
      usedProductIds.add(product.id);
      activeProductIds.add(product.id);
      refs.set(sourceRowKey, { productId: product.id, sourceRowKey });

      await tx
        .delete(inventoryProductPriceOptions)
        .where(eq(inventoryProductPriceOptions.productId, product.id));

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

      await upsertCommerceProductFromInventory(tx, {
        businessId: params.businessId,
        productId: product.id,
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
    }

    const activeIds = Array.from(activeProductIds);
    if (activeIds.length === 0) {
      console.warn(
        `[rag:inventory] skipped archive for businessId=${params.businessId} source=${params.source} because no valid inventory products were derived from ${rows.length} structured rows`,
      );
      return;
    }
    await tx
      .update(inventoryProducts)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(scopeWhere, notInArray(inventoryProducts.id, activeIds)));
    await archiveCommerceProductsMissingFromInventoryScope(tx, {
      businessId: params.businessId,
      activeProductIds: activeIds,
      inventoryBridgeOnly: true,
    });
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
