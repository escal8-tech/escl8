import { NextResponse } from "next/server";

import { finalizeSenangPayPayment } from "@/lib/billing";
import { parseSenangPayRequest, verifySenangPayCallback } from "@/lib/senangpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleCallback(req: Request) {
  const payload = await parseSenangPayRequest(req);

  if (!verifySenangPayCallback(payload)) {
    return new NextResponse("INVALID_HASH", { status: 400 });
  }

  await finalizeSenangPayPayment(payload);
  return new NextResponse("OK", { status: 200 });
}

export async function GET(req: Request) {
  return handleCallback(req);
}

export async function POST(req: Request) {
  return handleCallback(req);
}