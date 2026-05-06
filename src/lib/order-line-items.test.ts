import test from "node:test";
import assert from "node:assert/strict";

import { isDeliveryLineItemName } from "@/lib/order-line-items";

test("delivery line item detection accepts free and fee labels", () => {
  assert.equal(isDeliveryLineItemName("Delivery (free)"), true);
  assert.equal(isDeliveryLineItemName("Delivery fee"), true);
  assert.equal(isDeliveryLineItemName("Shipping - free"), true);
  assert.equal(isDeliveryLineItemName("Free courier"), true);
  assert.equal(isDeliveryLineItemName("Cash on delivery"), false);
  assert.equal(isDeliveryLineItemName("Delivery camera"), false);
});
