export const LEGACY_MULTI_GMAIL_CONNECTIONS_ERROR = "legacy_multiple_gmail_connections_require_reconnect";

export function describeCompanyGmailError(gmailError: string | null | undefined): string | null {
  if (!gmailError) return null;
  if (gmailError === "token_refresh_failed") {
    return "The stored Gmail token could not be refreshed. Reconnect the company Gmail account.";
  }
  if (gmailError === LEGACY_MULTI_GMAIL_CONNECTIONS_ERROR) {
    return "This company had multiple Gmail senders before migration. Reconnect the intended company Gmail account once.";
  }
  if (gmailError.startsWith("send_failed:")) {
    const status = gmailError.split(":")[1] || "unknown";
    return `The last Gmail send attempt failed with API status ${status}.`;
  }
  return "The company Gmail connection reported an error. Reconnect the account if order emails are failing.";
}
