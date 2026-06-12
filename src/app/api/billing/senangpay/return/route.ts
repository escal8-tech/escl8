import { NextResponse } from "next/server";

import { finalizeSenangPayPayment } from "@/lib/billing";
import { parseSenangPayRequest, verifySenangPayCallback } from "@/lib/senangpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicOrigin(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function handleReturn(req: Request) {
  const payload = await parseSenangPayRequest(req);
  const dashboardUrl = new URL("/dashboard", publicOrigin(req));

  if (!verifySenangPayCallback(payload)) {
    dashboardUrl.searchParams.set("senangpay", "invalid");
    return NextResponse.redirect(dashboardUrl);
  }

  const result = await finalizeSenangPayPayment(payload);
  dashboardUrl.searchParams.set("senangpay", result.paid ? "paid" : "failed");
  dashboardUrl.searchParams.set("tenant", result.suiteTenantId);
  return NextResponse.redirect(dashboardUrl);
}

export async function GET(req: Request) {
  return handleReturn(req);
}

export async function POST(req: Request) {
  return handleReturn(req);
}