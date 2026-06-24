import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMessageFieldsFromMeta,
  isOrderEndAnchorMeta,
  isOrderEndAnchorMessage,
  isOrderEndMessageKind,
  readOrderIdFromMessageMeta,
  resolveMessageFields,
} from "./messageFields";

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
      sourceMeta: { orderId: "order-2" },
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
      sourceMeta: { kind: "order2_invoice", orderId: "order-1" },
    }),
    true,
  );
  assert.equal(isOrderEndAnchorMeta({ source: "portal_manual_send" }), false);
});

test("resolveMessageFields prefers typed columns over meta", () => {
  const fields = resolveMessageFields({
    direction: "inbound",
    textBody: "o2:delivery",
    linkedOrderId: "order-typed",
    messageKind: "order2_tracking_link",
    replyId: "o2:delivery",
    replyTitle: "Delivery",
    meta: {
      orderAnchor: { orderId: "order-meta", kind: "order2_invoice" },
      interactive: { reply_id: "o2:pickup", reply_title: "Pickup" },
    },
  });

  assert.equal(fields.linkedOrderId, "order-typed");
  assert.equal(fields.messageKind, "order2_tracking_link");
  assert.equal(fields.replyId, "o2:delivery");
  assert.equal(fields.replyTitle, "Delivery");
});

test("extractMessageFieldsFromMeta backfills interactive replies from text body", () => {
  const fields = extractMessageFieldsFromMeta(
    {},
    { direction: "inbound", textBody: "o2:checkout" },
  );
  assert.equal(fields.replyId, "o2:checkout");
  assert.equal(fields.messageKind, "interactive_reply");
});

test("isOrderEndAnchorMessage uses columns first then meta fallback", () => {
  assert.equal(
    isOrderEndAnchorMessage({
      messageKind: "order2_payment_pending",
      meta: { source: "portal_manual_send" },
    }),
    true,
  );
  assert.equal(
    isOrderEndAnchorMessage({
      meta: { orderAnchor: { milestone: "order_end", orderId: "order-1" } },
    }),
    true,
  );
  assert.equal(isOrderEndMessageKind("order2_invoice"), true);
  assert.equal(isOrderEndMessageKind("interactive_reply"), false);
});