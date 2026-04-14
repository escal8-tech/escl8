import test from "node:test";
import assert from "node:assert/strict";
import { buildOutboxAssistantObservation } from "@/server/services/messageOutbox";

test("buildOutboxAssistantObservation maps ticket approval messages to paymentstatus", () => {
  const observation = buildOutboxAssistantObservation({
    source: "order_ticket_approval",
    message: {
      type: "text",
      text: "Your order has been approved. Please complete the payment.",
    },
  });

  assert.deepEqual(observation, {
    text: "Your order has been approved. Please complete the payment.",
    intent: "paymentstatus",
  });
});

test("buildOutboxAssistantObservation maps ticket denial messages to orderstatus", () => {
  const observation = buildOutboxAssistantObservation({
    source: "order_ticket_denied",
    message: {
      type: "text",
      text: "Your order request has been cancelled.",
    },
  });

  assert.deepEqual(observation, {
    text: "Your order request has been cancelled.",
    intent: "orderstatus",
  });
});

test("buildOutboxAssistantObservation maps manual payment detail sends to paymentstatus", () => {
  const observation = buildOutboxAssistantObservation({
    source: "order_payment_details_manual_send",
    message: {
      type: "text",
      text: "Please complete the payment and send the slip here.",
    },
  });

  assert.deepEqual(observation, {
    text: "Please complete the payment and send the slip here.",
    intent: "paymentstatus",
  });
});
