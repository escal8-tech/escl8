import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { or, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { businesses, users } from "@/../drizzle/schema";
import { verifyFirebaseIdToken } from "@/server/firebaseAdmin";

type GmailStatePayload = {
  userId: string;
  businessId: string;
  returnTo: string;
  nonce: string;
  ts: number;
};

function resolveBaseUrl(req: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, "");
  return req.nextUrl.origin;
}

function signGmailState(payload: GmailStatePayload): string | null {
  const secret = process.env.NEXTAUTH_SECRET || "";
  if (!secret) return null;
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(encodedPayload).digest("hex");
  return `${encodedPayload}.${sig}`;
}

export async function GET(req: NextRequest) {
  const baseUrl = resolveBaseUrl(req);
  const idToken = String(req.nextUrl.searchParams.get("idToken") || "").trim();
  if (!idToken) {
    return NextResponse.redirect(new URL("/portal/settings?gmail=auth_required", baseUrl));
  }

  let resolvedUserId = "";
  let resolvedBusinessId = "";
  try {
    const decoded = await verifyFirebaseIdToken(idToken);
    const firebaseUid = String(decoded?.uid || "").trim();
    const email = String(decoded?.email || "").trim().toLowerCase();
    const matchers = [];
    if (firebaseUid) matchers.push(eq(users.firebaseUid, firebaseUid));
    if (email) matchers.push(eq(users.email, email));
    if (!matchers.length) {
      return NextResponse.redirect(new URL("/portal/settings?gmail=auth_required", baseUrl));
    }
    const [user] = await db
      .select({ id: users.id, businessId: users.businessId })
      .from(users)
      .where(matchers.length === 1 ? matchers[0] : or(...matchers))
      .limit(1);
    resolvedUserId = String(user?.id || "").trim();
    resolvedBusinessId = String(user?.businessId || "").trim();
  } catch {
    return NextResponse.redirect(new URL("/portal/settings?gmail=auth_required", baseUrl));
  }

  if (!resolvedUserId || !resolvedBusinessId) {
    return NextResponse.redirect(new URL("/portal/settings?gmail=forbidden", baseUrl));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "GOOGLE_CLIENT_ID is not configured" }, { status: 500 });
  }

  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI ||
    `${baseUrl}/api/auth/gmail/callback`;
  const returnTo = req.nextUrl.searchParams.get("returnTo") || "/portal/settings";

  const [business] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.id, resolvedBusinessId))
    .limit(1);
  if (!business?.id) {
    return NextResponse.redirect(new URL(`${returnTo}?gmail=forbidden`, baseUrl));
  }

  const state = signGmailState({
    userId: resolvedUserId,
    businessId: resolvedBusinessId,
    returnTo,
    nonce: Math.random().toString(36).slice(2),
    ts: Date.now(),
  });
  if (!state) {
    return NextResponse.json({ error: "NEXTAUTH_SECRET is not configured" }, { status: 500 });
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set(
    "scope",
    "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email",
  );
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl);
}
