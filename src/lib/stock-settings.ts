export const STOCK_COLUMN_ROLES = [
  "ignore",
  "name",
  "item_code",
  "description",
  "category",
  "brand",
  "model",
  "image",
  "document",
  "quantity",
  "price",
] as const;

export type StockColumnRole = (typeof STOCK_COLUMN_ROLES)[number];

export type StockColumnMappingEntry = {
  key: string;
  label: string;
  role: StockColumnRole;
  priceLabel?: string;
};

export type BusinessStockSettings = {
  schemaVersion: 1;
  columnMapping: StockColumnMappingEntry[];
  updatedAt?: string;
};

export type StockMappingStatus = {
  isMapped: boolean;
  isReady: boolean;
  hasName: boolean;
  priceCount: number;
  hasQuantity: boolean;
  hasImage: boolean;
  hasDocument: boolean;
  mappedAt: string | null;
};

export const DEFAULT_STOCK_SETTINGS: BusinessStockSettings = {
  schemaVersion: 1,
  columnMapping: [],
};

const ROLE_SET = new Set<string>(STOCK_COLUMN_ROLES);

export function normalizeStockColumnKey(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function friendlyStockColumnLabel(raw: unknown): string {
  const text = String(raw ?? "").trim();
  const key = normalizeStockColumnKey(text);
  const source = text || key;
  return source
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())
    || "Column";
}

export function inferStockColumnRole(rawKey: unknown): StockColumnRole {
  const key = normalizeStockColumnKey(rawKey);
  if (!key) return "ignore";

  if ([
    "product_name",
    "product_name_item_name",
    "product_item_name",
    "item_name_product_name",
    "product_title",
    "item_name",
    "item_title",
    "service_name",
    "menu_item",
    "name",
    "product",
    "item",
    "title",
  ].includes(key)) {
    return "name";
  }

  if ([
    "item_code",
    "product_code",
    "sku",
    "code",
    "model_code",
    "stock_code",
    "barcode",
  ].includes(key)) {
    return "item_code";
  }

  if (["brand", "make", "manufacturer"].includes(key)) return "brand";
  if (["model", "model_name", "model_number", "model_no"].includes(key)) return "model";
  if (["category", "type", "group", "department"].includes(key)) return "category";

  if (
    key.includes("description")
    || key.includes("specification")
    || key === "spec"
    || key.includes("detail")
    || key.includes("feature")
    || key.includes("application")
  ) {
    return "description";
  }

  if (
    key.includes("quantity")
    || key === "qty"
    || key.endsWith("_qty")
    || key.includes("stock_on_hand")
    || key.includes("available_stock")
    || key.includes("stock_qty")
    || key.includes("inventory_count")
  ) {
    return "quantity";
  }

  if (
    key.includes("image")
    || key.includes("photo")
    || key.includes("picture")
    || key.includes("thumbnail")
    || key === "product_link_for_images"
  ) {
    return "image";
  }

  if (
    key.includes("document")
    || key.includes("brochure")
    || key.includes("manual")
    || key === "pdf"
    || key.endsWith("_pdf")
  ) {
    return "document";
  }

  if (
    key.includes("price")
    || key.includes("cost")
    || ["retail", "wholesale", "dealer", "member", "cash", "offer", "promo", "warranty"].includes(key)
  ) {
    return "price";
  }

  return "ignore";
}

export function normalizeStockColumnMappingEntry(raw: unknown): StockColumnMappingEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const key = normalizeStockColumnKey(data.key);
  if (!key) return null;
  const rawRole = String(data.role ?? "").trim();
  const role = ROLE_SET.has(rawRole) ? (rawRole as StockColumnRole) : inferStockColumnRole(key);
  const label = String(data.label ?? "").trim() || friendlyStockColumnLabel(key);
  const priceLabel = String(data.priceLabel ?? "").trim();
  return {
    key,
    label,
    role,
    ...(priceLabel ? { priceLabel } : {}),
  };
}

export function normalizeStockSettings(raw: unknown): BusinessStockSettings {
  const root = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const stock = root.stock && typeof root.stock === "object" && !Array.isArray(root.stock)
    ? (root.stock as Record<string, unknown>)
    : root;

  const rawMapping = Array.isArray(stock.columnMapping) ? stock.columnMapping : [];
  const seen = new Set<string>();
  const columnMapping: StockColumnMappingEntry[] = [];
  for (const item of rawMapping) {
    const normalized = normalizeStockColumnMappingEntry(item);
    if (!normalized || seen.has(normalized.key)) continue;
    seen.add(normalized.key);
    columnMapping.push(normalized);
  }

  const updatedAt = typeof stock.updatedAt === "string" ? stock.updatedAt : undefined;
  return { schemaVersion: 1, columnMapping, ...(updatedAt ? { updatedAt } : {}) };
}

export function mergeStockSettings(
  settings: Record<string, unknown> | null | undefined,
  nextStock: BusinessStockSettings,
): Record<string, unknown> {
  return {
    ...(settings ?? {}),
    stock: {
      schemaVersion: 1,
      columnMapping: nextStock.columnMapping,
      updatedAt: nextStock.updatedAt ?? new Date().toISOString(),
    },
  };
}

export function getStockMappingStatus(settings: BusinessStockSettings): StockMappingStatus {
  const active = settings.columnMapping.filter((entry) => entry.role !== "ignore");
  const priceCount = active.filter((entry) => entry.role === "price").length;
  const hasName = active.some((entry) => entry.role === "name");
  return {
    isMapped: active.length > 0,
    isReady: hasName && priceCount > 0,
    hasName,
    priceCount,
    hasQuantity: active.some((entry) => entry.role === "quantity"),
    hasImage: active.some((entry) => entry.role === "image"),
    hasDocument: active.some((entry) => entry.role === "document"),
    mappedAt: settings.updatedAt ?? null,
  };
}
