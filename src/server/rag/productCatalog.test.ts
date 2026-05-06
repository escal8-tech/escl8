import test from "node:test";
import assert from "node:assert/strict";
import { sourceRowKeyForSpreadsheetRow } from "@/server/rag/productCatalog";
import type { SpreadsheetRow } from "@/server/rag/extractText";

function row(rowNumber: number, fields: Record<string, string>): SpreadsheetRow {
  return {
    sheetName: "Sheet1",
    rowNumber,
    fields,
    text: Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join(" | "),
  };
}

test("inventory source row key stays stable when an item code moves rows or files", () => {
  const first = sourceRowKeyForSpreadsheetRow({
    source: "old-upload.xlsx",
    row: row(5, { item_code: "CAM-001", product: "4G Camera", retail_price: "7500" }),
  });
  const second = sourceRowKeyForSpreadsheetRow({
    source: "new-upload.xlsx",
    row: row(88, { item_code: "CAM-001", product: "4G Camera Pro", retail_price: "7600" }),
  });

  assert.equal(first, second);
  assert.match(first, /^stock:v2:item-code:/);
});

test("inventory source row key can disambiguate duplicate item identities", () => {
  const base = sourceRowKeyForSpreadsheetRow({
    source: "stock.xlsx",
    row: row(5, { item_code: "CAM-001", product: "4G Camera" }),
  });
  const duplicate = sourceRowKeyForSpreadsheetRow({
    source: "stock.xlsx",
    row: row(6, { item_code: "CAM-001", product: "4G Camera" }),
    duplicateIndex: 2,
  });

  assert.notEqual(base, duplicate);
  assert.equal(duplicate, `${base}:2`);
});

test("inventory source row key falls back to name and specification when item code is absent", () => {
  const first = sourceRowKeyForSpreadsheetRow({
    source: "stock-a.xlsx",
    row: row(1, { product: "Bulb Camera", specification: "WiFi indoor full color", retail_price: "1990" }),
  });
  const second = sourceRowKeyForSpreadsheetRow({
    source: "stock-b.xlsx",
    row: row(100, { product: "Bulb Camera", specification: "WiFi indoor full color", retail_price: "2050" }),
  });

  assert.equal(first, second);
  assert.match(first, /^stock:v2:name-spec:/);
});
