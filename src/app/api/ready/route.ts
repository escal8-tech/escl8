import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { controlDb } from "@/server/control/db";
import { db } from "@/server/db/client";

export const runtime = "nodejs";

function envEnabled(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export async function GET(): Promise<NextResponse> {
  try {
    await Promise.all([db.execute(sql`select 1`), controlDb.execute(sql`select 1`)]);
    if (envEnabled("REQUIRE_WEB_PUBSUB_READY")) {
      const conn = process.env.WEB_PUBSUB_CONNECTION_STRING || process.env.WEB_PUBSUB_CONN || "";
      if (!conn.trim()) {
        throw new Error("WEB_PUBSUB_CONNECTION_STRING missing");
      }
    }

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
