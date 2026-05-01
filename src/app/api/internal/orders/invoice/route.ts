import { NextResponse } from "next/server";

import { isInternalApiAuthorized } from "@/server/internalSecurity";
import {
  buildOrderInvoiceDocumentMessage,
  createOrderInvoiceForOrder,
} from "@/server/services/orderInvoice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getInternalApiKey(): string {
  return String(
    process.env.ORDER_INVOICE_API_KEY ||
      process.env.ORDER_PAYMENT_API_KEY ||
      process.env.BOT_INTERNAL_API_KEY ||
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
  const language = String(body.language || "en").trim() || "en";
  const forceRegenerate = Boolean(body.forceRegenerate);

  if (!businessId || !orderId) {
    return NextResponse.json(
      { success: false, error: "businessId and orderId are required." },
      { status: 400 },
    );
  }

  try {
    const artifact = await createOrderInvoiceForOrder({
      businessId,
      orderId,
      forceRegenerate,
      deliveryMethod: "whatsapp",
    });
    if (!artifact) {
      return NextResponse.json({ success: false, error: "Order not found or invoice generation is already in progress." }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      artifact,
      documentMessage: buildOrderInvoiceDocumentMessage({ artifact, language }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Invoice generation failed.",
      },
      { status: 500 },
    );
  }
}
