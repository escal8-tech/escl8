import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { users } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type DocType = "considerations" | "conversations" | "inventory" | "bank" | "address";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = request.headers.get("x-user-email") || undefined;
    let businessId: string | null = null;
    if (email) {
      try {
        const rows = await db.select().from(users).where(eq(users.email, email));
        const user = rows[0];
        if (user?.businessId) businessId = user.businessId as string;
      } catch {}
    }
    if (!businessId) {
      return NextResponse.json({ error: "Business ID not set for user" }, { status: 400 });
    }
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
      { status: 410 },
    );
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Retrain failed" }, { status: 500 });
  }
}
