import assert from "node:assert/strict";
import test from "node:test";
import { isOrderEndAnchorMeta, readOrderIdFromMessageMeta } from "./orderMessageAnchor";

test("readOrderIdFromMessageMeta prefers orderAnchor then sourceMeta", () => {
  assert.equal(
    readOrderIdFromMessageMeta({
      orderAnchor: { orderId: "order-1", milestone: "order_end" },
      sourceMeta: { orderId: "order-2" },
    }),
    "order-1",
  );
  assert.equal(
    readOrderIdFromMessageMeta({
      sourceMeta: { orderId: "order-2", kind: "order2_tracking_link" },
    }),
    "order-2",
  );
});

test("isOrderEndAnchorMeta recognizes milestone and source kinds", () => {
  assert.equal(
    isOrderEndAnchorMeta({
      orderAnchor: { orderId: "order-1", milestone: "order_end" },
    }),
    true,
  );
  assert.equal(
    isOrderEndAnchorMeta({
      sourceMeta: { kind: "order2_payment_pending", orderId: "order-1" },
    }),
    true,
  );
  assert.equal(isOrderEndAnchorMeta({ source: "portal_manual_send" }), false);
});