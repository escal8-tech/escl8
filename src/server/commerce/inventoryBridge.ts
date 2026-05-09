import { and, eq, or, sql } from "drizzle-orm";

import {
  businesses,
  commerceProductPrices,
  commerceProducts,
  commerceSettings,
  commerceStockBalances,
  commerceStockMovements,
} from "../../../drizzle/schema";
import type { BusinessStockSettings } from "@/lib/stock-settings";
import { normalizeStockSettings } from "@/lib/stock-settings";
import type { DbClient } from "@/server/db/client";
import type { DerivedInventoryProductFields } from "@/server/inventory/stockMapping";

type CommerceTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
type CommerceTx = DbClient | CommerceTransaction;

function sanitizeCurrency(value: unknown, fallback = "LKR"): string {
  const normalized = String(value || fallback).trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 10);
  return normalized || fallback;
}

function amountTextToMinor(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const numeric = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric * 100);
}

function buildCommerceSearchText(input: {
  derived: DerivedInventoryProductFields;
  rawFields: Record<string, string>;
}): string {
  return [
    input.derived.itemCode,
    input.derived.name,
    input.derived.description,
    input.derived.specification,
    input.derived.category,
    input.derived.brand,
    input.derived.model,
    input.derived.quantityUnit,
    ...input.derived.priceFields.flatMap((field) => [field.label, field.valueText]),
    Object.entries(input.rawFields).map(([key, value]) => `${key} ${value}`).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getBusinessSnapshot(tx: CommerceTx, businessId: string) {
  const [biz] = await tx
    .select({
      id: businesses.id,
      suiteTenantId: businesses.suiteTenantId,
      settings: businesses.settings,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  return biz || null;
}

export async function ensureCommerceSettingsForBusiness(
  tx: CommerceTx,
  params: {
    businessId: string;
    stockSettings?: BusinessStockSettings;
    currency?: string | null;
  },
) {
  const biz = await getBusinessSnapshot(tx, params.businessId);
  if (!biz) return null;
  const stockSettings = params.stockSettings ?? normalizeStockSettings(biz.settings);
  const currency = sanitizeCurrency(params.currency);
  const [existing] = await tx
    .select()
    .from(commerceSettings)
    .where(eq(commerceSettings.businessId, params.businessId))
    .limit(1);
  if (existing) {
    const [updated] = await tx
      .update(commerceSettings)
      .set({
        suiteTenantId: existing.suiteTenantId || biz.suiteTenantId || null,
        currency: sanitizeCurrency(existing.currency || currency),
        columnMapping: stockSettings.columnMapping as unknown as Array<Record<string, unknown>>,
        updatedAt: new Date(),
      })
      .where(eq(commerceSettings.businessId, params.businessId))
      .returning();
    return updated || existing;
  }

  const [inserted] = await tx
    .insert(commerceSettings)
    .values({
      businessId: params.businessId,
      suiteTenantId: biz.suiteTenantId || null,
      itemsEnabled: false,
      currency,
      columnMapping: stockSettings.columnMapping as unknown as Array<Record<string, unknown>>,
      metadata: { source: "inventory_bridge" },
    })
    .returning();
  return inserted || null;
}

export async function setCommerceStockAbsolute(
  tx: CommerceTx,
  params: {
    businessId: string;
    suiteTenantId?: string | null;
    productId: string;
    quantity: number;
    sourceRefType: string;
    sourceRefId?: string | null;
    notes?: string | null;
  },
) {
  const nextQuantity = Math.max(0, Math.floor(Number(params.quantity) || 0));
  const [product] = await tx
    .select({ id: commerceProducts.id })
    .from(commerceProducts)
    .where(and(eq(commerceProducts.businessId, params.businessId), eq(commerceProducts.id, params.productId)))
    .limit(1);
  if (!product) return { availableQty: nextQuantity, delta: 0 };

  const [existing] = await tx
    .select()
    .from(commerceStockBalances)
    .where(and(eq(commerceStockBalances.businessId, params.businessId), eq(commerceStockBalances.productId, params.productId)))
    .limit(1);
  const previousAvailable = Math.max(0, Number(existing?.availableQty || 0));
  const delta = nextQuantity - previousAvailable;

  if (existing) {
    await tx
      .update(commerceStockBalances)
      .set({
        availableQty: nextQuantity,
        lastMovementAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(commerceStockBalances.businessId, params.businessId), eq(commerceStockBalances.productId, params.productId)));
  } else {
    await tx.insert(commerceStockBalances).values({
      businessId: params.businessId,
      productId: params.productId,
      availableQty: nextQuantity,
      reservedQty: 0,
      lastMovementAt: new Date(),
    });
  }

  await tx.insert(commerceStockMovements).values({
    businessId: params.businessId,
    suiteTenantId: params.suiteTenantId || null,
    productId: params.productId,
    movementType: "stock_count",
    quantityDelta: delta,
    balanceAfter: nextQuantity,
    sourceRefType: params.sourceRefType,
    sourceRefId: params.sourceRefId || null,
    notes: params.notes || null,
    metadata: { bridge: "inventory" },
  });

  return { availableQty: nextQuantity, delta };
}

export async function upsertCommerceProductFromInventory(
  tx: CommerceTx,
  params: {
    businessId: string;
    productId: string;
    trainingDocumentId?: string | null;
    source: string;
    sourceFilename?: string | null;
    sourceSheet: string;
    sourceRowNumber: number;
    sourceRowKey: string;
    derived: DerivedInventoryProductFields;
    rawFields: Record<string, string>;
    stockSettings?: BusinessStockSettings;
    status?: "active" | "archived" | "draft";
  },
) {
  if (!params.businessId || !params.productId || !params.derived.name) return null;
  const settings = await ensureCommerceSettingsForBusiness(tx, {
    businessId: params.businessId,
    stockSettings: params.stockSettings,
    currency: "LKR",
  });
  if (!settings) return null;

  const imageUrl = params.derived.mediaType === "image" ? params.derived.mediaUrl : null;
  const documentUrl = params.derived.mediaType === "document" ? params.derived.mediaUrl : null;
  const basePriceMinor = amountTextToMinor(params.derived.priceFields[0]?.amount);
  const searchText = params.derived.searchText || buildCommerceSearchText({
    derived: params.derived,
    rawFields: params.rawFields,
  });
  const values = {
    businessId: params.businessId,
    suiteTenantId: settings.suiteTenantId || null,
    source: params.source || "inventory",
    sourceFilename: params.sourceFilename || null,
    sourceSheet: params.sourceSheet || "",
    sourceRowNumber: params.sourceRowNumber || 0,
    sourceRowKey: params.sourceRowKey,
    sku: params.derived.itemCode,
    name: params.derived.name,
    description: params.derived.description,
    specification: params.derived.specification,
    category: params.derived.category,
    brand: params.derived.brand,
    model: params.derived.model,
    unit: params.derived.quantityUnit,
    imageUrl,
    documentUrl,
    basePriceMinor,
    currency: sanitizeCurrency(settings.currency),
    status: params.status || "active",
    publicVisibility: "public",
    rawFields: params.rawFields,
    searchText,
    metadata: {
      bridge: "inventory",
      trainingDocumentId: params.trainingDocumentId || null,
      mediaFilename: params.derived.mediaFilename || null,
    },
    lastImportedAt: new Date(),
    updatedAt: new Date(),
  };

  const [existing] = await tx
    .select({ id: commerceProducts.id })
    .from(commerceProducts)
    .where(
      or(
        eq(commerceProducts.id, params.productId),
        and(eq(commerceProducts.businessId, params.businessId), eq(commerceProducts.sourceRowKey, params.sourceRowKey)),
      ),
    )
    .limit(1);

  const [product] = existing
    ? await tx
        .update(commerceProducts)
        .set(values)
        .where(eq(commerceProducts.id, existing.id))
        .returning()
    : await tx
        .insert(commerceProducts)
        .values({
          id: params.productId,
          ...values,
          createdAt: new Date(),
        })
        .returning();

  if (!product) return null;

  await tx.delete(commerceProductPrices).where(eq(commerceProductPrices.productId, product.id));
  for (const field of params.derived.priceFields) {
    await tx.insert(commerceProductPrices).values({
      businessId: params.businessId,
      productId: product.id,
      sourceKey: field.sourceKey,
      label: field.label || field.sourceKey,
      valueText: field.valueText,
      amountMinor: amountTextToMinor(field.amount),
      currency: sanitizeCurrency(settings.currency),
      sortOrder: field.sortOrder,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  if (params.derived.quantityOnHand !== null) {
    await setCommerceStockAbsolute(tx, {
      businessId: params.businessId,
      suiteTenantId: settings.suiteTenantId || null,
      productId: product.id,
      quantity: params.derived.quantityOnHand,
      sourceRefType: "inventory_import",
      sourceRefId: params.trainingDocumentId || params.source || null,
      notes: "Stock set from mapped inventory import.",
    });
  }

  return product;
}

export async function archiveCommerceProductsMissingFromInventoryScope(
  tx: CommerceTx,
  params: {
    businessId: string;
    activeProductIds: string[];
    source?: string | null;
    trainingDocumentId?: string | null;
  },
) {
  if (params.activeProductIds.length === 0) return;
  await tx.execute(sql`
    UPDATE commerce_products
    SET status = 'archived',
        updated_at = now()
    WHERE business_id = ${params.businessId}
      ${params.trainingDocumentId ? sql`AND metadata->>'trainingDocumentId' = ${params.trainingDocumentId}` : sql``}
      ${params.source && !params.trainingDocumentId ? sql`AND source = ${params.source}` : sql``}
      AND NOT (id = ANY(${params.activeProductIds}))
  `);
}
