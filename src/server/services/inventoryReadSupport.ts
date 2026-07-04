import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  commerceOffers as inventoryProductOffers,
  commerceProductPrices as inventoryProductPriceOptions,
  commerceProducts as inventoryProducts,
  commerceStockReservations as inventoryReservations,
  commerceStockBalances,
  agents,
  trainingDocuments,
} from "../../../drizzle/schema";
import {
  friendlyStockColumnLabel,
  getStockMappingStatus,
  inferStockColumnRole,
  normalizeStockColumnMappingEntry,
  normalizeStockColumnKey,
  normalizeStockSettings,
  STOCK_COLUMN_ROLES,
  type StockColumnMappingEntry,
  type StockMappingStatus,
} from "@/lib/stock-settings";
import { withCache } from "@/lib/redis";

function cleanSearch(value: unknown): string {
  return String(value ?? "").trim().slice(0, 200);
}

export async function getAgentStockMappingStatus(agentId: string | null | undefined): Promise<StockMappingStatus> {
  if (!agentId) return {
    isMapped: false,
    isReady: false,
    hasName: false,
    priceCount: 0,
    hasQuantity: false,
    hasImage: false,
    hasDocument: false,
    mappedAt: null,
  };
  const [agent] = await db
    .select({ settings: agents.settings })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  return getStockMappingStatus(normalizeStockSettings(agent?.settings));
}

function serializePriceOption(row: typeof inventoryProductPriceOptions.$inferSelect) {
  return {
    id: row.id,
    productId: row.productId,
    sourceKey: row.sourceKey,
    label: row.label,
    valueText: row.valueText,
    amount: row.amountMinor ? (row.amountMinor / 100).toFixed(2) : null,
    currency: row.currency,
    sortOrder: row.sortOrder,
  };
}

function serializeOffer(row: typeof inventoryProductOffers.$inferSelect, productName?: string | null) {
  return {
    id: row.id,
    productId: row.productId,
    productName: productName ?? null,
    title: row.title,
    originalPriceText: row.metadata?.originalPriceText as string ?? (row.originalPriceMinor ? (row.originalPriceMinor / 100).toFixed(2) : ""),
    originalPriceAmount: row.originalPriceMinor ? row.originalPriceMinor / 100 : null,
    offerPriceText: row.metadata?.offerPriceText as string ?? (row.offerPriceMinor ? (row.offerPriceMinor / 100).toFixed(2) : ""),
    offerPriceAmount: row.offerPriceMinor ? row.offerPriceMinor / 100 : null,
    currency: row.currency,
    notes: row.description,
    isActive: row.active,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export function serializeProduct(
  row: typeof inventoryProducts.$inferSelect & { availableQuantity?: number | null; quantityInitial?: number | null },
  priceOptions: Array<typeof inventoryProductPriceOptions.$inferSelect>,
  offer?: typeof inventoryProductOffers.$inferSelect,
  reservedQuantity = 0,
) {
  const availableQty = row.availableQuantity ?? null;
  return {
    id: row.id,
    agentId: row.agentId,
    itemCode: row.sku,
    name: row.name,
    specification: row.specification,
    description: row.description,
    category: row.category,
    brand: row.brand,
    model: row.model,
    mediaUrl: row.imageUrl || row.documentUrl,
    mediaType: row.imageUrl ? "image" : (row.documentUrl ? "document" : null),
    mediaFilename: row.metadata?.mediaFilename,
    quantityOnHand: availableQty,
    reservedQuantity,
    availableQuantity: availableQty,
    quantityInitial: row.quantityInitial ?? null,
    quantityUnit: row.unit,
    sourceFilename: row.sourceFilename,
    sourceSheet: row.sourceSheet,
    sourceRowNumber: row.sourceRowNumber,
    rawFields: row.rawFields ?? {},
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    priceOptions: priceOptions.map(serializePriceOption),
    activeOffer: offer ? serializeOffer(offer, row.name) : null,
  };
}

async function activeOffersForProducts(businessId: string, productIds: string[]) {
  if (productIds.length === 0) return new Map<string, typeof inventoryProductOffers.$inferSelect>();
  const now = new Date();
  const rows = await db
    .select()
    .from(inventoryProductOffers)
    .where(
      and(
        eq(inventoryProductOffers.businessId, businessId),
        inArray(inventoryProductOffers.productId, productIds),
        eq(inventoryProductOffers.active, true),
        or(isNull(inventoryProductOffers.startsAt), lte(inventoryProductOffers.startsAt, now))!,
        or(isNull(inventoryProductOffers.endsAt), gte(inventoryProductOffers.endsAt, now))!,
      ),
    )
    .orderBy(desc(inventoryProductOffers.updatedAt));

  const out = new Map<string, typeof inventoryProductOffers.$inferSelect>();
  for (const row of rows) {
    if (!out.has(row.productId)) out.set(row.productId, row);
  }
  return out;
}

async function activeReservationQuantitiesForProducts(businessId: string, productIds: string[]) {
  if (productIds.length === 0) return new Map<string, number>();
  const now = new Date();
  const rows = await db
    .select({
      productId: inventoryReservations.productId,
      quantity: sql<number>`coalesce(sum(${inventoryReservations.quantity}), 0)::int`,
    })
    .from(inventoryReservations)
    .where(
      and(
        eq(inventoryReservations.businessId, businessId),
        inArray(inventoryReservations.productId, productIds),
        eq(inventoryReservations.status, "held"),
        gte(inventoryReservations.expiresAt, now),
      ),
    )
    .groupBy(inventoryReservations.productId);
  return new Map(rows.map((row) => [row.productId, Number(row.quantity) || 0]));
}

export async function listItems(ctx: { businessId: string }, input: {
  search?: string;
  limit: number;
  offset: number;
  sortKey: "name" | "updatedAt" | "quantity";
  sortDir: "asc" | "desc";
  agentId?: string;
}) {
  const cacheKey = `inventory:listItems:${ctx.businessId}:${JSON.stringify(input)}`;
  return withCache(cacheKey, 60, async () => {
    const conditions: any[] = [
      eq(inventoryProducts.businessId, ctx.businessId),
      eq(inventoryProducts.status, "active"),
      sql`commerce_products.metadata->>'bridge' = 'inventory'`,
    ];
    if (input.agentId) {
      conditions.push(eq(inventoryProducts.agentId, input.agentId));
    }

    const search = cleanSearch(input.search);
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        or(
          ilike(inventoryProducts.name, pattern),
          ilike(inventoryProducts.sku, pattern),
          ilike(inventoryProducts.searchText, pattern),
          ilike(inventoryProducts.category, pattern),
          ilike(inventoryProducts.brand, pattern),
          ilike(inventoryProducts.model, pattern),
        )!,
      );
    }

    const sortDirection = input.sortDir === "asc" ? asc : desc;
    const nameSortExpr = sql<string>`lower(coalesce(${inventoryProducts.name}, ''))`;
    const quantitySortExpr = sql<number>`coalesce(${commerceStockBalances.availableQty}, -1)`;
    const orderBy =
      input.sortKey === "quantity"
        ? [sortDirection(quantitySortExpr), asc(nameSortExpr)]
        : input.sortKey === "updatedAt"
          ? [sortDirection(inventoryProducts.updatedAt), asc(nameSortExpr)]
          : [sortDirection(nameSortExpr), desc(inventoryProducts.updatedAt)];

    const [[countRow], dbRows, mappingStatus] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(inventoryProducts)
        .where(and(...conditions)),
      db
        .select({
          product: inventoryProducts,
          stock: commerceStockBalances,
        })
        .from(inventoryProducts)
        .leftJoin(commerceStockBalances, eq(inventoryProducts.id, commerceStockBalances.productId))
        .where(and(...conditions))
        .orderBy(...orderBy)
        .limit(input.limit)
        .offset(input.offset),
      getAgentStockMappingStatus(input.agentId ?? ""),
    ]);

    const rows = dbRows.map(({ product, stock }) => ({
      ...product,
      availableQuantity: stock?.availableQty ?? null,
    }));

    const ids = rows.map((row) => row.id);
    const [priceRows, offersByProduct, reservationsByProduct] = await Promise.all([
      ids.length
        ? db
            .select()
            .from(inventoryProductPriceOptions)
            .where(and(eq(inventoryProductPriceOptions.businessId, ctx.businessId), inArray(inventoryProductPriceOptions.productId, ids)))
            .orderBy(asc(inventoryProductPriceOptions.sortOrder), asc(inventoryProductPriceOptions.label))
        : Promise.resolve([]),
      activeOffersForProducts(ctx.businessId, ids),
      activeReservationQuantitiesForProducts(ctx.businessId, ids),
    ]);

    const pricesByProduct = new Map<string, Array<typeof inventoryProductPriceOptions.$inferSelect>>();
    for (const row of priceRows) {
      const list = pricesByProduct.get(row.productId) ?? [];
      list.push(row);
      pricesByProduct.set(row.productId, list);
    }

    return {
      totalCount: countRow?.count ?? 0,
      mappingStatus,
      items: rows.map((row) => serializeProduct(
        row,
        pricesByProduct.get(row.id) ?? [],
        offersByProduct.get(row.id),
        reservationsByProduct.get(row.id) ?? 0,
      )),
    };
  });
}
