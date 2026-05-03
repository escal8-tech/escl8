import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOrderTrackingUrl,
  createOrderTrackingToken,
  parseOrderTrackingToken,
} from "@/server/services/orderTracking";

test("order tracking tokens round-trip without exposing raw ids in the path", () => {
  const previous = process.env.ORDER_TRACKING_SECRET;
  const previousBase = process.env.ORDER_TRACKING_BASE_URL;
  process.env.ORDER_TRACKING_SECRET = "test-order-tracking-secret";
  delete process.env.ORDER_TRACKING_BASE_URL;
  try {
    const token = createOrderTrackingToken({ businessId: "business-1", orderId: "order-1" });
    assert.deepEqual(parseOrderTrackingToken(token), { businessId: "", orderId: "", publicReference: "ORDER-1" });
    assert.equal(token.includes("business-1"), false);
    assert.equal(token.length < 25, true);
    assert.equal(parseOrderTrackingToken("!!!"), null);

    const url = buildOrderTrackingUrl({
      businessId: "business-1",
      orderId: "order-1",
      fallbackOrigin: "http://0.0.0.0:3000",
    });
    assert.match(url, /^https:\/\/concierge\.escal8\.tech\/track\/orders\//);
  } finally {
    if (previous === undefined) delete process.env.ORDER_TRACKING_SECRET;
    else process.env.ORDER_TRACKING_SECRET = previous;
    if (previousBase === undefined) delete process.env.ORDER_TRACKING_BASE_URL;
    else process.env.ORDER_TRACKING_BASE_URL = previousBase;
  }
});
