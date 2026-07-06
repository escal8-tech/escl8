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
  normalizeStockColumnKey,
  normalizeStockSettings,
  type StockMappingStatus,
} from "@/lib/stock-settings";
import { TRPCError } from "@trpc/server";

export function cleanSearch(value: unknown): string {
  return String(value ?? "").trim().slice(0, 200);
}

export function serializePriceOption(row: typeof inventoryProductPriceOptions.$inferSelect) {
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

export function serializeOffer(row: typeof inventoryProductOffers.$inferSelect, productName?: string | null) {
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

export async function activeOffersForProducts(businessId: string, productIds: string[]) {
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

export async function activeReservationQuantitiesForProducts(businessId: string, productIds: string[]) {
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

export async function listItems(businessId: string, input: {
  search?: string;
  limit: number;
  offset: number;
  sortKey: "name" | "updatedAt" | "quantity";
  sortDir: "asc" | "desc";
  agentId?: string;
}) {
  const conditions: any[] = [
    eq(inventoryProducts.businessId, businessId),
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

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryProducts)
    .where(and(...conditions));

  const sortDirection = input.sortDir === "asc" ? asc : desc;
  const nameSortExpr = sql<string>`lower(coalesce(${inventoryProducts.name}, ''))`;
  const quantitySortExpr = sql<number>`coalesce(${commerceStockBalances.availableQty}, -1)`;
  const orderBy =
    input.sortKey === "quantity"
      ? [sortDirection(quantitySortExpr), asc(nameSortExpr)]
      : input.sortKey === "updatedAt"
        ? [sortDirection(inventoryProducts.updatedAt), asc(nameSortExpr)]
        : [sortDirection(nameSortExpr), desc(inventoryProducts.updatedAt)];

  const dbRows = await db
    .select({
      product: inventoryProducts,
      stock: commerceStockBalances,
    })
    .from(inventoryProducts)
    .leftJoin(commerceStockBalances, eq(inventoryProducts.id, commerceStockBalances.productId))
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(input.limit)
    .offset(input.offset);

  const rows = dbRows.map(({ product, stock }) => ({
    ...product,
    availableQuantity: stock?.availableQty ?? null,
  }));

  const ids = rows.map((row) => row.id);

  // Optimization with Promise.all
  const [priceRows, offersByProduct, reservationsByProduct, mappingStatus] = await Promise.all([
    ids.length
        ? db
            .select()
            .from(inventoryProductPriceOptions)
            .where(and(eq(inventoryProductPriceOptions.businessId, businessId), inArray(inventoryProductPriceOptions.productId, ids)))
            .orderBy(asc(inventoryProductPriceOptions.sortOrder), asc(inventoryProductPriceOptions.label))
        : Promise.resolve([] as any[]),
    activeOffersForProducts(businessId, ids),
    activeReservationQuantitiesForProducts(businessId, ids),
    getAgentStockMappingStatus(input.agentId ?? ""),
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
}

export async function getColumnMapping(businessId: string, agentId: string) {
    const [agent] = await db
      .select({ settings: agents.settings })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.businessId, businessId)))
      .limit(1);

    if (!agent) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Agent not found or does not belong to your business.",
      });
    }

    const stockSettings = normalizeStockSettings(agent?.settings);
    const mapped = new Map(stockSettings.columnMapping.map((entry) => [entry.key, entry]));

    // Find the latest inventory training document for this business
    const [latestInventoryDoc] = await db
      .select({ id: trainingDocuments.id })
      .from(trainingDocuments)
      .where(
        and(
          eq(trainingDocuments.agentId, agentId),
          eq(trainingDocuments.docType, "inventory")
        )
      )
      .orderBy(desc(trainingDocuments.uploadedAt))
      .limit(1);

    // Only get products from the latest training document (or all active if no training doc yet)
    const productWhere = latestInventoryDoc
      ? and(
          eq(inventoryProducts.businessId, businessId),
          eq(inventoryProducts.status, "active"),
        sql`commerce_products.metadata->>'bridge' = 'inventory'`,
          eq(sql`commerce_products.metadata->>'trainingDocumentId'`, latestInventoryDoc.id)
        )
      : and(
          eq(inventoryProducts.businessId, businessId),
          eq(inventoryProducts.status, "active")
        );

    const rows = await db
      .select({ rawFields: inventoryProducts.rawFields })
      .from(inventoryProducts)
      .where(productWhere)
      .limit(1000);

    const columnStats = new Map<string, { count: number; samples: string[] }>();
    for (const row of rows) {
      const rawFields = row.rawFields && typeof row.rawFields === "object" ? row.rawFields as Record<string, unknown> : {};
      for (const [rawKey, rawValue] of Object.entries(rawFields)) {
        const key = normalizeStockColumnKey(rawKey);
        const value = String(rawValue ?? "").trim();
        if (!key) continue;
        const stat = columnStats.get(key) ?? { count: 0, samples: [] };
        stat.count += 1;
        if (value && stat.samples.length < 3 && !stat.samples.includes(value)) {
          stat.samples.push(value.slice(0, 120));
        }
        columnStats.set(key, stat);
      }
    }

    const detectedKeys = new Set(columnStats.keys());
    let savedMappingCount = 0;
    let newColumnCount = 0;
    const missingColumnCount = stockSettings.columnMapping.filter((entry) => !detectedKeys.has(entry.key)).length;
    const columns = Array.from(columnStats.entries())
      .map(([key, stat]) => {
        const current = mapped.get(key) as any | undefined;
        const hasSavedMapping = Boolean(current);
        const isDetected = detectedKeys.has(key);
        if (hasSavedMapping) savedMappingCount += 1;
        if (!hasSavedMapping && isDetected) newColumnCount += 1;
        const role = current?.role ?? inferStockColumnRole(key);
        return {
          key,
          label: current?.label || friendlyStockColumnLabel(key),
          detectedLabel: friendlyStockColumnLabel(key),
          role,
          priceLabel: current?.priceLabel || (role === "price" ? friendlyStockColumnLabel(key) : ""),
          count: stat.count,
          samples: stat.samples,
          hasSavedMapping,
          isNew: !hasSavedMapping && isDetected,
          isMissing: false,
          mappingSource: hasSavedMapping ? "saved" : "suggested",
        };
      })
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

    return {
      columns,
      mappingStatus: getStockMappingStatus(stockSettings),
      mappedAt: stockSettings.updatedAt ?? null,
      productCount: rows.length,
      savedMappingCount,
      newColumnCount,
      missingColumnCount,
    };
}

export async function listOffers(businessId: string, input: {
  includeInactive?: boolean;
  search?: string;
  limit: number;
  offset: number;
  agentId?: string;
}) {
  const conditions: any[] = [eq(inventoryProductOffers.businessId, businessId)];
  if (input.agentId) {
    conditions.push(eq(inventoryProductOffers.agentId, input.agentId));
  }
  if (!input.includeInactive) {
    conditions.push(eq(inventoryProductOffers.active, true));
  }
  const search = cleanSearch(input.search);
  if (search) {
    const pattern = `%${search}%`;
    const matchingProducts = await db
      .select({ id: inventoryProducts.id })
      .from(inventoryProducts)
      .where(and(
        eq(inventoryProducts.businessId, businessId),
        or(
          ilike(inventoryProducts.name, pattern),
          ilike(inventoryProducts.sku, pattern),
          ilike(inventoryProducts.searchText, pattern),
        )!,
      ));
    const productIds = matchingProducts.map((row) => row.id);
    const searchConditions = [
      ilike(inventoryProductOffers.title, pattern),
      ilike(inventoryProductOffers.description, pattern),
    ];
    if (productIds.length > 0) {
      searchConditions.push(inArray(inventoryProductOffers.productId, productIds));
    }
    conditions.push(or(...searchConditions)!);
  }

  const [countRow, rows] = await Promise.all([
    db
        .select({ count: sql<number>`count(*)::int` })
        .from(inventoryProductOffers)
        .where(and(...conditions)),
    db
        .select()
        .from(inventoryProductOffers)
        .where(and(...conditions))
        .orderBy(desc(inventoryProductOffers.updatedAt))
        .limit(input.limit)
        .offset(input.offset)
  ]);

  const productIds = Array.from(new Set(rows.map((row) => row.productId))).filter(Boolean) as string[];
  const products = productIds.length
    ? await db
        .select({ id: inventoryProducts.id, name: inventoryProducts.name })
        .from(inventoryProducts)
        .where(and(eq(inventoryProducts.businessId, businessId), inArray(inventoryProducts.id, productIds)))
    : [];
  const productNames = new Map(products.map((row) => [row.id, row.name]));

  return {
    totalCount: countRow[0]?.count ?? 0,
    mappingStatus: await getAgentStockMappingStatus(input.agentId),
    items: rows.map((row) => serializeOffer(row, productNames.get(row.productId))),
  };
}
