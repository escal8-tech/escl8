import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { users, whatsappIdentities } from "../../../../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
// decryptSecret removed — prefer plaintext storage
import { graphEndpoint, graphJson, MetaGraphError } from "@/server/meta/graph";
import { verifyFirebaseIdToken } from "@/server/firebaseAdmin";

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const decoded = await verifyFirebaseIdToken(m[1]);
    const authedEmail = decoded.email;
    if (!authedEmail) {
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

    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, authedEmail))
      .then((r) => r[0] ?? null);
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

    return NextResponse.json({ ok: true, result: res });
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
