import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  businesses,
  agents,
  commerceProducts,
} from "../../../drizzle/schema";
import {
  friendlyStockColumnLabel,
  inferStockColumnRole,
  mergeStockSettings,
  normalizeStockColumnKey,
  normalizeStockSettings,
  type BusinessStockSettings,
  type StockColumnMappingEntry,
  type StockColumnRole,
} from "@/lib/stock-settings";
import {
  isMeaningfulInventoryValue,
  normalizeHeaderKey,
  summarizeInventoryFields,
} from "@/server/rag/inventoryFields";
import type { SpreadsheetRow } from "@/server/rag/extractText";
import { acquireInventoryBusinessLock } from "@/server/inventory/locks";
import {
  ensureCommerceSettingsForBusiness,
  upsertCommerceProductFromInventory,
} from "@/server/commerce/inventoryBridge";

export type DerivedPriceField = {
  sourceKey: string;
  label: string;
  valueText: string;
  amount: string | null;
  sortOrder: number;
};

export type DerivedInventoryProductFields = {
  itemCode: string | null;
  name: string;
  specification: string | null;
  description: string | null;
  category: string | null;
  brand: string | null;
  model: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  mediaFilename: string | null;
  quantityOnHand: number | null;
  quantityInitial: number | null;
  quantityUnit: string | null;
  searchText: string;
  priceFields: DerivedPriceField[];
};

type FieldEntry = {
  key: string;
  label: string;
  role: StockColumnRole;
  priceLabel?: string;
  value: string;
  sortOrder: number;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function parseInventoryAmount(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text || !/\d/.test(text)) return null;
  const match = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount.toFixed(2);
}

function parseQuantity(value: unknown): number | null {
  const text = normalizeText(value).replace(/,/g, "");
  if (!text || !/\d/.test(text)) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.floor(amount);
}

function quantityUnit(value: unknown): string | null {
  const text = normalizeText(value);
  const match = text.match(/\d+(?:[.,]\d+)?\s*([a-zA-Z][a-zA-Z./-]{0,18})/);
  return match?.[1] ? match[1].slice(0, 20) : null;
}

function extractFirstUrl(value: unknown): string {
  const text = normalizeText(value);
  const match = text.match(/https?:\/\/[^\s|,<>"]+/i);
  return match ? match[0].replace(/[.)\],;]+$/g, "") : "";
}

function mediaKind(url: string, role: StockColumnRole, key: string): "image" | "document" | "" {
  if (!url) return "";
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt)(?:$|\?)/.test(path)) return "document";
  if (/\.(jpg|jpeg|png|webp|gif|bmp)(?:$|\?)/.test(path)) return "image";
  if (role === "document" || key.includes("pdf") || key.includes("manual") || key.includes("brochure")) return "document";
  if (role === "image") return "image";
  return "";
}

function mediaFilename(url: string): string | null {
  if (!url) return null;
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "").trim();
    return name ? name.slice(0, 240) : null;
  } catch {
    return null;
  }
}

function mappingByKey(settings?: BusinessStockSettings): Map<string, StockColumnMappingEntry> {
  const out = new Map<string, StockColumnMappingEntry>();
  for (const entry of settings?.columnMapping ?? []) {
    out.set(normalizeStockColumnKey(entry.key), entry);
  }
  return out;
}

function normalizedFields(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields || {})) {
    const normalizedKey = normalizeHeaderKey(key);
    const normalizedValue = normalizeText(value);
    if (!normalizedKey || !normalizedValue || !isMeaningfulInventoryValue(normalizedValue)) continue;
    out[normalizedKey] = normalizedValue;
  }
  return out;
}

function entriesForFields(fields: Record<string, string>, settings?: BusinessStockSettings): FieldEntry[] {
  const map = mappingByKey(settings);
  return Object.entries(fields).map(([key, value], index) => {
    const mapped = map.get(normalizeStockColumnKey(key));
    const role = mapped?.role ?? inferStockColumnRole(key);
    const label = mapped?.label || friendlyStockColumnLabel(key);
    return {
      key,
      label,
      role,
      priceLabel: mapped?.priceLabel,
      value,
      sortOrder: index,
    };
  });
}

function firstValue(entries: FieldEntry[], role: StockColumnRole): string {
  for (const entry of entries) {
    if (entry.role !== role) continue;
    if (entry.value && isMeaningfulInventoryValue(entry.value)) return entry.value;
  }
  return "";
}

function firstUrl(entries: FieldEntry[]): { url: string; type: "image" | "document"; filename: string | null } | null {
  for (const role of ["image", "document"] as StockColumnRole[]) {
    for (const entry of entries) {
      if (entry.role !== role) continue;
      const url = extractFirstUrl(entry.value);
      const type = mediaKind(url, entry.role, entry.key);
      if (!url || !type) continue;
      return { url, type, filename: mediaFilename(url) };
    }
  }

  for (const entry of entries) {
    const url = extractFirstUrl(entry.value);
    const type = mediaKind(url, entry.role, entry.key);
    if (!url || !type) continue;
    return { url, type, filename: mediaFilename(url) };
  }
  return null;
}

export async function getAgentStockSettings(agentId: string): Promise<BusinessStockSettings> {
  if (!agentId) return normalizeStockSettings(null);
  const [agent] = await db
    .select({ settings: agents.settings })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  return normalizeStockSettings(agent?.settings);
}

export function deriveInventoryProductFromFields(
  rawFields: Record<string, string>,
  settings?: BusinessStockSettings,
): DerivedInventoryProductFields {
  const fields = normalizedFields(rawFields);
  const entries = entriesForFields(fields, settings);
  const summary = summarizeInventoryFields(fields);

  const name = normalizeText(firstValue(entries, "name") || summary.product);
  const description = normalizeText(firstValue(entries, "description") || summary.specification);
  const model = normalizeText(firstValue(entries, "model"));
  const specification = normalizeText(
    [
      description && description !== name ? description : "",
      model && model !== name ? model : "",
    ].filter(Boolean).join(" | ") || summary.specification,
  );
  const quantityRaw = firstValue(entries, "quantity");
  const parsedQuantity = parseQuantity(quantityRaw);
  const media = firstUrl(entries);

  const priceFields = entries
    .filter((entry) => entry.role === "price" && entry.value && /\d/.test(entry.value))
    .map((entry) => ({ entry, amount: parseInventoryAmount(entry.value) }))
    .filter((row): row is { entry: FieldEntry; amount: string } => Boolean(row.amount))
    .map(({ entry, amount }) => ({
      sourceKey: normalizeStockColumnKey(entry.key) || `price_${entry.sortOrder + 1}`,
      label: entry.priceLabel || entry.label || friendlyStockColumnLabel(entry.key),
      valueText: normalizeText(entry.value),
      amount,
      sortOrder: entry.sortOrder,
    }));

  const searchText = [
    name,
    firstValue(entries, "item_code") || summary.itemCode,
    specification,
    firstValue(entries, "category"),
    firstValue(entries, "brand"),
    model,
    ...priceFields.flatMap((field) => [field.label, field.valueText]),
    Object.entries(fields).map(([key, value]) => `${key} ${value}`).join(" "),
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  return {
    itemCode: normalizeText(firstValue(entries, "item_code") || summary.itemCode) || null,
    name,
    specification: specification || null,
    description: description || null,
    category: normalizeText(firstValue(entries, "category")) || null,
    brand: normalizeText(firstValue(entries, "brand")) || null,
    model: model || null,
    mediaUrl: media?.url || null,
    mediaType: media?.type || null,
    mediaFilename: media?.filename || null,
    quantityOnHand: parsedQuantity,
    quantityInitial: parsedQuantity,
    quantityUnit: quantityUnit(quantityRaw),
    searchText,
    priceFields,
  };
}

export async function saveAgentStockSettings(params: {
  agentId: string;
  settings: BusinessStockSettings;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [agent] = await tx
      .select({ settings: agents.settings, businessId: agents.businessId })
      .from(agents)
      .where(eq(agents.id, params.agentId))
      .limit(1);
    const nextSettings = mergeStockSettings(
      (agent?.settings ?? {}) as Record<string, unknown>,
      {
        ...params.settings,
        updatedAt: new Date().toISOString(),
      },
    );
    await tx
      .update(agents)
      .set({ settings: nextSettings, updatedAt: new Date() })
      .where(eq(agents.id, params.agentId));
    await ensureCommerceSettingsForBusiness(tx, {
      businessId: agent.businessId,
      stockSettings: {
        ...params.settings,
        updatedAt: new Date().toISOString(),
      },
    });
  });
}

export async function applyStockColumnMappingForAgent(params: {
  agentId: string;
  settings?: BusinessStockSettings;
  trainingDocumentId?: string | null; // Only update products from this training document
}): Promise<number> {
  const settings = params.settings ?? await getAgentStockSettings(params.agentId);
  const rows = await db
    .select({
      id: commerceProducts.id,
      rawFields: commerceProducts.rawFields,
      trainingDocumentId: sql<string>`metadata->>'trainingDocumentId'`,
      status: commerceProducts.status,
      source: commerceProducts.source,
      sourceFilename: commerceProducts.sourceFilename,
      sourceSheet: commerceProducts.sourceSheet,
      sourceRowNumber: commerceProducts.sourceRowNumber,
      sourceRowKey: commerceProducts.sourceRowKey,
      businessId: commerceProducts.businessId,
    })
    .from(commerceProducts)
    .where(and(
      eq(commerceProducts.agentId, params.agentId), 
      eq(commerceProducts.status, "active"),
      sql`metadata->>'bridge' = 'inventory'`
    ));

  let applied = 0;
  await db.transaction(async (tx) => {
    await acquireInventoryBusinessLock(tx, params.agentId);
    for (const row of rows) {
      // Skip products not from the current training document (if specified)
      if (params.trainingDocumentId && row.trainingDocumentId !== params.trainingDocumentId) {
        continue;
      }
      const rawFields = row.rawFields && typeof row.rawFields === "object" ? row.rawFields : {};
      const mapped = deriveInventoryProductFromFields(rawFields as Record<string, string>, settings);
      if (!mapped.name) continue;

      const updatedProduct = await upsertCommerceProductFromInventory(tx, {
        businessId: row.businessId,
        agentId: params.agentId,
        productId: row.id,
        trainingDocumentId: row.trainingDocumentId,
        source: row.source,
        sourceFilename: row.sourceFilename,
        sourceSheet: row.sourceSheet,
        sourceRowNumber: row.sourceRowNumber,
        sourceRowKey: row.sourceRowKey,
        derived: mapped,
        rawFields: rawFields as Record<string, string>,
        stockSettings: settings,
        status: row.status === "archived" ? "archived" : "active",
      });
      applied += 1;
    }
  });

  return applied;
}

export async function rebaseInventoryFromTrainingDocument(params: {
  agentId: string;
  trainingDocumentId: string;
  settings?: BusinessStockSettings;
}): Promise<{ deleted: number; inserted: number }> {
  const settings = params.settings ?? await getAgentStockSettings(params.agentId);

  // Get the training document to extract structured rows
  const { db } = await import("@/server/db/client");
  const { trainingDocuments } = await import("../../../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const [doc] = await db
    .select()
    .from(trainingDocuments)
    .where(eq(trainingDocuments.id, params.trainingDocumentId))
    .limit(1);

  if (!doc) {
    throw new Error(`Training document not found: ${params.trainingDocumentId}`);
  }

  // Download and parse the document to get structured rows
  const { downloadBlobToBuffer } = await import("../rag/blob");
  const { extractTextFromBuffer } = await import("../rag/extractText");

  const blob = await downloadBlobToBuffer(doc.blobPath);
  const extracted = await extractTextFromBuffer({
    buffer: blob.buffer,
    filename: doc.originalFilename,
    contentType: doc.contentType ?? undefined,
    preserveLineBreaks: true,
  });

  if (!extracted.structuredRows || extracted.structuredRows.length === 0) {
    throw new Error("No structured rows found in training document");
  }

  const structuredRows: SpreadsheetRow[] = extracted.structuredRows;

  let deleted = 0;
  let inserted = 0;

  await db.transaction(async (tx) => {
    await acquireInventoryBusinessLock(tx, params.agentId);

    // 1. Archive all products NOT from this training document
    // Use raw SQL for IS DISTINCT FROM (handles null trainingDocumentId correctly)
    const archiveResult = await tx.execute(sql`
      UPDATE commerce_products
      SET status = 'archived', updated_at = now()
      WHERE agent_id = ${params.agentId}
        AND status = 'active'
        AND metadata->>'bridge' = 'inventory'
        AND metadata->>'trainingDocumentId' IS DISTINCT FROM ${params.trainingDocumentId}
      RETURNING id
    `);

    // Count only the products archived by the UPDATE above (not pre-existing archives)
    deleted = archiveResult.rows?.length ?? 0;

    // 2. Insert fresh products from the new training document
    const { replaceInventoryProductsForRows } = await import("../rag/productCatalog");
    const refs = await replaceInventoryProductsForRows({
      businessId: doc.businessId,
      agentId: params.agentId,
      trainingDocumentId: params.trainingDocumentId,
      source: doc.blobPath,
      sourceFilename: doc.originalFilename,
      rows: structuredRows,
    });

    inserted = refs.size;
  });

  return { deleted, inserted };
}
