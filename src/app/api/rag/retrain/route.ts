import { NextResponse } from "next/server";
import { getAuthedUserFromRequest } from "@/server/apiAuth";

import { isDocType, type DocType } from "@/lib/rag-documents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    

    // Legacy endpoint: retrain is now implemented via tRPC (rag.enqueueRetrain) and blob-only indexing.
    // We intentionally do NOT spawn Python or write temp files here.
    return NextResponse.json(
      {
        ok: false,
        error: "Deprecated. Use tRPC rag.enqueueRetrain.",
        code: "DEPRECATED",
      },
      { status: 410, headers: {} },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Retrain failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
