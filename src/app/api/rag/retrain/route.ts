import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { users } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import { verifyFirebaseIdToken } from "@/server/firebaseAdmin";
import { checkRateLimit } from "@/server/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DocType = "considerations" | "conversations" | "inventory" | "bank" | "address";

export async function POST(request: Request) {
  try {
    const rl = checkRateLimit(request, {
      name: "rag_retrain",
      max: Number(process.env.RATE_LIMIT_RAG_RETRAIN_MAX ?? "10"),
      windowMs: Number(process.env.RATE_LIMIT_RAG_RETRAIN_WINDOW_MS ?? String(60_000)),
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

    const body = await request.json();

    const auth = request.headers.get("authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let businessId: string | null = null;
    try {
      const decoded = await verifyFirebaseIdToken(m[1]);
      const email = decoded.email;
      if (email) {
        const rows = await db.select().from(users).where(eq(users.email, email));
        const user = rows[0];
        if (user?.businessId) businessId = user.businessId as string;
      }
    } catch {}

    if (!businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const docType = (body.docType as DocType);
    if (!docType || !["considerations","conversations","inventory","bank","address"].includes(docType)) {
      return NextResponse.json({ error: "Invalid docType" }, { status: 400 });
    }

    // Legacy endpoint: retrain is now implemented via tRPC (rag.enqueueRetrain) and blob-only indexing.
    // We intentionally do NOT spawn Python or write temp files here.
    return NextResponse.json(
      {
        ok: false,
        error: "Deprecated. Use tRPC rag.enqueueRetrain.",
        code: "DEPRECATED",
      },
      { status: 410, headers: rl.headers },
    );
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Retrain failed" }, { status: 500 });
  }
}
