import test from "node:test";
import assert from "node:assert/strict";
import { getDeliveryHint, getDeliverySummary, isPickupOrder, type OrderRow } from "@/app/portal/orders/lib/orderPageUtils";

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

