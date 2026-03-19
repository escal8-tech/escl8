import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { recordSentryLog } from "@/lib/sentry-monitoring";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  await Sentry.startSpan(
    {
      name: "agent-dashboard.sentry-example.log-route",
      op: "http.server",
    },
    async () => {
      recordSentryLog("error", "Agent Dashboard Sentry Example API Log", {
        area: "sentry-example",
        log_source: "sentry_test",
        surface: "backend",
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      await Sentry.flush(2000);
    },
  );

  return NextResponse.json({ ok: true });
}
