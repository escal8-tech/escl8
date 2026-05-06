import test from "node:test";
import assert from "node:assert/strict";

import { deriveInventoryProductFromFields, parseInventoryAmount } from "@/server/inventory/stockMapping";
import type { BusinessStockSettings } from "@/lib/stock-settings";

test("deriveInventoryProductFromFields infers new upload columns while preserving saved mappings", () => {
  const oldSettings: BusinessStockSettings = {
    schemaVersion: 1,
    columnMapping: [
      { key: "product_name_item_name", label: "Product Name Item Name", role: "name" },
      { key: "retail_price", label: "Retail Price", role: "price", priceLabel: "Retail Price" },
      { key: "no_waranty_price", label: "No Waranty Price", role: "price", priceLabel: "No Waranty Price" },
      { key: "description", label: "Description", role: "description" },
    ],
  };

  const product = deriveInventoryProductFromFields(
    {
      item_code: "1012",
      product: "Bulb Camara",
      apps_others: "V380 Pro App",
      specification: "Use Only Indoor",
      retail_price: "1,990/=",
      no_waranty_price: "1,900/=",
      product_links_include_picture: "https://zoomtech.lk/product/2mp-e27-bulb-camera/",
    },
    oldSettings,
  );

  assert.equal(product.itemCode, "1012");
  assert.equal(product.name, "Bulb Camara");
  assert.match(product.specification ?? "", /Use Only Indoor/);
  assert.deepEqual(product.priceFields.map((field) => [field.sourceKey, field.valueText, field.amount]), [
    ["retail_price", "1,990/=", "1990.00"],
    ["no_waranty_price", "1,900/=", "1900.00"],
  ]);
  assert.equal(product.mediaType, "image");
});

test("parseInventoryAmount rejects placeholders and zero prices", () => {
  assert.equal(parseInventoryAmount("1,900/="), "1900.00");
  assert.equal(parseInventoryAmount("0"), null);
  assert.equal(parseInventoryAmount("-"), null);
  assert.equal(parseInventoryAmount("N/A"), null);
});
