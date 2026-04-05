/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SpreadsheetRow } from "./extractText";

const PLACEHOLDER_VALUES = new Set([
  "",
  "-",
  "--",
  "n/a",
  "na",
  "none",
  "null",
  "nil",
  "nill",
  "false",
]);

const PRODUCT_KEYS = new Set([
  "product_name",
  "item_name",
  "name",
  "product",
  "item",
  "model_name",
  "model",
  "title",
]);

const CODE_KEYS = new Set([
  "item_code",
  "product_code",
  "sku",
  "code",
  "model_code",
  "model_no",
  "model_number",
  "stock_code",
]);

const DETAIL_KEYS = new Set([
  "application_for_the_product",
  "application",
  "use_case",
  "product_description",
  "description",
  "specification",
  "spec",
  "details",
  "detail",
  "features",
]);

export type InventoryRowSummary = {
  displayText: string;
  itemCode: string;
  product: string;
  specification: string;
  priceFields: Array<{ key: string; value: string }>;
  keywords: string[];
  products: string[];
};

function normalizeWhitespace(text: string): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

export function normalizeHeaderKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isMeaningfulInventoryValue(value: unknown): boolean {
  const text = normalizeWhitespace(String(value ?? "")).replace(/[.,:;]+$/g, "").toLowerCase();
  return !PLACEHOLDER_VALUES.has(text);
}

export function isInventoryPriceKey(key: string): boolean {
  const low = normalizeHeaderKey(key);
  return Boolean(low) && (
    low.includes("price")
    || low.includes("cost")
    || ["retail", "wholesale", "dealer", "member", "cash", "offer", "promo", "warranty"].includes(low)
  );
}

export function isInventoryProductKey(key: string): boolean {
  return PRODUCT_KEYS.has(normalizeHeaderKey(key));
}

export function isInventoryCodeKey(key: string): boolean {
  return CODE_KEYS.has(normalizeHeaderKey(key));
}

export function isInventorySpecKey(key: string): boolean {
  return DETAIL_KEYS.has(normalizeHeaderKey(key));
}

function looksLikeInventoryCode(value: string): boolean {
  const text = normalizeWhitespace(value).toLowerCase();
  if (!text || !isMeaningfulInventoryValue(text)) return false;
  if (/^\d{3,}$/.test(text)) return true;
  return /^[a-z0-9][a-z0-9./-]{1,23}$/.test(text) && /\d/.test(text) && !text.includes(" ");
}

function looksLikePriceValue(value: string): boolean {
  const text = normalizeWhitespace(value);
  return isMeaningfulInventoryValue(text) && /\d/.test(text);
}

function extractKeywordsLite(text: string): string[] {
  const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  const stop = new Set(["this","that","with","from","have","been","were","will","would","could","should","their","there","which","about","into","more","other","some","such","than","then","these","they","through","very","your","also","each","just","like","make","when","only","where","what"]);
  const freq: Record<string, number> = {};
  for (const w of words) {
    if (stop.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([w]) => w);
}

function uniqueValues(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const clean = normalizeWhitespace(value);
    if (!clean || !isMeaningfulInventoryValue(clean) || out.includes(clean)) continue;
    out.push(clean);
  }
  return out;
}

function firstMatchingEntry(
  entries: Array<[string, string]>,
  predicate: (key: string) => boolean,
): string {
  for (const [key, value] of entries) {
    if (!predicate(key)) continue;
    if (!isMeaningfulInventoryValue(value)) continue;
    return normalizeWhitespace(value);
  }
  return "";
}

export function summarizeInventoryFields(fields: Record<string, string>): InventoryRowSummary {
  const entries = Object.entries(fields || {})
    .map(([key, value]) => [normalizeHeaderKey(key), normalizeWhitespace(value)] as [string, string])
    .filter(([, value]) => value && isMeaningfulInventoryValue(value));

  const product = firstMatchingEntry(entries, isInventoryProductKey);
  const explicitCode = firstMatchingEntry(entries, isInventoryCodeKey);
  const detailEntries = entries.filter(([key]) => isInventorySpecKey(key));
  const detailValues = uniqueValues(detailEntries.map(([, value]) => value));

  let itemCode = explicitCode;
  let productLabel = product;
  if (!itemCode && looksLikeInventoryCode(productLabel)) {
    itemCode = productLabel;
  }
  if (looksLikeInventoryCode(productLabel)) {
    const descriptive = detailValues.find((value) => !looksLikeInventoryCode(value));
    if (descriptive) {
      productLabel = descriptive;
    }
  }
  if (!productLabel) {
    productLabel = detailValues[0] || "";
  }

  const specificationValues = uniqueValues(
    detailValues.filter((value) => value !== productLabel),
  );
  const specification = specificationValues.slice(0, 2).join(" | ");

  const priceFields = entries
    .filter(([key, value]) => isInventoryPriceKey(key) && looksLikePriceValue(value))
    .map(([key, value]) => ({ key, value }));

  const displayParts: string[] = [];
  if (productLabel) displayParts.push(`product: ${productLabel}`);
  if (itemCode) displayParts.push(`item_code: ${itemCode}`);
  if (specification) displayParts.push(`specification: ${specification}`);

  const consumedKeys = new Set<string>();
  for (const [key, value] of entries) {
    if (value === productLabel && isInventoryProductKey(key)) {
      consumedKeys.add(`${key}:${value}`);
    }
    if (value === itemCode && isInventoryCodeKey(key)) {
      consumedKeys.add(`${key}:${value}`);
    }
  }
  for (const value of specificationValues) {
    for (const [key] of detailEntries) {
      consumedKeys.add(`${key}:${value}`);
    }
  }

  for (const field of priceFields) {
    displayParts.push(`${field.key}: ${field.value}`);
    consumedKeys.add(`${field.key}:${field.value}`);
  }

  for (const [key, value] of entries) {
    const signature = `${key}:${value}`;
    if (!value || consumedKeys.has(signature)) continue;
    displayParts.push(`${key}: ${value}`);
  }

  const displayText = displayParts.join(" | ");
  const keywordSeed = [
    itemCode,
    productLabel,
    specification,
    ...priceFields.map((row) => `${row.key} ${row.value}`),
    ...entries.map(([key]) => key),
  ].join(" ");

  const keywords = extractKeywordsLite(keywordSeed);
  const products = uniqueValues([productLabel, ...specificationValues]).slice(0, 6);
  return { displayText, itemCode, product: productLabel, specification, priceFields, keywords, products };
}

export function buildSpreadsheetRowText(fields: Record<string, string>): string {
  return summarizeInventoryFields(fields).displayText;
}

export function summarizeInventoryRow(row: SpreadsheetRow): InventoryRowSummary {
  return summarizeInventoryFields(row.fields || {});
}
