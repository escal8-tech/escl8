import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { businesses } from "../../../drizzle/schema";

function toBase64Url(value: Buffer | string): string {
  const encoded = Buffer.isBuffer(value) ? value.toString("base64") : Buffer.from(value, "utf8").toString("base64");
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type BusinessEmailMessage = {
  subject: string;
  text: string;
  html?: string | null;
};

function buildGmailRawMessage(params: {
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
}): string {
  const boundaryAlt = `order_alt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const lines = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
    "",
    `--${boundaryAlt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    params.bodyText,
    "",
    `--${boundaryAlt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    params.bodyHtml || `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(params.bodyText)}</pre>`,
    "",
    `--${boundaryAlt}--`,
    "",
  ];
  return toBase64Url(lines.join("\r\n"));
}

async function refreshGmailAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number } | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!tokenRes.ok) return null;
  const tokenJson = await tokenRes.json();
  const accessToken = String(tokenJson?.access_token || "");
  const expiresIn = Number(tokenJson?.expires_in || 0);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return { accessToken, expiresIn };
}

async function resolveBusinessGmailSender(businessId: string): Promise<{
  id: string;
  gmailEmail: string;
  gmailAccessToken: string;
  gmailRefreshToken: string;
  gmailAccessTokenExpiresAt: Date | null;
} | null> {
  const [sender] = await db
    .select({
      id: businesses.id,
      gmailEmail: businesses.gmailEmail,
      gmailAccessToken: businesses.gmailAccessToken,
      gmailRefreshToken: businesses.gmailRefreshToken,
      gmailAccessTokenExpiresAt: businesses.gmailAccessTokenExpiresAt,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!sender?.gmailEmail || !sender?.gmailRefreshToken) return null;
  return {
    id: sender.id,
    gmailEmail: sender.gmailEmail,
    gmailAccessToken: sender.gmailAccessToken || "",
    gmailRefreshToken: sender.gmailRefreshToken,
    gmailAccessTokenExpiresAt: sender.gmailAccessTokenExpiresAt || null,
  };
}

export async function sendBusinessGmailMessage(input: {
  businessId: string;
  to: string;
  subject: string;
  text: string;
  html?: string | null;
}): Promise<{
  success: boolean;
  messageId?: string | null;
  error?: string | null;
}> {
  const sender = await resolveBusinessGmailSender(input.businessId);
  if (!sender) {
    return {
      success: false,
      error: "No company Gmail sender found. Connect Gmail in Settings -> Integrations.",
    };
  }

  let accessToken = sender.gmailAccessToken;
  const tokenExpired =
    !sender.gmailAccessTokenExpiresAt || sender.gmailAccessTokenExpiresAt.getTime() < Date.now() + 60_000;
  if (!accessToken || tokenExpired) {
    const refreshed = await refreshGmailAccessToken(sender.gmailRefreshToken);
    if (!refreshed) {
      await db
        .update(businesses)
        .set({ gmailError: "token_refresh_failed", updatedAt: new Date() })
        .where(eq(businesses.id, sender.id));
      return {
        success: false,
        error: "Failed to refresh Gmail access token. Reconnect Gmail in Settings.",
      };
    }
    accessToken = refreshed.accessToken;
    await db
      .update(businesses)
      .set({
        gmailAccessToken: refreshed.accessToken,
        gmailAccessTokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
        gmailError: null,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, sender.id));
  }

  const raw = buildGmailRawMessage({
    from: sender.gmailEmail,
    to: input.to,
    subject: input.subject,
    bodyText: input.text,
    bodyHtml: input.html,
  });

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  if (!response.ok) {
    await db
      .update(businesses)
      .set({ gmailError: `send_failed:${response.status}`, updatedAt: new Date() })
      .where(eq(businesses.id, sender.id));
    return {
      success: false,
      error: `Gmail API error (${response.status}).`,
    };
  }

  const data = await response.json().catch(() => ({}));
  await db
    .update(businesses)
    .set({ gmailError: null, updatedAt: new Date() })
    .where(eq(businesses.id, sender.id));
  return {
    success: true,
    messageId: String(data?.id || "") || null,
  };
}
