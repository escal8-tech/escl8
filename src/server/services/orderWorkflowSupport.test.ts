import test from "node:test";
import assert from "node:assert/strict";
import {
  canResendPaymentDetails,
  canReopenPaidOrderForPaymentReview,
  resolveOrderLedgerAmount,
  resolveRefundAmount,
  nextFulfillmentTimestamps,
  assertPaymentSetupEditable,
  assertOrderAllowsFulfillmentUpdates,
  maskPhoneNumber
} from "./orderWorkflowSupport";

test("canResendPaymentDetails validation", () => {
  // Must be bank_qr
  assert.equal(canResendPaymentDetails({ paymentMethod: "cod", status: "awaiting_payment" }), false);

  // Valid status
  assert.equal(canResendPaymentDetails({ paymentMethod: "bank_qr", status: "awaiting_payment" }), true);
  assert.equal(canResendPaymentDetails({ paymentMethod: "bank_qr", status: "payment_submitted" }), true);

  // Approved status requires all delivery fields
  assert.equal(canResendPaymentDetails({
    paymentMethod: "bank_qr",
    status: "approved",
    recipientName: "John",
    recipientPhone: "123",
    shippingAddress: "Street"
  }), true);

  assert.equal(canResendPaymentDetails({
    paymentMethod: "bank_qr",
    status: "approved",
    recipientName: "John"
    // missing phone and address
  }), false);
});

test("canReopenPaidOrderForPaymentReview restriction", () => {
  assert.equal(canReopenPaidOrderForPaymentReview({ status: "paid", fulfillmentStatus: "queued" }), true);
  assert.equal(canReopenPaidOrderForPaymentReview({ status: "paid", fulfillmentStatus: "dispatched" }), false);
  assert.equal(canReopenPaidOrderForPaymentReview({ status: "approved", fulfillmentStatus: "queued" }), false);
});

test("resolveOrderLedgerAmount calculation", () => {
  assert.equal(resolveOrderLedgerAmount({ paidAmount: "100.50" }), 100.5);
  assert.equal(resolveOrderLedgerAmount({ refundAmount: "50" }), 50);
  assert.equal(resolveOrderLedgerAmount({ expectedAmount: "200" }), 200);
  assert.equal(resolveOrderLedgerAmount({}, { paidAmount: "75" }), 75);
});

test("resolveRefundAmount logic", () => {
  const order = { paidAmount: "100" };
  assert.equal(resolveRefundAmount("80", order), "80.00");
  assert.equal(resolveRefundAmount(undefined, order), "100.00");
  assert.equal(resolveRefundAmount("0", order), "100.00");
});

test("nextFulfillmentTimestamps stamps correctly", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const existing = {};

  const result = nextFulfillmentTimestamps({
    currentStatus: "queued",
    nextStatus: "packed",
    now,
    existing
  });

  assert.equal(result.packedAt?.toISOString(), now.toISOString());
  assert.equal(result.fulfillmentUpdatedAt?.toISOString(), now.toISOString());
});

test("assertPaymentSetupEditable blocks if paid", () => {
  assert.doesNotThrow(() => assertPaymentSetupEditable({ status: "awaiting_payment" }));
  assert.throws(() => assertPaymentSetupEditable({ status: "paid" }), /Payment details can only be edited before/);
});

test("assertOrderAllowsFulfillmentUpdates blocks if not paid", () => {
  assert.doesNotThrow(() => assertOrderAllowsFulfillmentUpdates({ status: "paid" }));
  assert.throws(() => assertOrderAllowsFulfillmentUpdates({ status: "approved" }), /Only paid or refund-tracked orders/);
});

test("maskPhoneNumber implementation in orderWorkflowSupport", () => {
  // Note: orderWorkflowSupport has a different maskPhoneNumber implementation (slices 2 instead of 0)
  // sanitizePhoneDigits strips the '+'
  assert.equal(maskPhoneNumber("+94771234567"), "94*******67");
});
