/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import {
  commerceOffers as inventoryProductOffers,
  commerceProductPrices as inventoryProductPriceOptions,
  commerceProducts as inventoryProducts,
  agents,
  trainingDocuments,
} from "../../../drizzle/schema";
import {
  friendlyStockColumnLabel,
  inferStockColumnRole,
  normalizeStockColumnMappingEntry,
  normalizeStockColumnKey,
  normalizeStockSettings,
  STOCK_COLUMN_ROLES,
  type StockColumnMappingEntry,
} from "@/lib/stock-settings";
import {
  applyStockColumnMappingForAgent,
  parseInventoryAmount,
  saveAgentStockSettings,
} from "@/server/inventory/stockMapping";
import { acquireInventoryBusinessLock } from "@/server/inventory/locks";
import { setCommerceStockAbsolute } from "@/server/commerce/inventoryBridge";
import { withRedisWorkflowLock } from "@/server/services/ticketWorkflowSupport";
import * as readSupport from "../services/inventoryReadSupport";

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

export const inventoryRouter = router({
  listItems: businessProcedure
    .input(z.object({
      search: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(24),
      offset: z.number().int().min(0).default(0),
      sortKey: itemSortKeySchema.default("name"),
      sortDir: sortDirectionSchema.default("asc"),
     agentId: z.string().optional(),}))
    .query(async ({ ctx, input }) => {
      return readSupport.listItems(ctx, input);
    }),

  getColumnMapping: businessProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ ctx, input }) => {
    const [agent] = await db
      .select({ settings: agents.settings })
      .from(agents)
      .where(and(eq(agents.id, input.agentId), eq(agents.businessId, ctx.businessId)))
      .limit(1);

    if (!agent) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Agent not found or does not belong to your business.",
      });
    }

    const stockSettings = normalizeStockSettings(agent?.settings);
    const mapped = new Map(stockSettings.columnMapping.map((entry) => [entry.key, entry]));

    const [latestInventoryDoc] = await db
      .select({ id: trainingDocuments.id })
      .from(trainingDocuments)
      .where(
        and(
          eq(trainingDocuments.agentId, input.agentId),
          eq(trainingDocuments.docType, "inventory")
        )
      )
      .orderBy(desc(trainingDocuments.uploadedAt))
      .limit(1);

    const productWhere = latestInventoryDoc
      ? and(
          eq(inventoryProducts.businessId, ctx.businessId),
          eq(inventoryProducts.status, "active"),
        sql`commerce_products.metadata->>'bridge' = 'inventory'`,
          eq(sql`commerce_products.metadata->>'trainingDocumentId'`, latestInventoryDoc.id)
        )
      : and(
          eq(inventoryProducts.businessId, ctx.businessId),
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
        const current = mapped.get(key) as StockColumnMappingEntry | undefined;
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
  }),

  saveColumnMapping: businessProcedure
    .input(z.object({
      agentId: z.string(),
      columns: z.array(columnMappingEntrySchema).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const [agent] = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, input.agentId), eq(agents.businessId, ctx.businessId)))
        .limit(1);

      if (!agent) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Agent not found or does not belong to your business.",
        });
      }

      const columnMapping = normalizeMappingInput(input.columns);
      await saveAgentStockSettings({
        agentId: input.agentId,
        settings: {
          schemaVersion: 1,
          columnMapping,
          updatedAt: new Date().toISOString(),
        },
      });
      const appliedCount = await applyStockColumnMappingForAgent({
        agentId: input.agentId,
        settings: { schemaVersion: 1, columnMapping },
      });
      return { ok: true, appliedCount };
    }),

  updateItemQuantity: businessProcedure
    .input(z.object({
      productId: z.string().min(1),
      quantity: z.number().int().min(0),
      agentId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const lockKey = `${ctx.businessId}::inventory::${input.productId}`;
      const row = await withRedisWorkflowLock(lockKey, async () => {
        return await db.transaction(async (tx) => {
          await acquireInventoryBusinessLock(tx, ctx.businessId);
        const [updated] = await tx
          .update(inventoryProducts)
          .set({ updatedAt: new Date() })
          .where(and(eq(inventoryProducts.businessId, ctx.businessId), eq(inventoryProducts.id, input.productId)))
          .returning();
        if (updated) {
          await setCommerceStockAbsolute(tx, {
            businessId: ctx.businessId,
            productId: input.productId,
            quantity: input.quantity,
            sourceRefType: "manual_inventory_adjustment",
            sourceRefId: input.productId,
            notes: "Manual stock count from agent inventory page.",
          });
        }
        return updated;
      });
      });
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
      }
      return { ok: true, item: readSupport.serializeProduct(row, [], undefined, 0) };
    }),

  listOffers: businessProcedure
    .input(z.object({
      includeInactive: z.boolean().optional(),
      search: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      agentId: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const conditions: any[] = [eq(inventoryProductOffers.businessId, ctx.businessId)];
      if (input?.agentId) {
        conditions.push(eq(inventoryProductOffers.agentId, input.agentId));
      }
      if (!input?.includeInactive) {
        conditions.push(eq(inventoryProductOffers.active, true));
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

      const productIds = Array.from(new Set(rows.map((row) => row.productId))).filter(Boolean) as string[];
      const products = productIds.length
        ? await db
            .select({ id: inventoryProducts.id, name: inventoryProducts.name })
            .from(inventoryProducts)
            .where(and(eq(inventoryProducts.businessId, ctx.businessId), inArray(inventoryProducts.id, productIds)))
        : [];
      const productNames = new Map(products.map((row) => [row.id, row.name]));

      return {
        totalCount: countRow?.count ?? 0,
        mappingStatus: await readSupport.getAgentStockMappingStatus(input?.agentId),
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
      agentId: z.string().optional(),
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

      const parsedOriginal = input.originalPriceText ? parseInventoryAmount(input.originalPriceText) : null;
      const originalPriceMinor = parsedOriginal != null ? Math.round(Number(parsedOriginal) * 100) : null;
      const parsedOffer = parseInventoryAmount(input.offerPriceText);
      const offerPriceMinor = parsedOffer != null ? Math.round(Number(parsedOffer) * 100) : 0;

      const values = {
        businessId: ctx.businessId,
        productId: input.productId,
        title: input.title.trim() || "Offer",
        originalPriceMinor,
        metadata: {
          originalPriceText: input.originalPriceText?.trim() || null,
          offerPriceText: input.offerPriceText.trim(),
        },
        offerPriceMinor,
        currency: input.currency.trim() || "LKR",
        description: input.notes?.trim() || null,
        active: input.isActive,
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
