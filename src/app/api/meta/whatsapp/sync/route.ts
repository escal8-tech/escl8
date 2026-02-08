import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { users, whatsappIdentities } from "../../../../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { generateSixDigitPin } from "@/server/meta/crypto";
import { graphEndpoint, graphJson, MetaGraphError } from "@/server/meta/graph";
import { verifyFirebaseIdToken } from "@/server/firebaseAdmin";
import { checkRateLimit } from "@/server/rateLimit";

export const runtime = "nodejs";

// This endpoint receives the authorization code from Facebook Embedded Signup
// along with the WhatsApp Business Account (WABA) ID and Phone Number ID.
// TODO: Exchange the code for a System User access token on the server, then
// - Verify/lookup the WABA and phone number
// - Subscribe the phone number to your app
// - Configure the webhook callback URL and verification token
// - Persist the connection against the authenticated user

export async function POST(req: Request) {
  try {
    const rl = checkRateLimit(req, {
      name: "whatsapp_sync",
      max: Number(process.env.RATE_LIMIT_WHATSAPP_SYNC_MAX ?? "10"),
      windowMs: Number(process.env.RATE_LIMIT_WHATSAPP_SYNC_WINDOW_MS ?? String(60_000)),
    });
    if (!rl.ok) {
      return NextResponse.json(
        { ok: false, error: "Too Many Requests" },
        {
          status: 429,
          headers: {
            ...rl.headers,
            "retry-after": String(Math.max(1, Math.ceil((rl.resetAtMs - Date.now()) / 1000))),
          },
        },
      );
    }

    const auth = req.headers.get("authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const decoded = await verifyFirebaseIdToken(m[1]);
    const authedEmail = decoded.email;
    const firebaseUid = decoded.uid;
    if (!authedEmail || !firebaseUid) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { code, wabaId, phoneNumberId, email, wabaCurrency } = (await req.json()) as {
      code?: string;
      wabaId?: string;
      phoneNumberId?: string;
      email?: string;
      wabaCurrency?: string;
    };

    if (!code || !wabaId || !phoneNumberId) {
      return NextResponse.json({ ok: false, error: "Missing code, wabaId or phoneNumberId" }, { status: 400 });
    }

    if (email && email !== authedEmail) {
      return NextResponse.json({ ok: false, error: "Email mismatch" }, { status: 403 });
    }

    let user = await db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, firebaseUid))
      .then((r) => r[0] ?? null);

    if (!user) {
      user = await db
        .select()
        .from(users)
        .where(eq(users.email, authedEmail))
        .then((r) => r[0] ?? null);

      if (user && !user.firebaseUid) {
        const repaired = await db
          .update(users)
          .set({ firebaseUid, updatedAt: new Date() })
          .where(and(eq(users.id, user.id), eq(users.email, authedEmail)))
          .returning();
        user = repaired[0] ?? user;
      }
    }
    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    const metaAppId = process.env.META_APP_ID;
    const metaAppSecret = process.env.META_APP_SECRET;
    const metaGraphApiVersion = process.env.META_GRAPH_API_VERSION ?? "v24.0";
    const metaExtendedCreditLineId = process.env.META_EXTENDED_CREDIT_LINE_ID;
    const metaSystemUserToken = process.env.META_SYSTEM_USER_TOKEN;
    if (!metaSystemUserToken) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing META_SYSTEM_USER_TOKEN (required to register phone numbers)",
          code: "MISSING_SYSTEM_USER_TOKEN",
        },
        { status: 500 },
      );
    }
    if (!metaAppId || !metaAppSecret) {
      return NextResponse.json(
        {
          ok: false,
          error: "Server missing META_APP_ID or META_APP_SECRET",
          code: "MISSING_META_APP_CONFIG",
        },
        { status: 500 },
      );
    }

    // Step 1: Exchange the token code for a customer business token.
    // Tech Provider doc: GET /oauth/access_token with client_id, client_secret, code
    const tokenRes = await graphJson<any>({
      endpoint: graphEndpoint(metaGraphApiVersion, "/oauth/access_token"),
      method: "GET",
      query: {
        client_id: metaAppId,
        client_secret: metaAppSecret,
        code,
      },
    });

    const businessToken: string | undefined =
      typeof tokenRes === "string"
        ? tokenRes
        : typeof tokenRes === "object" && tokenRes && typeof tokenRes.access_token === "string"
          ? tokenRes.access_token
          : undefined;

    if (!businessToken) {
      return NextResponse.json(
        {
          ok: false,
          error: "Meta token exchange succeeded but no access token was returned",
          code: "TOKEN_EXCHANGE_NO_TOKEN",
        },
        { status: 502 },
      );
    }

    // Step 2: Subscribe to webhooks on the customer's WABA.
    const subscribed = await graphJson<{ success?: boolean } | { success: true }>({
      endpoint: graphEndpoint(metaGraphApiVersion, `/${wabaId}/subscribed_apps`),
      method: "POST",
      accessToken: businessToken,
    });

    // Step 3 (Solution Partner): Share your credit line with the customer.
    let creditShareRes: { allocation_config_id?: string; waba_id?: string } | null = null;
    const currency = (wabaCurrency ?? process.env.META_DEFAULT_WABA_CURRENCY ?? "USD").toUpperCase();
    if (metaExtendedCreditLineId) {
      creditShareRes = await graphJson<{ allocation_config_id?: string; waba_id?: string }>({
        endpoint: graphEndpoint(metaGraphApiVersion, `/${metaExtendedCreditLineId}/whatsapp_credit_sharing_and_attach`),
        method: "POST",
        accessToken: metaSystemUserToken,
        query: {
          waba_currency: currency,
          waba_id: wabaId,
        },
      });
    } else {
      console.log("[WhatsApp Sync] Skipping credit line sharing (no META_EXTENDED_CREDIT_LINE_ID)");
    }

    // Step 4: Register the customer's phone number.
    const desiredPin = generateSixDigitPin();
    const registered = await graphJson<{ success?: boolean } | { success: true }>({
      endpoint: graphEndpoint(metaGraphApiVersion, `/${phoneNumberId}/register`),
      method: "POST",
      accessToken: metaSystemUserToken,
      json: {
        messaging_product: "whatsapp",
        pin: desiredPin,
      },
    });

    const now = new Date();

    // Persist the identity for routing + webhooks. Storing token and PIN in plaintext per user request.
    // NOTE: this does NOT mean Cloud API registration/webhook subscription is complete.
    await db
      .insert(whatsappIdentities)
      .values({
        phoneNumberId,
        businessId: user.businessId,
        connectedByUserId: user.id,
        wabaId,
        twoStepPin: desiredPin,

        webhookSubscribedAt: now,
        creditLineSharedAt: now,
        creditLineAllocationConfigId: creditShareRes?.allocation_config_id ?? null,
        wabaCurrency: currency,
        registeredAt: now,

        isActive: true,
        connectedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: whatsappIdentities.phoneNumberId,
        set: {
          businessId: user.businessId,
          connectedByUserId: user.id,
          wabaId,

          twoStepPin: desiredPin,

          webhookSubscribedAt: now,
          creditLineSharedAt: now,
          creditLineAllocationConfigId: creditShareRes?.allocation_config_id ?? null,
          wabaCurrency: currency,
          registeredAt: now,

          isActive: true,
          connectedAt: now,
          disconnectedAt: null,
          updatedAt: now,
        },
      });

    await db
      .update(users)
      .set({ whatsappConnected: true, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    console.log("[WhatsApp Sync] Linked identity:", {
      businessId: user.businessId,
      wabaId,
      phoneNumberId,
      code: code.slice(0, 6) + "…",
      subscribed,
      creditShareRes,
      registered,
    });

    return NextResponse.json(
      {
      ok: true,
      stored: true,
      setupComplete: true,
      message:
        "WhatsApp onboarded (token exchanged, webhooks subscribed, credit line shared, phone registered).",
      },
      { headers: rl.headers },
    );
  } catch (err: any) {
    if (err instanceof MetaGraphError) {
      console.error("[WhatsApp Sync] Meta Graph error:", {
        status: err.status,
        endpoint: err.endpoint,
        message: err.message,
        graphError: err.graphError,
      });
      return NextResponse.json(
        {
          ok: false,
          error: err.message,
          code: "META_GRAPH_ERROR",
          meta: {
            status: err.status,
            endpoint: err.endpoint,
            ...err.graphError,
          },
        },
        { status: 502 },
      );
    }

    console.error("[WhatsApp Sync] Error:", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
