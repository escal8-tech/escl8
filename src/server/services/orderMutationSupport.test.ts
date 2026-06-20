import test from "node:test";
import assert from "node:assert/strict";
import { isStaffManualOrder, resolveFulfillmentPrefill } from "./orderMutationSupport";

test("isStaffManualOrder identifies manual staff orders", () => {
  // Case 1: source is staff_manual
  assert.equal(isStaffManualOrder({ source: "staff_manual" }), true);
  assert.equal(isStaffManualOrder({ source: "  STAFF_MANUAL  " }), true);

  // Case 2: manual_order flag in snapshot
  assert.equal(isStaffManualOrder({
    ticketSnapshot: { fields: { manual_order: true } }
  }), true);

  // Case 3: suppress_customer_notifications flag in snapshot
  assert.equal(isStaffManualOrder({
    ticketSnapshot: { fields: { suppress_customer_notifications: true } }
  }), true);

  // Case 4: negative cases
  assert.equal(isStaffManualOrder({ source: "whatsapp" }), false);
  assert.equal(isStaffManualOrder({ ticketSnapshot: { fields: { manual_order: false } } }), false);
  assert.equal(isStaffManualOrder({}), false);
});

test("resolveFulfillmentPrefill maps order fields correctly", () => {
  const order = {
    recipientName: "John Doe",
    recipientPhone: "123456",
    shippingAddress: "123 Main St",
    deliveryArea: "Downtown",
    customerName: "Jane Smith",
    customerPhone: "654321",
  };

  const prefill = resolveFulfillmentPrefill(order);
  assert.equal(prefill.recipientName, "John Doe");
  assert.equal(prefill.recipientPhone, "123456");
  assert.equal(prefill.shippingAddress, "123 Main St");
  assert.equal(prefill.deliveryArea, "Downtown");

  // Test fallbacks
  const fallbackOrder = {
    customerName: "Jane Smith",
    customerPhone: "654321",
    shippingAddress: "456 Side St",
  };
  const prefillFallback = resolveFulfillmentPrefill(fallbackOrder);
  assert.equal(prefillFallback.recipientName, "Jane Smith");
  assert.equal(prefillFallback.recipientPhone, "654321");
  assert.equal(prefillFallback.shippingAddress, "456 Side St");
  assert.equal(prefillFallback.deliveryArea, "456 Side St"); // deliveryArea falls back to shippingAddress
});
