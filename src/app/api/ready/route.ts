import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { controlDb } from "@/server/control/db";
import { db } from "@/server/db/client";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    await Promise.all([db.execute(sql`select 1`), controlDb.execute(sql`select 1`)]);

    return NextResponse.json({
      ok: true,
      ready: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        ready: false,
        error: error instanceof Error ? error.message : "unknown_ready_state_error",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
