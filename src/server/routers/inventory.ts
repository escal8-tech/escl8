/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import {
  inventoryProductOffers,
  inventoryProductPriceOptions,
  inventoryProducts,
  inventoryReservations,
  businesses,
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
import {
  applyStockColumnMappingForBusiness,
  parseInventoryAmount,
  saveBusinessStockSettings,
} from "@/server/inventory/stockMapping";
import { acquireInventoryBusinessLock } from "@/server/inventory/locks";

const sortDirectionSchema = z.enum(["asc", "desc"]);
const itemSortKeySchema = z.enum(["name", "updatedAt", "quantity"]);
const stockRoleSchema = z.enum(STOCK_COLUMN_ROLES);
const SINGLE_VALUE_STOCK_ROLES = new Set([
  "name",
  "item_code",
  "description",
  "category",
  "brand",
  "model",
  "image",
  "document",
  "quantity",
]);

const columnMappingEntrySchema = z.object({
  key: z.string().min(1).max(120),
  label: z.string().min(1).max(160),
  role: stockRoleSchema,
  priceLabel: z.string().max(160).optional(),
});

function cleanSearch(value: unknown): string {
  return String(value ?? "").trim().slice(0, 200);
}

function parseDate(value: unknown): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeMappingInput(entries: z.infer<typeof columnMappingEntrySchema>[]): StockColumnMappingEntry[] {
  const seen = new Set<string>();
  const seenSingleRoles = new Set<string>();
  const out: StockColumnMappingEntry[] = [];
  for (const raw of entries) {
    const normalized = normalizeStockColumnMappingEntry(raw);
    if (!normalized || seen.has(normalized.key)) continue;
    seen.add(normalized.key);
    if (SINGLE_VALUE_STOCK_ROLES.has(normalized.role)) {
      if (seenSingleRoles.has(normalized.role)) {
        out.push({ ...normalized, role: "ignore", priceLabel: undefined });
        continue;
      }
      seenSingleRoles.add(normalized.role);
    }
    out.push(normalized);
  }
  return out;
}

async function getBusinessStockMappingStatus(businessId: string): Promise<StockMappingStatus> {
  const [biz] = await db
    .select({ settings: businesses.settings })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  return getStockMappingStatus(normalizeStockSettings(biz?.settings));
}

function serializePriceOption(row: typeof inventoryProductPriceOptions.$inferSelect) {
  return {
    id: row.id,
    productId: row.productId,
    sourceKey: row.sourceKey,
    label: row.label,
    valueText: row.valueText,
    amount: row.amount,
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
    originalPriceText: row.originalPriceText,
    originalPriceAmount: row.originalPriceAmount,
    offerPriceText: row.offerPriceText,
    offerPriceAmount: row.offerPriceAmount,
    currency: row.currency,
    notes: row.notes,
    isActive: row.isActive,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

function serializeProduct(
  row: typeof inventoryProducts.$inferSelect,
  priceOptions: Array<typeof inventoryProductPriceOptions.$inferSelect>,
  offer?: typeof inventoryProductOffers.$inferSelect,
  reservedQuantity = 0,
) {
  const quantityOnHand = row.quantityOnHand;
  const availableQuantity = quantityOnHand == null ? null : Math.max(0, quantityOnHand - reservedQuantity);
  return {
    id: row.id,
    itemCode: row.itemCode,
    name: row.name,
    specification: row.specification,
    description: row.description,
    category: row.category,
    brand: row.brand,
    model: row.model,
    mediaUrl: row.mediaUrl,
    mediaType: row.mediaType,
    mediaFilename: row.mediaFilename,
    quantityOnHand,
    reservedQuantity,
    availableQuantity,
    quantityInitial: row.quantityInitial,
    quantityUnit: row.quantityUnit,
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
        eq(inventoryProductOffers.isActive, true),
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

export const inventoryRouter = router({
  listItems: businessProcedure
    .input(z.object({
      search: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(24),
      offset: z.number().int().min(0).default(0),
      sortKey: itemSortKeySchema.default("name"),
      sortDir: sortDirectionSchema.default("asc"),
    }))
    .query(async ({ ctx, input }) => {
      const conditions: any[] = [
        eq(inventoryProducts.businessId, ctx.businessId),
        eq(inventoryProducts.status, "active"),
      ];

      const search = cleanSearch(input.search);
      if (search) {
        const pattern = `%${search}%`;
        conditions.push(
          or(
            ilike(inventoryProducts.name, pattern),
            ilike(inventoryProducts.itemCode, pattern),
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
      const quantitySortExpr = sql<number>`coalesce(${inventoryProducts.quantityOnHand}, -1)`;
      const orderBy =
        input.sortKey === "quantity"
          ? [sortDirection(quantitySortExpr), asc(nameSortExpr)]
          : input.sortKey === "updatedAt"
            ? [sortDirection(inventoryProducts.updatedAt), asc(nameSortExpr)]
            : [sortDirection(nameSortExpr), desc(inventoryProducts.updatedAt)];

      const rows = await db
        .select()
        .from(inventoryProducts)
        .where(and(...conditions))
        .orderBy(...orderBy)
        .limit(input.limit)
        .offset(input.offset);

      const ids = rows.map((row) => row.id);
      const priceRows = ids.length
        ? await db
            .select()
            .from(inventoryProductPriceOptions)
            .where(and(eq(inventoryProductPriceOptions.businessId, ctx.businessId), inArray(inventoryProductPriceOptions.productId, ids)))
            .orderBy(asc(inventoryProductPriceOptions.sortOrder), asc(inventoryProductPriceOptions.label))
        : [];
      const offersByProduct = await activeOffersForProducts(ctx.businessId, ids);
      const reservationsByProduct = await activeReservationQuantitiesForProducts(ctx.businessId, ids);
      const pricesByProduct = new Map<string, Array<typeof inventoryProductPriceOptions.$inferSelect>>();
      for (const row of priceRows) {
        const list = pricesByProduct.get(row.productId) ?? [];
        list.push(row);
        pricesByProduct.set(row.productId, list);
      }

      return {
        totalCount: countRow?.count ?? 0,
        mappingStatus: await getBusinessStockMappingStatus(ctx.businessId),
        items: rows.map((row) => serializeProduct(
          row,
          pricesByProduct.get(row.id) ?? [],
          offersByProduct.get(row.id),
          reservationsByProduct.get(row.id) ?? 0,
        )),
      };
    }),

  getColumnMapping: businessProcedure.query(async ({ ctx }) => {
    const [biz] = await db
      .select({ settings: businesses.settings })
      .from(businesses)
      .where(eq(businesses.id, ctx.businessId))
      .limit(1);
    const stockSettings = normalizeStockSettings(biz?.settings);
    const mapped = new Map(stockSettings.columnMapping.map((entry) => [entry.key, entry]));

    const rows = await db
      .select({ rawFields: inventoryProducts.rawFields })
      .from(inventoryProducts)
      .where(and(eq(inventoryProducts.businessId, ctx.businessId), eq(inventoryProducts.status, "active")))
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
    for (const entry of stockSettings.columnMapping) {
      if (!columnStats.has(entry.key)) {
        columnStats.set(entry.key, { count: 0, samples: [] });
      }
    }

    let savedMappingCount = 0;
    let newColumnCount = 0;
    let missingColumnCount = 0;
    const columns = Array.from(columnStats.entries())
      .map(([key, stat]) => {
        const current = mapped.get(key);
        const hasSavedMapping = Boolean(current);
        const isDetected = detectedKeys.has(key);
        if (hasSavedMapping) savedMappingCount += 1;
        if (!hasSavedMapping && isDetected) newColumnCount += 1;
        if (hasSavedMapping && !isDetected) missingColumnCount += 1;
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
          isMissing: hasSavedMapping && !isDetected,
          mappingSource: hasSavedMapping ? "saved" : "suggested",
        };
      })
      .sort((a, b) => Number(a.isMissing) - Number(b.isMissing) || b.count - a.count || a.key.localeCompare(b.key));

    return {
      columns,
      mappingStatus: getStockMappingStatus(stockSettings),
      mappedAt: stockSettings.updatedAt ?? null,
      productCount: rows.length,
      savedMappingCount,
      newColumnCount,
      missingColumnCount,
    };
  }),

  saveColumnMapping: businessProcedure
    .input(z.object({
      columns: z.array(columnMappingEntrySchema).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const columnMapping = normalizeMappingInput(input.columns);
      await saveBusinessStockSettings({
        businessId: ctx.businessId,
        settings: {
          schemaVersion: 1,
          columnMapping,
          updatedAt: new Date().toISOString(),
        },
      });
      const appliedCount = await applyStockColumnMappingForBusiness({
        businessId: ctx.businessId,
        settings: { schemaVersion: 1, columnMapping },
      });
      return { ok: true, appliedCount };
    }),

  updateItemQuantity: businessProcedure
    .input(z.object({
      productId: z.string().min(1),
      quantity: z.number().int().min(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const row = await db.transaction(async (tx) => {
        await acquireInventoryBusinessLock(tx, ctx.businessId);
        const [updated] = await tx
          .update(inventoryProducts)
          .set({ quantityOnHand: input.quantity, updatedAt: new Date() })
          .where(and(eq(inventoryProducts.businessId, ctx.businessId), eq(inventoryProducts.id, input.productId)))
          .returning();
        return updated;
      });
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
      }
      return { ok: true, item: serializeProduct(row, [], undefined, 0) };
    }),

  listOffers: businessProcedure
    .input(z.object({
      includeInactive: z.boolean().optional(),
      search: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const conditions: any[] = [eq(inventoryProductOffers.businessId, ctx.businessId)];
      if (!input?.includeInactive) {
        conditions.push(eq(inventoryProductOffers.isActive, true));
      }
      const search = cleanSearch(input?.search);
      if (search) {
        const pattern = `%${search}%`;
        const matchingProducts = await db
          .select({ id: inventoryProducts.id })
          .from(inventoryProducts)
          .where(and(
            eq(inventoryProducts.businessId, ctx.businessId),
            or(
              ilike(inventoryProducts.name, pattern),
              ilike(inventoryProducts.itemCode, pattern),
              ilike(inventoryProducts.searchText, pattern),
            )!,
          ));
        const productIds = matchingProducts.map((row) => row.id);
        const searchConditions = [
          ilike(inventoryProductOffers.title, pattern),
          ilike(inventoryProductOffers.offerPriceText, pattern),
          ilike(inventoryProductOffers.originalPriceText, pattern),
          ilike(inventoryProductOffers.notes, pattern),
        ];
        if (productIds.length > 0) {
          searchConditions.push(inArray(inventoryProductOffers.productId, productIds));
        }
        conditions.push(or(...searchConditions)!);
      }

      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(inventoryProductOffers)
        .where(and(...conditions));

      const rows = await db
        .select()
        .from(inventoryProductOffers)
        .where(and(...conditions))
        .orderBy(desc(inventoryProductOffers.updatedAt))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0);

      const productIds = Array.from(new Set(rows.map((row) => row.productId)));
      const products = productIds.length
        ? await db
            .select({ id: inventoryProducts.id, name: inventoryProducts.name })
            .from(inventoryProducts)
            .where(and(eq(inventoryProducts.businessId, ctx.businessId), inArray(inventoryProducts.id, productIds)))
        : [];
      const productNames = new Map(products.map((row) => [row.id, row.name]));

      return {
        totalCount: countRow?.count ?? 0,
        mappingStatus: await getBusinessStockMappingStatus(ctx.businessId),
        items: rows.map((row) => serializeOffer(row, productNames.get(row.productId))),
      };
    }),

  upsertOffer: businessProcedure
    .input(z.object({
      id: z.string().optional(),
      productId: z.string().min(1),
      title: z.string().min(1).max(160).default("Offer"),
      originalPriceText: z.string().max(80).optional(),
      offerPriceText: z.string().min(1).max(80),
      currency: z.string().min(1).max(12).default("LKR"),
      notes: z.string().max(500).optional(),
      isActive: z.boolean().default(true),
      startsAt: z.string().max(80).optional().nullable(),
      endsAt: z.string().max(80).optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [product] = await db
        .select({ id: inventoryProducts.id, name: inventoryProducts.name })
        .from(inventoryProducts)
        .where(and(eq(inventoryProducts.businessId, ctx.businessId), eq(inventoryProducts.id, input.productId)))
        .limit(1);
      if (!product) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
      }

      const values = {
        businessId: ctx.businessId,
        productId: input.productId,
        title: input.title.trim() || "Offer",
        originalPriceText: input.originalPriceText?.trim() || null,
        originalPriceAmount: parseInventoryAmount(input.originalPriceText) ?? null,
        offerPriceText: input.offerPriceText.trim(),
        offerPriceAmount: parseInventoryAmount(input.offerPriceText) ?? null,
        currency: input.currency.trim() || "LKR",
        notes: input.notes?.trim() || null,
        isActive: input.isActive,
        startsAt: parseDate(input.startsAt),
        endsAt: parseDate(input.endsAt),
        updatedAt: new Date(),
      };

      const [offer] = input.id
        ? await db
            .update(inventoryProductOffers)
            .set(values)
            .where(and(eq(inventoryProductOffers.businessId, ctx.businessId), eq(inventoryProductOffers.id, input.id)))
            .returning()
        : await db
            .insert(inventoryProductOffers)
            .values({ ...values, createdAt: new Date() })
            .returning();

      if (!offer) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Offer not found" });
      }
      return { ok: true, offer: serializeOffer(offer, product.name) };
    }),

  deleteOffer: businessProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(inventoryProductOffers)
        .where(and(eq(inventoryProductOffers.businessId, ctx.businessId), eq(inventoryProductOffers.id, input.id)));
      return { ok: true };
    }),
});
