import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";
import { middleware } from "./middleware";

// Mock verifyAccessToken to return a valid payload
// This is tricky because middleware.ts imports it directly.
// In a real environment we'd use a mocking library or dependency injection.
// For now, let's at least test the header stripping logic which happens at the very beginning.

test("middleware strips internal identity headers to prevent spoofing", async () => {
  const request = new NextRequest("http://localhost:3000/api/trpc/orders.list", {
    headers: {
      "x-business-id": "spoofed-biz-id",
      "x-firebase-uid": "spoofed-uid",
      "x-user-email": "spoofed@example.com",
    },
  });

  // We don't need to await the full middleware execution if we just want to check the request object
  // after the stripping logic. However, the headers are deleted from the 'request' object passed in.

  // To test this properly without running the full async middleware (which would fail due to missing JWT),
  // we can look at the code:
  /*
  const headersToStrip = [
    'x-firebase-uid',
    'x-user-email',
    'x-suite-tenant-id',
    'x-user-id',
    'x-business-id',
    ...
  ];
  headersToStrip.forEach((header) => request.headers.delete(header));
  */

  // We can't easily run just a piece of the middleware function without modifying it,
  // but we can pass it a request and see if it fails auth but DID strip the headers.

  try {
    await middleware(request);
  } catch (e) {
    // It might throw or return a redirect
  }

  assert.equal(request.headers.get("x-business-id"), null);
  assert.equal(request.headers.get("x-firebase-uid"), null);
  assert.equal(request.headers.get("x-user-email"), null);
});
