import test from "node:test";
import assert from "node:assert/strict";
import { parseMoneyNumber } from "../../../src/lib/money";
import { escapeJsonForHtml } from "../../../src/lib/security";

test("Security Hardening: parseMoneyNumber robustness", () => {
  // Basic valid cases
  assert.strictEqual(parseMoneyNumber("100"), 100);
  assert.strictEqual(parseMoneyNumber("100.50"), 100.5);
  assert.strictEqual(parseMoneyNumber("1,000.50"), 1000.5);

  // Malicious/Edge cases
  assert.strictEqual(parseMoneyNumber("NaN"), null);
  assert.strictEqual(parseMoneyNumber("Infinity"), null);
  assert.strictEqual(parseMoneyNumber("-Infinity"), null);
  assert.strictEqual(parseMoneyNumber("abc"), null);
  assert.strictEqual(parseMoneyNumber("   "), null);
  assert.strictEqual(parseMoneyNumber("$1,234.56"), 1234.56);
  // Note: parseMoneyNumber is highly permissive and strips all non-numeric characters.
  assert.strictEqual(parseMoneyNumber("<script>alert(1)</script>"), 1);
  assert.strictEqual(parseMoneyNumber("100; DROP TABLE users"), 100);
});

test("Security Hardening: escapeJsonForHtml logic", () => {
  const maliciousData = {
    inject: "</script><script>alert('xss')</script>",
    amp: "at&t",
    single: "it's"
  };

  const jsonString = JSON.stringify(maliciousData);
  const result = escapeJsonForHtml(jsonString);

  // Check that all risky characters are escaped
  assert.ok(!result.includes("<"), "Should not contain <");
  assert.ok(!result.includes(">"), "Should not contain >");
  assert.ok(!result.includes("'"), "Should not contain '");
  assert.ok(!result.includes("&"), "Should not contain &");

  // structural quotes should be literal
  assert.ok(result.includes('"'), "Should contain raw double quotes for JSON structure");

  assert.ok(result.includes("\\u003c"), "Should contain escaped <");
  assert.ok(result.includes("\\u003e"), "Should contain escaped >");
  assert.ok(result.includes("\\u0026"), "Should contain escaped &");
  assert.ok(result.includes("\\u0027"), "Should contain escaped '");
});

test("Security Hardening: escapeJsonForHtml produces valid JSON", () => {
  const data = { a: 1, b: "</b>", c: "http://example.com" };
  const jsonString = JSON.stringify(data);
  const result = escapeJsonForHtml(jsonString);
  const parsed = JSON.parse(result);
  assert.deepStrictEqual(parsed, data);
});
