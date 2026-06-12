import { NextRequest, NextResponse } from "next/server";

import { createSenangPayRecurringCheckout } from "@/lib/billing";
import { queryRows } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { suiteTenantId, planCode, recurringId, customerName, customerEmail, customerPhone } = body;

    if (!suiteTenantId || (!planCode && !recurringId)) {
      return NextResponse.json(
        { error: "suiteTenantId and either planCode or recurringId are required" },
        { status: 400 },
      );
    }

    // If planCode is provided, look up the recurringId from the plan
    let finalRecurringId = recurringId;
    if (planCode && !recurringId) {
      const planRows = await queryRows<{ senangpay_recurring_id: string }>(
        "control",
        `select senangpay_recurring_id from suite_subscription_plans where code = $1 and is_active = true limit 1`,
        [planCode]
      );
      if (!planRows[0]?.senangpay_recurring_id) {
        return NextResponse.json(
          { error: `Plan ${planCode} does not have a recurring ID configured` },
          { status: 400 },
        );
      }
      finalRecurringId = planRows[0].senangpay_recurring_id;
    }

    const { checkoutUrl } = await createSenangPayRecurringCheckout({
      suiteTenantId,
      recurringId: finalRecurringId,
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