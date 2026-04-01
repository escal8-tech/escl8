import test from "node:test";
import assert from "node:assert/strict";
import {
  assertTicketAwaitingOrderDecision,
  extractCustomerEmail,
  normalizeKey,
  sanitizeTicketFields,
  validateTicketOrderFlow,
} from "@/server/services/ticketWorkflowSupport";

test("normalizeKey strips punctuation and casing", () => {
  assert.equal(normalizeKey(" Customer Email "), "customeremail");
});

test("extractCustomerEmail reads common email field names", () => {
  assert.equal(extractCustomerEmail({ customerEmail: "TEST@Example.com " }), "test@example.com");
});

test("sanitizeTicketFields rejects overly large nested payloads", () => {
  const huge = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [`k${i}`, i]));
  assert.throws(() => sanitizeTicketFields(huge), /too many properties/i);
});

test("validateTicketOrderFlow only allows ordercreation tickets", () => {
  assert.throws(
    () => validateTicketOrderFlow({ ticketTypeKey: "complaint", ticketFlowEnabled: true }),
    /Only order creation tickets/i,
  );
  assert.doesNotThrow(() =>
    validateTicketOrderFlow({ ticketTypeKey: "ordercreation", ticketFlowEnabled: true }),
  );
});

test("assertTicketAwaitingOrderDecision blocks already resolved tickets", () => {
  assert.throws(
    () => assertTicketAwaitingOrderDecision({ status: "resolved", outcome: "pending" }),
    /Only unresolved/i,
  );
  assert.doesNotThrow(() =>
    assertTicketAwaitingOrderDecision({ status: "open", outcome: "pending" }),
  );
});
