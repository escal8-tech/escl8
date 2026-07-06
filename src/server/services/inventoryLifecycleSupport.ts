import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  commerceOffers as inventoryProductOffers,
  commerceProducts as inventoryProducts,
  agents,
} from "../../../drizzle/schema";
import {
  applyStockColumnMappingForAgent,
  parseInventoryAmount,
  saveAgentStockSettings,
} from "@/server/inventory/stockMapping";
import { acquireInventoryBusinessLock } from "@/server/inventory/locks";
import { setCommerceStockAbsolute } from "@/server/commerce/inventoryBridge";
import { withRedisWorkflowLock } from "@/server/services/ticketWorkflowSupport";
import { TRPCError } from "@trpc/server";
import { serializeProduct, serializeOffer } from "./inventoryReadSupport";

function parseDate(value: unknown): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

export async function saveColumnMapping(businessId: string, input: {
  agentId: string;
  columnMapping: any[];
}) {
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, input.agentId), eq(agents.businessId, businessId)))
    .limit(1);

  if (!agent) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Agent not found or does not belong to your business.",
    });
  }

  await saveAgentStockSettings({
    agentId: input.agentId,
    settings: {
      schemaVersion: 1,
      columnMapping: input.columnMapping,
      updatedAt: new Date().toISOString(),
    },
  });
  const appliedCount = await applyStockColumnMappingForAgent({
    agentId: input.agentId,
    settings: { schemaVersion: 1, columnMapping: input.columnMapping },
  });
  return { ok: true, appliedCount };
}

export async function updateItemQuantity(businessId: string, input: {
  productId: string;
  quantity: number;
}) {
  const lockKey = `${businessId}::inventory::${input.productId}`;
  const row = await withRedisWorkflowLock(lockKey, async () => {
    return await db.transaction(async (tx) => {
      await acquireInventoryBusinessLock(tx, businessId);
      const [updated] = await tx
        .update(inventoryProducts)
        .set({ updatedAt: new Date() })
        .where(and(eq(inventoryProducts.businessId, businessId), eq(inventoryProducts.id, input.productId)))
        .returning();
      if (updated) {
        await setCommerceStockAbsolute(tx, {
          businessId,
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
  return { ok: true, item: serializeProduct(row, [], undefined, 0) };
}

export async function upsertOffer(businessId: string, input: {
  id?: string;
  productId: string;
  title: string;
  originalPriceText?: string;
  offerPriceText: string;
  currency: string;
  notes?: string;
  isActive: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}) {
  const [product] = await db
    .select({ id: inventoryProducts.id, name: inventoryProducts.name })
    .from(inventoryProducts)
    .where(and(eq(inventoryProducts.businessId, businessId), eq(inventoryProducts.id, input.productId)))
    .limit(1);
  if (!product) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
  }

  const parsedOriginal = input.originalPriceText ? parseInventoryAmount(input.originalPriceText) : null;
  const originalPriceMinor = parsedOriginal != null ? Math.round(Number(parsedOriginal) * 100) : null;
  const parsedOffer = parseInventoryAmount(input.offerPriceText);
  const offerPriceMinor = parsedOffer != null ? Math.round(Number(parsedOffer) * 100) : 0;

  const values = {
    businessId,
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
        .where(and(eq(inventoryProductOffers.businessId, businessId), eq(inventoryProductOffers.id, input.id)))
        .returning()
    : await db
        .insert(inventoryProductOffers)
        .values({ ...values, createdAt: new Date() })
        .returning();

  if (!offer) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Offer not found" });
  }
  return { ok: true, offer: serializeOffer(offer, product.name) };
}

export async function deleteOffer(businessId: string, id: string) {
  await db
    .delete(inventoryProductOffers)
    .where(and(eq(inventoryProductOffers.businessId, businessId), eq(inventoryProductOffers.id, id)));
  return { ok: true };
}
