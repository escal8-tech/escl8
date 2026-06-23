import test from "node:test";
import assert from "node:assert/strict";
import type { BotSendMessage } from "@/server/services/botApi";
import {
  buildPaymentReviewMessages,
  buildPaymentReviewEmail,
  buildRefundStatusMessages,
} from "./orderNotificationSupport";

function textBody(message: BotSendMessage): string {
  assert.equal(message.type, "text");
  return message.text;
}

test("buildPaymentReviewMessages returns rejection message", () => {
  const messages = buildPaymentReviewMessages({
    action: "reject",
    orderId: "order-123",
    paymentReference: "REF123",
    currency: "LKR",
    notes: "Proof was blurry",
  });

  assert.equal(messages.length, 1);
  const body = textBody(messages[0]);
  assert.match(body, /could not confirm the payment for order number REF123/);
  assert.match(body, /Reason: Proof was blurry/);
});

test("buildPaymentReviewEmail returns correct email content", () => {
  const email = buildPaymentReviewEmail({
    action: "reject",
    orderId: "order-123",
    paymentReference: "REF123",
    currency: "LKR",
    notes: "Insufficient funds",
  });

  assert.equal(email.subject, "Payment needs attention: REF123");
  assert.match(email.text, /Insufficient funds/);
  assert.match(email.html, /<div/);
});

test("buildRefundStatusMessages for pending refund", () => {
  const messages = buildRefundStatusMessages({
    action: "mark_pending",
    orderId: "order-123",
    paymentReference: "REF123",
    currency: "LKR",
    reason: "Customer changed mind",
  });

  assert.equal(messages.length, 1);
  const body = textBody(messages[0]);
  assert.match(body, /started reviewing your refund for order number REF123/);
  assert.match(body, /Reason noted: Customer changed mind/);
});

test("buildRefundStatusMessages for completed refund", () => {
  const messages = buildRefundStatusMessages({
    action: "mark_refunded",
    orderId: "order-123",
    paymentReference: "REF123",
    refundAmount: "1500.00",
    currency: "LKR",
  });

  assert.equal(messages.length, 1);
  const body = textBody(messages[0]);
  assert.match(body, /refund for order number REF123 has been completed/);
  assert.match(body, /Refunded amount: LKR 1500.00/);
});

test("buildRefundStatusMessages for cancelled refund", () => {
  const messages = buildRefundStatusMessages({
    action: "cancel",
    orderId: "order-123",
    paymentReference: "REF123",
    currency: "LKR",
  });

  assert.equal(messages.length, 1);
  const body = textBody(messages[0]);
  assert.match(body, /refund request for order number REF123 has been cancelled/);
});
