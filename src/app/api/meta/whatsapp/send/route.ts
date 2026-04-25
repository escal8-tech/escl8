import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { businesses, whatsappIdentities } from "../../../../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
// decryptSecret removed — prefer plaintext storage
import { graphEndpoint, graphJson, MetaGraphError } from "@/server/meta/graph";
import { getAuthedUserFromRequest } from "@/server/apiAuth";
import { checkRateLimit } from "@/server/rateLimit";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { captureSentryException } from "@/lib/sentry-monitoring";
import { getTenantModuleAccess, tenantHasFeature } from "@/server/control/access";
import { SUITE_FEATURES } from "@/server/control/subscription-features";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const rl = checkRateLimit(req, {
      name: "whatsapp_send",
      max: Number(process.env.RATE_LIMIT_WHATSAPP_SEND_MAX ?? "30"),
      windowMs: Number(process.env.RATE_LIMIT_WHATSAPP_SEND_WINDOW_MS ?? String(60_000)),
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

    const { email, phoneNumberId, to, text } = (await req.json()) as {
      email?: string;
      phoneNumberId?: string;
      to?: string;
      text?: string;
    };

    if (email && email !== authed.email) {
      return NextResponse.json({ ok: false, error: "Email mismatch" }, { status: 403 });
    }
    if (!phoneNumberId || !to || !text) {
      return NextResponse.json({ ok: false, error: "Missing phoneNumberId, to, or text" }, { status: 400 });
    }
    const trimmedPhoneNumberId = phoneNumberId.trim();
    const trimmedRecipient = to.trim();
    const trimmedText = text.trim();
    if (!trimmedPhoneNumberId || !trimmedRecipient || !trimmedText) {
      return NextResponse.json({ ok: false, error: "Missing phoneNumberId, to, or text" }, { status: 400 });
    }
    if (trimmedPhoneNumberId.length > 64 || trimmedRecipient.length > 32 || trimmedText.length > 4096) {
      return NextResponse.json({ ok: false, error: "Request payload is too large" }, { status: 413 });
    }

    const user = authed.user;
    const business = user.businessId
      ? await db.select().from(businesses).where(eq(businesses.id, user.businessId)).limit(1).then((rows) => rows[0] ?? null)
      : null;
    const access = business?.suiteTenantId ? await getTenantModuleAccess(business.suiteTenantId, "agent") : null;
    if (!tenantHasFeature(access, SUITE_FEATURES.AGENT_WHATSAPP_SEND)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Outbound WhatsApp messaging is locked for this subscription. Upgrade or activate billing to send messages.",
          code: "FEATURE_LOCKED",
        },
        { status: 402, headers: rl.headers },
      );
    }

    const identity = await db
      .select()
      .from(whatsappIdentities)
      .where(and(eq(whatsappIdentities.phoneNumberId, trimmedPhoneNumberId), eq(whatsappIdentities.businessId, user.businessId)))
      .then((r) => r[0] ?? null);

    if (!identity) {
      return NextResponse.json({ ok: false, error: "WhatsApp identity not found for this business" }, { status: 404 });
    }

    const metaGraphApiVersion = process.env.META_GRAPH_API_VERSION ?? "v24.0";
    const businessToken: string | null = process.env.META_SYSTEM_USER_TOKEN ?? null;

    if (!businessToken) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing META_SYSTEM_USER_TOKEN.",
          code: "MISSING_BUSINESS_TOKEN",
        },
        { status: 409 },
      );
    }

    const res = await graphJson<unknown>({
      endpoint: graphEndpoint(metaGraphApiVersion, `/${trimmedPhoneNumberId}/messages`),
      method: "POST",
      accessToken: businessToken,
      json: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: trimmedRecipient,
        type: "text",
        text: {
          body: trimmedText,
        },
      },
    });

    recordBusinessEvent({
      event: "whatsapp.message_sent",
      action: "send",
      area: "whatsapp",
      businessId: user.businessId,
      entity: "whatsapp_message",
      entityId: phoneNumberId,
      source: "api.meta.whatsapp.send",
      outcome: "success",
      status: "sent",
      attributes: {
        recipient: trimmedRecipient,
        text_length: trimmedText.length,
      },
    });

    return NextResponse.json({ ok: true, result: res }, { headers: rl.headers });
  } catch (err: unknown) {
    if (err instanceof MetaGraphError) {
      recordBusinessEvent({
        event: "whatsapp.message_send_failed",
        level: "warn",
        action: "send",
        area: "whatsapp",
        entity: "whatsapp_message",
        source: "api.meta.whatsapp.send",
        outcome: "handled_failure",
        status: "meta_graph_error",
        attributes: {
          endpoint: err.endpoint,
          error_message: err.message,
          status_code: err.status,
        },
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

    captureSentryException(err, {
      action: "whatsapp-send",
      area: "whatsapp",
      level: "error",
      tags: {
        "whatsapp.route": "send",
      },
    });
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
