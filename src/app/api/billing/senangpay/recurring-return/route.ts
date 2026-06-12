import { NextResponse } from "next/server";

import { finalizeSenangPayRecurringPayment } from "@/lib/billing";
import {
  parseSenangPayRecurringRequest,
  verifySenangPayRecurringAdvanceCallback,
  verifySenangPayRecurringStandardCallback,
  type SenangPayRecurringCallbackPayload,
  type SenangPayRecurringStandardCallbackPayload,
} from "@/lib/senangpay-recurring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicOrigin(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function handleReturn(req: Request) {
  const payload = await parseSenangPayRecurringRequest(req);
  const dashboardUrl = new URL("/dashboard", publicOrigin(req));

  // Handle advance callback (JSON format with status_id, order_id, transaction_id, msg)
  if ("statusId" in payload && "orderId" in payload && "transactionId" in payload && "msg" in payload) {
    const advancePayload = payload as SenangPayRecurringCallbackPayload;
    if (!verifySenangPayRecurringAdvanceCallback(advancePayload)) {
      dashboardUrl.searchParams.set("senangpay", "invalid");
      return NextResponse.redirect(dashboardUrl);
    }
    const result = await finalizeSenangPayRecurringPayment(advancePayload);
    dashboardUrl.searchParams.set("senangpay", result.paid ? "paid" : "failed");
    dashboardUrl.searchParams.set("tenant", result.suiteTenantId);
    return NextResponse.redirect(dashboardUrl);
  }

  // Handle standard callback (form-encoded with action, recurring_id, type, customer_email)
  const standardPayload = payload as SenangPayRecurringStandardCallbackPayload;
  if (!verifySenangPayRecurringStandardCallback(standardPayload)) {
    dashboardUrl.searchParams.set("senangpay", "invalid");
    return NextResponse.redirect(dashboardUrl);
  }

  const result = await finalizeSenangPayRecurringPayment(standardPayload);
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