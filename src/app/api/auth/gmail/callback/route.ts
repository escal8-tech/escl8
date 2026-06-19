import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { businesses, users } from "@/../drizzle/schema";
import { recordBusinessEvent } from "@/lib/business-monitoring";

function safeDecodeState(raw: string | null): { userId: string; businessId: string; returnTo: string } | null {
  if (!raw) return null;
  try {
    const [encodedPayload, providedSig] = String(raw).split(".");
    if (!encodedPayload || !providedSig) return null;
    const secret = process.env.NEXTAUTH_SECRET || "";
    if (!secret) return null;
    const expectedSig = createHmac("sha256", secret).update(encodedPayload).digest("hex");
    if (providedSig !== expectedSig) return null;
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const userId = String((parsed as { userId?: string }).userId || "").trim();
    const businessId = String((parsed as { businessId?: string }).businessId || "").trim();
    const returnTo = String((parsed as { returnTo?: string }).returnTo || "");
    const ts = Number((parsed as { ts?: number }).ts || 0);
    const stateAgeMs = Date.now() - ts;
    if (!Number.isFinite(ts) || stateAgeMs < 0 || stateAgeMs > 15 * 60 * 1000) return null;
    if (!userId || !businessId) return null;
    return { userId, businessId, returnTo: returnTo.startsWith("/") ? returnTo : "/settings" };
  } catch {
    return null;
  }
}

function resolveBaseUrl(req: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, "");
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  const baseUrl = resolveBaseUrl(req);
  const state = safeDecodeState(req.nextUrl.searchParams.get("state"));
  const code = req.nextUrl.searchParams.get("code");
  if (!state || !code) {
    return NextResponse.redirect(new URL("/settings?gmail=error", baseUrl));
  }

  const stateReturnTo = state.returnTo || "/settings";
  const [stateUser] = await db
    .select({
      id: users.id,
      businessId: users.businessId,
    })
    .from(users)
    .where(and(eq(users.id, state.userId), eq(users.businessId, state.businessId)))
    .limit(1);
  if (!stateUser?.id) {
    return NextResponse.redirect(new URL(`${stateReturnTo}?gmail=forbidden`, baseUrl));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI ||
    `${baseUrl}/api/auth/gmail/callback`;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL(`${stateReturnTo}?gmail=env_missing`, baseUrl));
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      return NextResponse.redirect(new URL(`${stateReturnTo}?gmail=token_error`, baseUrl));
    }

    const accessToken = String(tokenJson.access_token || "");
    const refreshToken = String(tokenJson.refresh_token || "");
    const expiresIn = Number(tokenJson.expires_in || 0);
    const scope = String(tokenJson.scope || "");
    if (!accessToken || !refreshToken) {
      return NextResponse.redirect(new URL(`${stateReturnTo}?gmail=token_missing`, baseUrl));
    }

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profileJson = await profileRes.json();
    const gmailEmail = String(profileJson?.email || "").trim().toLowerCase();
    if (!gmailEmail) {
      return NextResponse.redirect(new URL(`${stateReturnTo}?gmail=email_missing`, baseUrl));
    }

    const now = new Date();
    const expiryDate = new Date(Date.now() + Math.max(60, expiresIn) * 1000);
    const [updatedBusiness] = await db
      .update(businesses)
      .set({
        gmailConnected: true,
        gmailEmail,
        gmailRefreshToken: refreshToken,
        gmailAccessToken: accessToken,
        gmailAccessTokenExpiresAt: expiryDate,
        gmailScope: scope || null,
        gmailConnectedAt: now,
        gmailError: null,
        updatedAt: now,
      })
      .where(eq(businesses.id, state.businessId))
      .returning({ id: businesses.id });

    if (!updatedBusiness?.id) {
      return NextResponse.redirect(new URL(`${stateReturnTo}?gmail=error`, baseUrl));
    }

    recordBusinessEvent({
      event: "business.gmail_connected",
      action: "business.gmail.connect",
      area: "business",
      businessId: state.businessId,
      entity: "business",
      entityId: state.businessId,
      actorId: state.userId,
      actorType: "user",
      source: "auth",
      outcome: "success",
      status: "connected",
    });

    return NextResponse.redirect(new URL(`${stateReturnTo}?gmail=connected`, baseUrl));
  } catch {
    return NextResponse.redirect(new URL(`${stateReturnTo}?gmail=error`, baseUrl));
  }
}
