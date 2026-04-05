import test from "node:test";
import assert from "node:assert/strict";

import { buildSpreadsheetRowText, normalizeHeaderKey, summarizeInventoryFields } from "@/server/rag/inventoryFields";

test("normalizeHeaderKey handles mixed spreadsheet headers", () => {
  assert.equal(normalizeHeaderKey("PRODUCT NAME"), "product_name");
  assert.equal(normalizeHeaderKey("No Waranty Price"), "no_waranty_price");
  assert.equal(normalizeHeaderKey("Member Price"), "member_price");
});

test("summarizeInventoryFields prefers descriptive product name and keeps code", () => {
  const out = summarizeInventoryFields({
    PRODUCT_NAME: "1026B",
    APPLICATION_FOR_THE_PRODUCT: "4G Camera",
    PRODUCT_DESCRIPTION: "4MP full-color camera with two-way audio",
    MEMBER_PRICE: "5000",
  } as Record<string, string>);

  assert.equal(out.product, "4G Camera");
  assert.equal(out.itemCode, "1026B");
  assert.match(out.specification, /4MP full-color camera/i);
  assert.deepEqual(out.priceFields, [{ key: "member_price", value: "5000" }]);
});

test("buildSpreadsheetRowText filters invalid false price placeholders", () => {
  const text = buildSpreadsheetRowText({
    PRODUCT_NAME: "4G Camera 4MP",
    PRODUCT_CODE: "1026B",
    PRODUCT_DESCRIPTION: "full-color camera with two-way audio",
    RETAIL_PRICE: "FALSE",
    MEMBER_PRICE: "5000",
  } as Record<string, string>);

  assert.match(text, /product: 4G Camera 4MP/i);
  assert.match(text, /item_code: 1026B/i);
  assert.match(text, /member_price: 5000/i);
  assert.doesNotMatch(text, /retail_price: FALSE/i);
});
