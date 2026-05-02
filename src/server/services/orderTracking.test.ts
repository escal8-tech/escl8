import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOrderTrackingUrl,
  createOrderTrackingToken,
  parseOrderTrackingToken,
} from "@/server/services/orderTracking";

test("order tracking tokens round-trip without exposing raw ids in the path", () => {
  const previous = process.env.ORDER_TRACKING_SECRET;
  process.env.ORDER_TRACKING_SECRET = "test-order-tracking-secret";
  try {
    const token = createOrderTrackingToken({ businessId: "business-1", orderId: "order-1" });
    assert.deepEqual(parseOrderTrackingToken(token), { businessId: "business-1", orderId: "order-1" });
    assert.equal(token.includes("business-1"), false);
    assert.equal(parseOrderTrackingToken(`${token.slice(0, -1)}x`), null);

    const url = buildOrderTrackingUrl({
      businessId: "business-1",
      orderId: "order-1",
      fallbackOrigin: "https://concierge.escal8.tech/",
    });
    assert.match(url, /^https:\/\/concierge\.escal8\.tech\/track\/orders\//);
  } finally {
    if (previous === undefined) delete process.env.ORDER_TRACKING_SECRET;
    else process.env.ORDER_TRACKING_SECRET = previous;
  }
});
