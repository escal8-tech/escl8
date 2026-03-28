export const APP_LOGIN_ROUTE = "/";
export const APP_SIGNUP_ROUTE = "/signup";
export const APP_DEFAULT_AUTH_REDIRECT = "/upload";
export const APP_PROTECTED_ROUTE_PREFIXES = [
  "/dashboard",
  "/requests",
  "/customers",
  "/messages",
  "/upload",
  "/bookings",
  "/sync",
  "/settings",
  "/orders",
  "/revenue",
  "/tickets",
] as const;

export function normalizeAppPath(pathname?: string | null): string {
  const raw = String(pathname || "").trim();
  if (!raw || raw === "/") return APP_LOGIN_ROUTE;
  if (raw === "/portal" || raw === "/portal/") return APP_LOGIN_ROUTE;
  if (raw.startsWith("/portal/")) {
    const stripped = raw.slice("/portal".length);
    return stripped.startsWith("/") ? stripped : `/${stripped}`;
  }
  return raw;
}

export function isAppAuthPath(pathname?: string | null): boolean {
  const normalized = normalizeAppPath(pathname);
  return normalized === APP_LOGIN_ROUTE || normalized === APP_SIGNUP_ROUTE;
}

export function isAppPath(pathname?: string | null): boolean {
  const normalized = normalizeAppPath(pathname);
  if (isAppAuthPath(normalized)) return true;
  return APP_PROTECTED_ROUTE_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

export function isAppFlushPath(pathname?: string | null): boolean {
  const normalized = normalizeAppPath(pathname);
  return ["/customers", "/messages", "/tickets", "/requests"].some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}
