import test from "node:test";
import assert from "node:assert/strict";
import { isInternalApiAuthorized, normalizeServiceBaseUrl, secretsEqual } from "@/server/internalSecurity";
import { normalizeBlobPath } from "@/lib/storage";

test("secretsEqual uses exact matching semantics", () => {
  assert.equal(secretsEqual("abc123", "abc123"), true);
  assert.equal(secretsEqual("abc123", "abc124"), false);
});

test("isInternalApiAuthorized accepts x-api-key header", () => {
  const request = new Request("https://example.com", {
    headers: { "x-api-key": "super-secret" },
  });
  assert.equal(isInternalApiAuthorized(request, "super-secret"), true);
});

test("normalizeServiceBaseUrl keeps valid http urls and rejects other schemes", () => {
  assert.equal(normalizeServiceBaseUrl("https://example.com///"), "https://example.com");
  assert.throws(() => normalizeServiceBaseUrl("ftp://example.com"), /http or https/i);
});

test("normalizeBlobPath rejects traversal and invalid characters", () => {
  assert.equal(normalizeBlobPath("biz/order-payments/file.pdf"), "biz/order-payments/file.pdf");
  assert.equal(normalizeBlobPath("../secret"), null);
  assert.equal(normalizeBlobPath("bad path/file.pdf"), null);
});
