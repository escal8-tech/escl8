import test from "node:test";
import assert from "node:assert/strict";
import {
  friendlyStockColumnLabel,
  inferStockColumnRole,
  normalizeStockColumnKey,
  normalizeStockSettings
} from "@/lib/stock-settings";

test("normalizeStockColumnKey handles various inputs", () => {
  assert.equal(normalizeStockColumnKey("Product Name"), "product_name");
  assert.equal(normalizeStockColumnKey("  SKU#  "), "sku");
  assert.equal(normalizeStockColumnKey("Price ($)"), "price");
  assert.equal(normalizeStockColumnKey(null), "");
});

test("friendlyStockColumnLabel generates clean labels", () => {
  assert.equal(friendlyStockColumnLabel("product_name"), "Product Name");
  assert.equal(friendlyStockColumnLabel("itemCode"), "ItemCode");
  assert.equal(friendlyStockColumnLabel(""), "Column");
});

test("inferStockColumnRole detects roles from keys", () => {
  assert.equal(inferStockColumnRole("product_title"), "name");
  assert.equal(inferStockColumnRole("sku"), "item_code");
  assert.equal(inferStockColumnRole("price_retail"), "price");
  assert.equal(inferStockColumnRole("quantity_on_hand"), "quantity");
  assert.equal(inferStockColumnRole("unknown_field"), "ignore");
});

test("normalizeStockSettings deduplicates and cleans mapping", () => {
  const raw = {
    stock: {
      columnMapping: [
        { key: "Name", role: "name" },
        { key: "Name", role: "ignore" }, // Duplicate key
        { key: "SKU", role: "item_code" },
      ]
    }
  };
  const normalized = normalizeStockSettings(raw);
  assert.equal(normalized.columnMapping.length, 2);
  assert.equal(normalized.columnMapping[0]?.key, "name");
  assert.equal(normalized.columnMapping[1]?.key, "sku");
});
