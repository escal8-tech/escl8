import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { orders } from "@/../drizzle/schema";
import { isInternalApiAuthorized } from "@/server/internalSecurity";
import { markOrderInvoiceDelivered } from "@/server/services/orderInvoice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getInternalApiKey(): string {
  return String(
    process.env.ORDER_INVOICE_API_KEY ||
      process.env.ORDER_PAYMENT_API_KEY ||
      process.env.ESCAL8_INTERNAL_SERVICE_TOKEN ||
      process.env.WHATSAPP_API_KEY ||
      "",
  ).trim();
}

function isAuthorized(request: Request): boolean {
  return isInternalApiAuthorized(request, getInternalApiKey());
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const businessId = String(body.businessId || "").trim();
  const orderId = String(body.orderId || "").trim();
  const invoiceNumber = String(body.invoiceNumber || "").trim();
  const deliveryMethod = String(body.deliveryMethod || "whatsapp").trim().toLowerCase();

  if (!businessId || !orderId) {
    return NextResponse.json(
      { success: false, error: "businessId and orderId are required." },
      { status: 400 },
    );
  }
  if (deliveryMethod !== "whatsapp" && deliveryMethod !== "email") {
    return NextResponse.json(
      { success: false, error: "deliveryMethod must be whatsapp or email." },
      { status: 400 },
    );
  }

  // SECURITY: Verify order belongs to business to prevent IDOR
  const [orderOwnership] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.businessId, businessId), eq(orders.id, orderId)))
    .limit(1);

  if (!orderOwnership) {
    return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
  }

  const updated = await markOrderInvoiceDelivered({
    businessId,
    orderId,
    deliveryMethod,
    invoiceNumber,
  });
  if (!updated) {
    return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
