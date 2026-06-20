import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeManualExternalId,
  buildManualOrderFields,
  parseManualQuantity
} from "./ticketMutationSupport";

test("normalizeManualExternalId prioritizes identifiers correctly", () => {
  // prioritize phone
  assert.equal(normalizeManualExternalId({ phone: " +94 77 123 4567 ", email: "test@example.com" }), "94771234567");

  // fallback to email
  assert.equal(normalizeManualExternalId({ email: " TEST@Example.COM " }), "test@example.com");

  // fallback to slugified name
  assert.match(normalizeManualExternalId({ name: " John Doe's Shop " }), /^manual-john-doe-s-shop/);

  // absolute fallback
  assert.match(normalizeManualExternalId({}), /^manual-/);
});

test("parseManualQuantity ensures valid positive integer", () => {
  assert.equal(parseManualQuantity("5"), "5");
  assert.equal(parseManualQuantity("0"), "1");
  assert.equal(parseManualQuantity("-5"), "5");
  assert.equal(parseManualQuantity("abc"), "1");
  assert.equal(parseManualQuantity(undefined), "1");
});

test("buildManualOrderFields constructs correct payload", () => {
  const fields = buildManualOrderFields({
    channel: "walkin",
    customerName: "Namith",
    customerPhone: "0771234567",
    customerEmail: "namith@example.com",
    lineItems: [
      { item: "Item A", quantity: "2", unitPrice: "100" },
      { item: "Item B", quantity: "1", unitPrice: "50.5" }
    ],
    total: "250.5"
  });

  assert.equal(fields.manual_order, true);
  assert.equal(fields.customer_name, "Namith");
  assert.equal(fields.total, "250.50");
  assert.equal(fields.line_items.length, 2);
  assert.equal(fields.line_items[0].line_total, "200.00");
  assert.equal(fields.line_items[1].line_total, "50.50");
});

test("buildManualOrderFields calculates total if omitted", () => {
  const fields = buildManualOrderFields({
    channel: "walkin",
    customerName: "Namith",
    lineItems: [
      { item: "Item A", quantity: "2", unitPrice: "100" },
      { item: "Item B", quantity: "1", unitPrice: "50" }
    ]
  });

  assert.equal(fields.total, "250.00");
});
