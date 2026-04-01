/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { users, whatsappIdentities } from "../../../../../../drizzle/schema";
import { eq } from "drizzle-orm";
import { generateSixDigitPin } from "@/server/meta/crypto";
import { graphEndpoint, graphJson, MetaGraphError } from "@/server/meta/graph";
import { getAuthedUserFromRequest } from "@/server/apiAuth";
import { checkRateLimit } from "@/server/rateLimit";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { captureSentryException } from "@/lib/sentry-monitoring";
import {
  type MetaPhoneNumberLookup,
  normalizeGraphId,
  normalizeRequestedWabaIds,
  resolveAuthoritativeWabaId,
} from "@/server/services/metaWhatsappSupport";

export const runtime = "nodejs";

// This endpoint receives the authorization code from Facebook Embedded Signup
// along with the WhatsApp Business Account (WABA) ID and Phone Number ID.
// TODO: Exchange the code for a System User access token on the server, then
// - Verify/lookup the WABA and phone number
// - Subscribe the phone number to your app
// - Configure the webhook callback URL and verification token
// - Persist the connection against the authenticated user

export async function POST(req: Request) {
  let requestedWabaIdForLogs: string | undefined;
  let requestedWabaIdsForLogs: string[] | undefined;
  let phoneNumberIdForLogs: string | undefined;
  let metaBusinessPortfolioIdForLogs: string | undefined;
  let embeddedSignupEventForLogs: string | undefined;

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

    const authed = await getAuthedUserFromRequest(req);
    if (!authed?.user || !authed.email) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: rl.headers });
    }

    const { code, wabaId, wabaIds, phoneNumberId, email, wabaCurrency, metaBusinessPortfolioId, embeddedSignupEvent } = (await req.json()) as {
      code?: string;
      wabaId?: string;
      wabaIds?: string[];
      phoneNumberId?: string;
      email?: string;
      wabaCurrency?: string;
      metaBusinessPortfolioId?: string;
      embeddedSignupEvent?: string;
    };

    requestedWabaIdForLogs = wabaId;
    requestedWabaIdsForLogs = wabaIds;
    phoneNumberIdForLogs = phoneNumberId;
    metaBusinessPortfolioIdForLogs = metaBusinessPortfolioId;
    embeddedSignupEventForLogs = embeddedSignupEvent;

    if (!code || !phoneNumberId) {
      return NextResponse.json({ ok: false, error: "Missing code or phoneNumberId" }, { status: 400 });
    }

    if (email && email !== authed.email) {
      return NextResponse.json({ ok: false, error: "Email mismatch" }, { status: 403 });
    }
    const user = authed.user;

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

    const requestedWabaIds = normalizeRequestedWabaIds(wabaIds);

    // Resolve the authoritative WABA from the phone number before subscribing.
    // Embedded signup should already provide it, but we trust the server-side lookup
    // because subscribed_apps must be posted against the WABA object, not the phone.
    const phoneNumber = await graphJson<MetaPhoneNumberLookup>({
      endpoint: graphEndpoint(metaGraphApiVersion, `/${phoneNumberId}`),
      method: "GET",
      accessToken: metaSystemUserToken,
      query: {
        fields: "id,display_phone_number,verified_name,status,code_verification_status,last_onboarded_time",
      },
    });
    const resolvedWabaId = await resolveAuthoritativeWabaId({
      requestedWabaId: wabaId,
      requestedWabaIds,
      phoneNumberId,
      metaGraphApiVersion,
      systemUserToken: metaSystemUserToken,
      businessToken,
    });

    if (!resolvedWabaId) {
      return NextResponse.json(
        {
          ok: false,
          error: "WhatsApp setup could not be completed. Please retry the sync.",
          code: "WABA_RESOLUTION_FAILED",
        },
        { status: 502, headers: rl.headers },
      );
    }

    // Step 2 (Solution Partner): Share your credit line with the customer.
    let creditShareRes: { allocation_config_id?: string; waba_id?: string } | null = null;
    const currency = (wabaCurrency ?? process.env.META_DEFAULT_WABA_CURRENCY ?? "USD").toUpperCase();
    if (metaExtendedCreditLineId) {
      creditShareRes = await graphJson<{ allocation_config_id?: string; waba_id?: string }>({
        endpoint: graphEndpoint(metaGraphApiVersion, `/${metaExtendedCreditLineId}/whatsapp_credit_sharing_and_attach`),
        method: "POST",
        accessToken: metaSystemUserToken,
        query: {
          waba_currency: currency,
          waba_id: resolvedWabaId,
        },
      });
    } else {
      console.log("[WhatsApp Sync] Skipping credit line sharing (no META_EXTENDED_CREDIT_LINE_ID)");
    }

    // Step 3: Register the customer's phone number and require success before
    // subscribing the app to the customer's WABA.
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
    if (registered?.success !== true) {
      return NextResponse.json(
        {
          ok: false,
          error: "WhatsApp setup could not be completed. Please retry the sync.",
          code: "REGISTER_FAILED",
        },
        { status: 502, headers: rl.headers },
      );
    }

    // Step 4: Subscribe to webhooks on the customer's WABA.
    const subscribed = await graphJson<{ success?: boolean } | { success: true }>({
      endpoint: graphEndpoint(metaGraphApiVersion, `/${resolvedWabaId}/subscribed_apps`),
      method: "POST",
      accessToken: metaSystemUserToken,
    });
    if (subscribed?.success !== true) {
      return NextResponse.json(
        {
          ok: false,
          error: "WhatsApp setup could not be completed. Please retry the sync.",
          code: "SUBSCRIBE_FAILED",
        },
        { status: 502, headers: rl.headers },
      );
    }

    const now = new Date();

    // Persist the identity for routing + webhooks. Storing token and PIN in plaintext per user request.
    // NOTE: this does NOT mean Cloud API registration/webhook subscription is complete.
    await db
      .insert(whatsappIdentities)
      .values({
        phoneNumberId,
        businessId: user.businessId,
        connectedByUserId: user.id,
        wabaId: resolvedWabaId,
        displayPhoneNumber: phoneNumber.display_phone_number?.trim() || null,
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
          wabaId: resolvedWabaId,
          displayPhoneNumber: phoneNumber.display_phone_number?.trim() || null,

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
      wabaId: resolvedWabaId,
      requestedWabaId: wabaId,
      requestedWabaIds,
      metaBusinessPortfolioId: normalizeGraphId(metaBusinessPortfolioId),
      embeddedSignupEvent: typeof embeddedSignupEvent === "string" ? embeddedSignupEvent : null,
      phoneNumberId,
      displayPhoneNumber: phoneNumber.display_phone_number ?? null,
      code: code.slice(0, 6) + "…",
      subscribed,
      creditShareRes,
      registered,
    });

    recordBusinessEvent({
      event: "whatsapp.identity_connected",
      action: "sync",
      area: "whatsapp",
      businessId: user.businessId,
      entity: "whatsapp_identity",
      entityId: phoneNumberId,
      source: "api.meta.whatsapp.sync",
      outcome: "success",
      status: "connected",
      attributes: {
        subscribed_success: Boolean(subscribed?.success ?? true),
        registered_success: Boolean(registered?.success ?? true),
        waba_id: resolvedWabaId,
        requested_waba_id: wabaId,
        requested_waba_ids: requestedWabaIds.join(",") || null,
        meta_business_portfolio_id: normalizeGraphId(metaBusinessPortfolioId),
        embedded_signup_event: typeof embeddedSignupEvent === "string" ? embeddedSignupEvent : null,
        display_phone_number: phoneNumber.display_phone_number ?? null,
      },
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
      recordBusinessEvent({
        event: "whatsapp.identity_connect_failed",
        level: "warn",
        action: "sync",
        area: "whatsapp",
        entity: "whatsapp_identity",
        source: "api.meta.whatsapp.sync",
        outcome: "handled_failure",
        status: "meta_graph_error",
        attributes: {
          endpoint: err.endpoint,
          error_message: err.message,
          requested_waba_id: typeof requestedWabaIdForLogs === "string" ? requestedWabaIdForLogs : null,
          requested_waba_ids: Array.isArray(requestedWabaIdsForLogs) ? requestedWabaIdsForLogs.join(",") : null,
          phone_number_id: typeof phoneNumberIdForLogs === "string" ? phoneNumberIdForLogs : null,
          meta_business_portfolio_id: normalizeGraphId(metaBusinessPortfolioIdForLogs),
          embedded_signup_event: typeof embeddedSignupEventForLogs === "string" ? embeddedSignupEventForLogs : null,
          graph_error_code: err.graphError?.code,
          graph_error_subcode: err.graphError?.error_subcode,
          graph_error_type: err.graphError?.type,
          graph_fbtrace_id: err.graphError?.fbtrace_id,
          status_code: err.status,
        },
      });
      captureSentryException(err, {
        action: "whatsapp-sync",
        area: "whatsapp",
        level: "error",
        contexts: {
          meta_graph: {
            endpoint: err.endpoint,
            fbtrace_id: err.graphError?.fbtrace_id ?? null,
            message: err.message,
            status: err.status,
            type: err.graphError?.type ?? null,
            code: err.graphError?.code ?? null,
            subcode: err.graphError?.error_subcode ?? null,
          },
        },
        tags: {
          "whatsapp.route": "sync",
          "whatsapp.graph_code": err.graphError?.code ?? null,
          "whatsapp.meta_status": err.status,
        },
      });
      return NextResponse.json(
        {
          ok: false,
          error: "WhatsApp setup could not be completed. Please retry the sync.",
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

    captureSentryException(err, {
      action: "whatsapp-sync",
      area: "whatsapp",
      level: "error",
      tags: {
        "whatsapp.route": "sync",
      },
    });
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
