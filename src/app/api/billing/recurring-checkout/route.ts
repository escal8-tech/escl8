import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { createSenangPayRecurringCheckout } from "@/lib/billing";
import { businesses } from "@/../drizzle/schema";
import { db } from "@/server/db/client";
import { getAuthedUserFromRequest } from "@/server/apiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const authed = await getAuthedUserFromRequest(req);
    if (!authed?.user?.businessId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json();
    const { planCode, customerName, customerPhone } = body;
    const business = await db
      .select({ suiteTenantId: businesses.suiteTenantId })
      .from(businesses)
      .where(eq(businesses.id, authed.user.businessId))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!business?.suiteTenantId || !planCode) {
      return NextResponse.json(
        { error: "A linked suite tenant and planCode are required" },
        { status: 400 },
      );
    }

    const { checkoutUrl } = await createSenangPayRecurringCheckout({
      suiteTenantId: business.suiteTenantId,
      planCode,
      requiredModule: "agent",
      customerName: customerName ?? null,
      customerEmail: authed.email,
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
