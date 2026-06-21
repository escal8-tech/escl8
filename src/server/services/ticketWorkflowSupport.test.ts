import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeKey,
  getSlaDueAt,
  sanitizeTicketFields,
  validateTicketOrderFlow,
  assertTicketAwaitingOrderDecision,
  coalesceText,
  maskPhoneNumber
} from "./ticketWorkflowSupport";

test("normalizeKey strips punctuation and casing", () => {
  assert.equal(normalizeKey(" Order-Creation "), "ordercreation");
  assert.equal(normalizeKey("Support_Request!"), "supportrequest");
});

test("getSlaDueAt calculates correct times", () => {
  const base = new Date("2026-06-01T10:00:00Z");

  const urgent = getSlaDueAt("urgent", base);
  assert.equal(urgent.toISOString(), "2026-06-01T11:00:00.000Z"); // +1h

  const normal = getSlaDueAt("normal", base);
  assert.equal(normal.toISOString(), "2026-06-01T22:00:00.000Z"); // +12h
});

test("sanitizeTicketFields rejects overly large or deep payloads", () => {
  // Deep nesting
  const deep: Record<string, unknown> = {};
  let current = deep;
  for (let i = 0; i < 10; i++) {
    current.child = {};
    current = current.child as Record<string, unknown>;
  }
  assert.throws(() => sanitizeTicketFields(deep), /too deeply nested/);

  // Too many properties
  const wide: Record<string, unknown> = {};
  for (let i = 0; i < 201; i++) {
    wide[`prop${i}`] = i;
  }
  assert.throws(() => sanitizeTicketFields(wide), /too many properties/);
});

test("validateTicketOrderFlow only allows ordercreation tickets", () => {
  assert.doesNotThrow(() => validateTicketOrderFlow({
    ticketTypeKey: "ordercreation",
    ticketFlowEnabled: true
  }));

  assert.throws(() => validateTicketOrderFlow({
    ticketTypeKey: "support",
    ticketFlowEnabled: true
  }), /Only order creation tickets support approve and deny/);

  assert.throws(() => validateTicketOrderFlow({
    ticketTypeKey: "ordercreation",
    ticketFlowEnabled: false
  }), /Ticket-to-order flow is disabled/);
});

test("assertTicketAwaitingOrderDecision blocks already resolved tickets", () => {
  assert.doesNotThrow(() => assertTicketAwaitingOrderDecision({
    status: "open",
    outcome: "pending"
  }));

  assert.throws(() => assertTicketAwaitingOrderDecision({
    status: "resolved",
    outcome: "won"
  }), /Only unresolved order tickets can be approved or denied/);

  assert.throws(() => assertTicketAwaitingOrderDecision({
    status: "open",
    outcome: "lost"
  }), /Only unresolved order tickets can be approved or denied/);
});

test("coalesceText picks the first non-empty value", () => {
  assert.equal(coalesceText(undefined, null, " ", "found", "ignored"), "found");
  assert.equal(coalesceText("", null), null);
});

test("maskPhoneNumber hides most digits", () => {
  assert.equal(maskPhoneNumber("+94771234567"), "*******4567");
  assert.equal(maskPhoneNumber("123"), "123");
  assert.equal(maskPhoneNumber(null), null);
});
