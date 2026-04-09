import test from "node:test";
import assert from "node:assert/strict";
import {
  assertOrderAllowsFulfillmentUpdates,
  assertPaymentReviewAllowed,
  assertPaymentSetupEditable,
  nextFulfillmentTimestamps,
  resolveRefundAmount,
} from "@/server/services/orderWorkflowSupport";

test("resolveRefundAmount prefers valid explicit value", () => {
  assert.equal(
    resolveRefundAmount("125.5", { paidAmount: "200.00", expectedAmount: "100.00" }),
    "125.50",
  );
});

test("resolveRefundAmount falls back to ledger amount", () => {
  assert.equal(
    resolveRefundAmount(undefined, { paidAmount: null, expectedAmount: "310.00", refundAmount: null }),
    "310.00",
  );
});

test("bank qr payments can still be approved manually", () => {
  assert.doesNotThrow(() =>
    assertPaymentReviewAllowed({
      orderRow: { paymentMethod: "bank_qr" },
      paymentRow: { aiCheckStatus: "invalid" },
      action: "approve",
    }),
  );
});

test("manual payments can still be approved", () => {
  assert.doesNotThrow(() =>
    assertPaymentReviewAllowed({
      orderRow: { paymentMethod: "manual" },
      paymentRow: { aiCheckStatus: "manual_review" },
      action: "approve",
    }),
  );
});

test("payment setup editing is blocked after payment is finalized", () => {
  assert.throws(() => assertPaymentSetupEditable({ status: "paid" }), /before the payment is approved/i);
  assert.doesNotThrow(() => assertPaymentSetupEditable({ status: "payment_submitted" }));
});

test("fulfillment updates are restricted to paid and refund-tracked orders", () => {
  assert.throws(() => assertOrderAllowsFulfillmentUpdates({ status: "awaiting_payment" }), /Only paid/i);
  assert.doesNotThrow(() => assertOrderAllowsFulfillmentUpdates({ status: "refund_pending" }));
});

test("nextFulfillmentTimestamps stamps delivered when status changes", () => {
  const now = new Date("2026-04-01T12:00:00.000Z");
  const result = nextFulfillmentTimestamps({
    currentStatus: "out_for_delivery",
    nextStatus: "delivered",
    now,
    existing: {},
  });
  assert.equal(result.deliveredAt?.toISOString(), now.toISOString());
  assert.equal(result.fulfillmentUpdatedAt?.toISOString(), now.toISOString());
});
