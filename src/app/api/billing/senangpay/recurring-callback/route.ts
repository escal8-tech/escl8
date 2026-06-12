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

async function handleCallback(req: Request) {
  const payload = await parseSenangPayRecurringRequest(req);

  // Handle advance callback (JSON format with status_id, order_id, transaction_id, msg)
  if ("statusId" in payload && "orderId" in payload && "transactionId" in payload && "msg" in payload) {
    const advancePayload = payload as SenangPayRecurringCallbackPayload;
    if (!verifySenangPayRecurringAdvanceCallback(advancePayload)) {
      return new NextResponse("INVALID_HASH", { status: 400 });
    }
    await finalizeSenangPayRecurringPayment(advancePayload);
    return new NextResponse("OK", { status: 200 });
  }

  // Handle standard callback (form-encoded with action, recurring_id, type, customer_email)
  const standardPayload = payload as SenangPayRecurringStandardCallbackPayload;
  if (!verifySenangPayRecurringStandardCallback(standardPayload)) {
    return new NextResponse("INVALID_HASH", { status: 400 });
  }

  await finalizeSenangPayRecurringPayment(standardPayload);
  return new NextResponse("OK", { status: 200 });
}

export async function GET(req: Request) {
  return handleCallback(req);
}

export async function POST(req: Request) {
  return handleCallback(req);
}