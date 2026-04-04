import test from "node:test";
import assert from "node:assert/strict";
import { computePaymentBalance, resolvePaymentProofAssessment } from "@/server/services/paymentProofSupport";

test("computePaymentBalance treats overpayment as sufficient", () => {
  const out = computePaymentBalance("14950.00", "15000.00");
  assert.equal(out.amountSufficient, true);
  assert.equal(out.state, "excess");
  assert.equal(out.delta, "50.00");
});

test("computePaymentBalance marks underpayment as owed", () => {
  const out = computePaymentBalance("14950.00", "14000.00");
  assert.equal(out.amountSufficient, false);
  assert.equal(out.state, "owed");
  assert.equal(out.delta, "-950.00");
});

test("resolvePaymentProofAssessment upgrades sufficient rounded payment to passed", () => {
  const out = resolvePaymentProofAssessment({
    analysis: {
      status: "needs_review",
      summary: "Analyzer extracted the slip details.",
      checks: {
        amountMatch: false,
        dateFormatValid: true,
        dateNotFuture: true,
        proofPresent: true,
      },
    },
    expectedAmount: "14999.00",
    paidAmount: "15000.00",
    currency: "LKR",
  });
  assert.equal(out.aiCheckStatus, "passed");
  assert.match(out.aiCheckNotes, /covers the order total/i);
});

test("resolvePaymentProofAssessment keeps underpayment in review", () => {
  const out = resolvePaymentProofAssessment({
    analysis: {
      status: "passed",
      summary: "Analyzer extracted the slip details.",
      checks: {
        amountMatch: true,
        dateFormatValid: true,
        dateNotFuture: true,
        proofPresent: true,
      },
    },
    expectedAmount: "14950.00",
    paidAmount: "14900.00",
    currency: "LKR",
  });
  assert.equal(out.aiCheckStatus, "needs_review");
  assert.match(out.aiCheckNotes, /short by LKR 50.00/i);
});
