import { NextRequest, NextResponse } from "next/server";

import { createSenangPayRecurringCheckout } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { suiteTenantId, planCode, customerName, customerEmail, customerPhone } = body;

    if (!suiteTenantId || !planCode) {
      return NextResponse.json(
        { error: "suiteTenantId and planCode are required" },
        { status: 400 },
      );
    }

    const { checkoutUrl } = await createSenangPayRecurringCheckout({
      suiteTenantId,
      planCode,
      customerName: customerName ?? null,
      customerEmail: customerEmail ?? null,
      customerPhone: customerPhone ?? null,
    });

    return NextResponse.json({ checkoutUrl });
  } catch (error) {
    console.error("[billing/recurring-checkout] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create recurring checkout" },
      { status: 500 },
    );
  }
}
