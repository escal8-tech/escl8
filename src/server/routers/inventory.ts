import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { STOCK_COLUMN_ROLES } from "@/lib/stock-settings";
import { normalizeStockColumnMappingEntry } from "@/lib/stock-settings";
import * as readSupport from "../services/inventoryReadSupport";
import * as lifecycleSupport from "../services/inventoryLifecycleSupport";
import { withCache, scanDelCached } from "@/lib/redis";

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

function normalizeMappingInput(entries: z.infer<typeof columnMappingEntrySchema>[]) {
  const seen = new Set<string>();
  const seenSingleRoles = new Set<string>();
  const out: any[] = [];
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

export const inventoryRouter = router({
  listItems: businessProcedure
    .input(z.object({
      search: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(24),
      offset: z.number().int().min(0).default(0),
      sortKey: itemSortKeySchema.default("name"),
      sortDir: sortDirectionSchema.default("asc"),
      agentId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const cacheKey = `inventory:listItems:${ctx.businessId}:${input.agentId || "all"}:${input.sortKey}:${input.sortDir}:${input.limit}:${input.offset}:${input.search || "none"}`;
      return withCache(cacheKey, 60, () => readSupport.listItems(ctx.businessId, input));
    }),

  getColumnMapping: businessProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ ctx, input }) => {
      return readSupport.getColumnMapping(ctx.businessId, input.agentId);
    }),

  saveColumnMapping: businessProcedure
    .input(z.object({
      agentId: z.string(),
      columns: z.array(columnMappingEntrySchema).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const columnMapping = normalizeMappingInput(input.columns);
      return lifecycleSupport.saveColumnMapping(ctx.businessId, {
        agentId: input.agentId,
        columnMapping,
      });
    }),

  updateItemQuantity: businessProcedure
    .input(z.object({
      productId: z.string().min(1),
      quantity: z.number().int().min(0),
      agentId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await lifecycleSupport.updateItemQuantity(ctx.businessId, input);
      await scanDelCached(`inventory:listItems:${ctx.businessId}:*`);
      return result;
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
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;
      return readSupport.listOffers(ctx.businessId, {
        ...input,
        limit,
        offset,
      });
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
      const result = await lifecycleSupport.upsertOffer(ctx.businessId, input);
      await scanDelCached(`inventory:listItems:${ctx.businessId}:*`);
      return result;
    }),

  deleteOffer: businessProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await lifecycleSupport.deleteOffer(ctx.businessId, input.id);
      await scanDelCached(`inventory:listItems:${ctx.businessId}:*`);
      return result;
    }),
});
