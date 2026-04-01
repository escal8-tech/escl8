import assert from "node:assert/strict";
import test from "node:test";
import {
  hasPhoneNumber,
  nextPagingUrl,
  normalizeGraphId,
  normalizeRequestedWabaIds,
} from "@/server/services/metaWhatsappSupport";

test("normalizeGraphId trims usable ids", () => {
  assert.equal(normalizeGraphId(" 123 "), "123");
  assert.equal(normalizeGraphId(""), null);
  assert.equal(normalizeGraphId(undefined), null);
});

test("hasPhoneNumber detects matching edge members", () => {
  assert.equal(
    hasPhoneNumber({ data: [{ id: "one" }, { id: "two" }] }, "two"),
    true,
  );
  assert.equal(hasPhoneNumber({ data: [{ id: "one" }] }, "two"), false);
});

test("nextPagingUrl returns only non-empty urls", () => {
  assert.equal(nextPagingUrl({ next: "https://example.com/page2" }), "https://example.com/page2");
  assert.equal(nextPagingUrl({ next: " " }), null);
  assert.equal(nextPagingUrl(undefined), null);
});

test("normalizeRequestedWabaIds trims and deduplicates", () => {
  assert.deepEqual(normalizeRequestedWabaIds([" a ", "b", "a", " "]), ["a", "b"]);
});
