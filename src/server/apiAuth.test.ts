import assert from "node:assert/strict";
import test from "node:test";
import { readBearerToken } from "@/server/apiAuth";

test("readBearerToken parses bearer headers", () => {
  const request = new Request("https://example.com", {
    headers: {
      authorization: "Bearer abc123",
    },
  });
  assert.equal(readBearerToken(request), "abc123");
});

test("readBearerToken rejects missing or malformed headers", () => {
  const noHeader = new Request("https://example.com");
  const wrongScheme = new Request("https://example.com", {
    headers: {
      authorization: "Basic 123",
    },
  });
  assert.equal(readBearerToken(noHeader), null);
  assert.equal(readBearerToken(wrongScheme), null);
});

