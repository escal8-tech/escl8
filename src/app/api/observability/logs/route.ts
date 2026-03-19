import { NextResponse } from "next/server";

import { recordGrafanaLog } from "@/lib/grafana-monitoring";

type RequestLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

type RequestLogPayload = {
  attributes?: Record<string, boolean | number | string | null | undefined>;
  level?: RequestLogLevel;
  message?: string;
  source?: string;
};

const MAX_BATCH_SIZE = 20;

function normalizeLevel(value: unknown): RequestLogLevel {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "trace") return "trace";
  if (normalized === "debug") return "debug";
  if (normalized === "warn") return "warn";
  if (normalized === "error") return "error";
  if (normalized === "fatal") return "fatal";
  return "info";
}

function normalizePayload(input: unknown): RequestLogPayload | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const payload = input as RequestLogPayload;
  const message = String(payload.message || "").trim().slice(0, 4000);
  if (!message) return null;

  const attributes =
    payload.attributes && typeof payload.attributes === "object" && !Array.isArray(payload.attributes)
      ? payload.attributes
      : undefined;

  return {
    attributes,
    level: normalizeLevel(payload.level),
    message,
    source: typeof payload.source === "string" ? payload.source.slice(0, 120) : undefined,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const rawLogs = Array.isArray((body as { logs?: unknown[] })?.logs)
      ? (body as { logs: unknown[] }).logs
      : [body];

    const accepted = rawLogs
      .slice(0, MAX_BATCH_SIZE)
      .map(normalizePayload)
      .filter((entry): entry is RequestLogPayload => Boolean(entry));

    for (const entry of accepted) {
      recordGrafanaLog(
        entry.level || "info",
        entry.message || "empty_browser_log",
        {
          ...(entry.attributes || {}),
          log_source: entry.source || "browser",
        },
        {
          runtime: "client",
          source: entry.source || "browser",
        },
      );
    }

    return NextResponse.json({
      accepted: accepted.length,
      ok: true,
    });
  } catch {
    return NextResponse.json({ error: "Invalid log payload" }, { status: 400 });
  }
}
