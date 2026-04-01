/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getAuthedUserFromRequest } from "@/server/apiAuth";
import { checkRateLimit } from "@/server/rateLimit";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { captureSentryException } from "@/lib/sentry-monitoring";

export const runtime = "nodejs";

async function getAuthedIdentity(req: Request): Promise<{ businessId: string; userId: string } | null> {
  const authed = await getAuthedUserFromRequest(req);
  if (!authed?.businessId) return null;
  return { businessId: authed.businessId, userId: authed.firebaseUid };
}

export async function GET(req: Request) {
  const rl = checkRateLimit(req, {
    name: "events_negotiate",
    max: Number(process.env.RATE_LIMIT_EVENTS_NEGOTIATE_MAX ?? "90"),
    windowMs: Number(process.env.RATE_LIMIT_EVENTS_NEGOTIATE_WINDOW_MS ?? String(60_000)),
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too Many Requests" },
      {
        status: 429,
        headers: {
          ...rl.headers,
          "retry-after": String(Math.max(1, Math.ceil((rl.resetAtMs - Date.now()) / 1000))),
        },
      },
    );
  }
  const startedAt = Date.now();
  const identity = await getAuthedIdentity(req);
  if (!identity) {
    recordBusinessEvent({
      event: "realtime.negotiate_denied",
      level: "warn",
      action: "negotiate",
      area: "realtime",
      source: "api.events.negotiate",
      outcome: "handled_failure",
      status: "unauthorized",
      entity: "realtime_session",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: rl.headers });
  }

  const conn = process.env.WEB_PUBSUB_CONNECTION_STRING || process.env.WEB_PUBSUB_CONN || "";
  const hub = process.env.WEB_PUBSUB_HUB || "portal";
  if (!conn) {
    const error = new Error("WEB_PUBSUB_CONNECTION_STRING missing");
    recordBusinessEvent({
      event: "realtime.negotiate_failed",
      level: "error",
      action: "negotiate",
      area: "realtime",
      businessId: identity.businessId,
      source: "api.events.negotiate",
      outcome: "failed",
      status: "missing_config",
      entity: "realtime_session",
      attributes: {
        missing_env: "WEB_PUBSUB_CONNECTION_STRING",
      },
    });
    captureSentryException(error, {
      action: "realtime-negotiate",
      area: "realtime",
      level: "error",
      tags: {
        "escal8.business_id": identity.businessId,
        "realtime.hub": hub,
      },
    });
    return NextResponse.json({ error: "WEB_PUBSUB_CONNECTION_STRING missing" }, { status: 503, headers: rl.headers });
  }

  let WebPubSubServiceClientCtor: any;
  try {
    const reqFn = eval("require") as NodeRequire;
    WebPubSubServiceClientCtor = reqFn("@azure/web-pubsub").WebPubSubServiceClient;
  } catch (error) {
    recordBusinessEvent({
      event: "realtime.negotiate_failed",
      level: "error",
      action: "negotiate",
      area: "realtime",
      businessId: identity.businessId,
      source: "api.events.negotiate",
      outcome: "failed",
      status: "missing_dependency",
      entity: "realtime_session",
      attributes: {
        dependency: "@azure/web-pubsub",
      },
    });
    captureSentryException(error, {
      action: "realtime-negotiate",
      area: "realtime",
      level: "error",
      tags: {
        "escal8.business_id": identity.businessId,
        "realtime.hub": hub,
      },
    });
    return NextResponse.json({ error: "@azure/web-pubsub not installed" }, { status: 503, headers: rl.headers });
  }

  const group = `business.${identity.businessId}`;
  try {
    const client = new WebPubSubServiceClientCtor(conn, hub);
    const token = await client.getClientAccessToken({
      userId: identity.userId,
      roles: [`webpubsub.joinLeaveGroup.${group}`],
    });
    console.info(
      "[realtime:negotiate] ok businessId=%s hub=%s durationMs=%d",
      identity.businessId,
      hub,
      Date.now() - startedAt,
    );

    return NextResponse.json({
      url: token.url,
      hub,
      group,
      subprotocol: "json.webpubsub.azure.v1",
    });
  } catch (error) {
    recordBusinessEvent({
      event: "realtime.negotiate_failed",
      level: "error",
      action: "negotiate",
      area: "realtime",
      businessId: identity.businessId,
      source: "api.events.negotiate",
      outcome: "failed",
      status: "token_generation_failed",
      entity: "realtime_session",
      attributes: {
        duration_ms: Date.now() - startedAt,
        hub,
      },
    });
    captureSentryException(error, {
      action: "realtime-negotiate",
      area: "realtime",
      level: "error",
      tags: {
        "escal8.business_id": identity.businessId,
        "realtime.hub": hub,
      },
    });
    return NextResponse.json({ error: "Realtime negotiation failed" }, { status: 503 });
  }
}
