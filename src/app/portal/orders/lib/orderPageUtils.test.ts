import test from "node:test";
import assert from "node:assert/strict";
import {
  formatMoney,
  formatOrderItems,
  getDeliveryHint,
  getDeliverySummary,
  isPickupOrder,
  numericAmount,
  resolveOrderSnapshotFields,
  type OrderRow,
} from "@/app/portal/orders/lib/orderPageUtils";

function makeOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "ord-1",
    status: "paid",
    ...overrides,
  };
}

test("pickup orders are detected from stored pickup markers", () => {
  const order = makeOrder({
    shippingAddress: "Pickup",
    deliveryArea: "Pickup",
    deliveryNotes: "Customer pickup. [pickup]",
  });

  assert.equal(isPickupOrder(order), true);
});

test("pickup orders show pickup summary and recipient hint", () => {
  const order = makeOrder({
    shippingAddress: "Pickup",
    deliveryArea: "Pickup",
    deliveryNotes: "Customer pickup. [pickup]",
    recipientName: "Namith Nimlaka",
    recipientPhone: "94770000000",
  });

  assert.equal(getDeliverySummary(order), "Pickup");
  assert.equal(getDeliveryHint(order), "Namith Nimlaka • 94770000000");
});

test("order item summaries read top-level bot snapshots", () => {
  const snapshot = {
    sourceBotType: "ORDER2",
    priced_line_items: [
      { item: "Bulb Camara", quantity: 3, unit_price: "1,990", line_total: "5,970" },
    ],
  };

  assert.equal(formatOrderItems(snapshot), "Bulb Camara x 3");
  assert.deepEqual(resolveOrderSnapshotFields(snapshot).priced_line_items, snapshot.priced_line_items);
});

test("order money helpers parse comma thousands", () => {
  assert.equal(numericAmount("5,970"), 5970);
  assert.equal(formatMoney("LKR", "5,970"), "LKR 5970.00");
});
