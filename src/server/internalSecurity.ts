import { timingSafeEqual } from "node:crypto";

export function readInternalApiKey(request: Request): string {
  return String(
    request.headers.get("x-api-key") ||
      request.headers.get("X-API-Key") ||
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      "",
  ).trim();
}

export function secretsEqual(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(String(expected || "").trim());
  const providedBuffer = Buffer.from(String(provided || "").trim());
  if (!expectedBuffer.length || !providedBuffer.length) return false;
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function isInternalApiAuthorized(request: Request, expectedSecret: string): boolean {
  const expected = String(expectedSecret || "").trim();
  if (!expected) return false;
  return secretsEqual(expected, readInternalApiKey(request));
}

export function normalizeServiceBaseUrl(value: string): string {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Internal service URL must use http or https.");
  }
  return parsed.toString().replace(/\/+$/, "");
}
