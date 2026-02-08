import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { users, whatsappIdentities } from "../../../../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
// decryptSecret removed — prefer plaintext storage
import { graphEndpoint, graphJson, MetaGraphError } from "@/server/meta/graph";
import { verifyFirebaseIdToken } from "@/server/firebaseAdmin";
import { checkRateLimit } from "@/server/rateLimit";

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

    const { email, phoneNumberId, to, text } = (await req.json()) as {
      email?: string;
      phoneNumberId?: string;
      to?: string;
      text?: string;
    };

    if (email && email !== authedEmail) {
      return NextResponse.json({ ok: false, error: "Email mismatch" }, { status: 403 });
    }
    if (!phoneNumberId || !to || !text) {
      return NextResponse.json({ ok: false, error: "Missing phoneNumberId, to, or text" }, { status: 400 });
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

    const identity = await db
      .select()
      .from(whatsappIdentities)
      .where(and(eq(whatsappIdentities.phoneNumberId, phoneNumberId), eq(whatsappIdentities.businessId, user.businessId)))
      .then((r) => r[0] ?? null);

    if (!identity) {
      return NextResponse.json({ ok: false, error: "WhatsApp identity not found for this business" }, { status: 404 });
    }

    // Prefer a stored plaintext token for quick retrieval, fallback to encrypted token if present.
    const metaGraphApiVersion = process.env.META_GRAPH_API_VERSION ?? "v24.0";

    const businessToken: string | null = (identity as any).businessToken ?? null;

    if (!businessToken) {
      return NextResponse.json(
        {
          ok: false,
          error: "No stored business token for this phoneNumberId. Complete Embedded Signup sync first.",
          code: "MISSING_BUSINESS_TOKEN",
        },
        { status: 409 },
      );
    }

    const res = await graphJson<any>({
      endpoint: graphEndpoint(metaGraphApiVersion, `/${phoneNumberId}/messages`),
      method: "POST",
      accessToken: businessToken,
      json: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
          body: text,
        },
      },
    });

    return NextResponse.json({ ok: true, result: res }, { headers: rl.headers });
  } catch (err: any) {
    if (err instanceof MetaGraphError) {
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

    console.error("[WhatsApp Send] Error:", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
