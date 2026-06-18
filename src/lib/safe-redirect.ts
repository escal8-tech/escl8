/**
 * Validates a redirect URL is a safe internal path.
 *
 * Prevents open-redirect vulnerabilities by rejecting:
 * - empty / null values
 * - absolute URLs (http://, https://, etc.)
 * - protocol-relative URLs (//evil.com)
 * - the login page itself (to avoid redirect loops)
 */
export function isSafeInternalRedirect(value: string | null | undefined): value is string {
  if (!value) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/auth/login")) return false;
  return true;
}
