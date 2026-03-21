import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { orderPayments, orders } from "@/../drizzle/schema";
import { storePrivateFileAtPath } from "@/lib/storage";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { logOrderEvent } from "@/server/services/orderFlow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PaymentProofAnalyzerResult = {
  provider: string;
  status: "passed" | "needs_review";
  confidence: number;
  summary: string;
  checks: {
    amountMatch: boolean;
    dateFormatValid: boolean;
    dateNotFuture: boolean;
    referenceMatch: boolean;
    proofPresent: boolean;
  };
  extracted?: Record<string, unknown>;
};

type PortalJsonValue = string | number | boolean | null | PortalJsonValue[] | { [k: string]: PortalJsonValue };

function toPortalPayload(value: unknown): Record<string, PortalJsonValue> {
  const serialized = JSON.parse(JSON.stringify(value ?? {})) as PortalJsonValue;
  if (!serialized || typeof serialized !== "object" || Array.isArray(serialized)) {
    return {};
  }
  return serialized as Record<string, PortalJsonValue>;
}

function getInternalApiKey(): string {
  return String(
    process.env.ORDER_PAYMENT_API_KEY ||
      process.env.BOT_INTERNAL_API_KEY ||
      process.env.WHATSAPP_API_KEY ||
      "",
  ).trim();
}

function isAuthorized(request: Request): boolean {
  const expected = getInternalApiKey();
  if (!expected) return false;
  const provided =
    request.headers.get("x-api-key") ||
    request.headers.get("X-API-Key") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  return String(provided).trim() === expected;
}

function toMoneyString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  const cleaned = String(value).trim().replace(/[^0-9.,-]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",") && !cleaned.includes(".")
    ? cleaned.replace(/,/g, ".")
    : cleaned.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
}

async function analyzePaymentProof(input: {
  expectedAmount: string | null;
  currency: string;
  expectedReference: string | null;
  paymentProofUrl?: string | null;
  paymentProofText?: string | null;
}): Promise<PaymentProofAnalyzerResult | null> {
  const baseUrl = String(process.env.BOT_INTERNAL_BASE_URL || "").trim().replace(/\/+$/, "");
  const apiKey = String(
    process.env.PAYMENT_PROOF_ANALYZER_API_KEY ||
      process.env.BOT_INTERNAL_API_KEY ||
      process.env.WHATSAPP_API_KEY ||
      "",
  ).trim();
  if (!baseUrl || !apiKey) return null;

  const expectedAmount = Number(input.expectedAmount ?? 0);
  const response = await fetch(`${baseUrl}/internal/payment-proof/analyze`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      expectedAmount,
      expectedReference: input.expectedReference ?? "",
      currency: input.currency,
      paymentProofUrl: input.paymentProofUrl ?? undefined,
      paymentProofText: input.paymentProofText ?? undefined,
    }),
    cache: "no-store",
  });

  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  const analysis = payload?.analysis;
  if (!analysis || typeof analysis !== "object") return null;
  return analysis as PaymentProofAnalyzerResult;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const businessId = String(formData.get("businessId") || "").trim();
  const orderId = String(formData.get("orderId") || "").trim();
  const paymentText = String(formData.get("paymentText") || "").trim();
  const file = formData.get("file");

  if (!businessId || !orderId) {
    return NextResponse.json({ success: false, error: "businessId and orderId are required." }, { status: 400 });
  }
  if (!(file instanceof File) && !paymentText) {
    return NextResponse.json({ success: false, error: "Payment proof file or text is required." }, { status: 400 });
  }

  const [orderRow] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.businessId, businessId), eq(orders.id, orderId)))
    .limit(1);
  if (!orderRow) {
    return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
  }

  const allowedStatuses = new Set(["awaiting_payment", "payment_submitted", "payment_rejected"]);
  if (!allowedStatuses.has(String(orderRow.status || "").trim().toLowerCase())) {
    return NextResponse.json(
      { success: false, error: "Order is not accepting payment proof submissions." },
      { status: 409 },
    );
  }

  let storedProof:
    | {
        url: string;
        blobPath: string;
        contentType?: string;
        name: string;
      }
    | null = null;

  if (file instanceof File) {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    storedProof = await storePrivateFileAtPath({
      blobPath: `${businessId}/order-payments/${orderId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
      buffer,
      fileName: file.name,
      contentType: file.type || undefined,
      readTtlHours: 24 * 7,
    });
  }

  const analysis = await analyzePaymentProof({
    expectedAmount: toMoneyString(orderRow.expectedAmount),
    currency: String(orderRow.currency || "LKR").trim() || "LKR",
    expectedReference: String(orderRow.paymentReference || "").trim() || null,
    paymentProofUrl: storedProof?.url ?? null,
    paymentProofText: paymentText || null,
  });

  const submittedAmount =
    toMoneyString(analysis?.extracted?.amount) ??
    null;
  const now = new Date();
  const [paymentRow] = await db
    .insert(orderPayments)
    .values({
      businessId,
      orderId: orderRow.id,
      customerId: orderRow.customerId,
      threadId: orderRow.threadId,
      whatsappIdentityId: orderRow.whatsappIdentityId,
      paymentMethod: orderRow.paymentMethod,
      status: "submitted",
      currency: orderRow.currency,
      expectedAmount: orderRow.expectedAmount,
      paidAmount: submittedAmount,
      paidDate: analysis?.extracted?.paymentDate ? String(analysis.extracted.paymentDate) : null,
      referenceCode: String(analysis?.extracted?.reference || orderRow.paymentReference || "").trim() || null,
      proofUrl: storedProof?.url ?? null,
      aiCheckStatus: analysis?.status ?? "needs_review",
      aiCheckNotes: analysis?.summary ?? (storedProof?.url ? "Payment proof received." : "Payment details received."),
      details: {
        analysis: analysis ?? null,
        proofText: paymentText || null,
        storage: storedProof
          ? {
              blobPath: storedProof.blobPath,
              contentType: storedProof.contentType ?? null,
              name: storedProof.name,
            }
          : null,
      },
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const [updatedOrder] = await db
    .update(orders)
    .set({
      status: "payment_submitted",
      paidAmount: submittedAmount,
      updatedAt: now,
    })
    .where(eq(orders.id, orderRow.id))
    .returning();

  if (updatedOrder && paymentRow) {
    await logOrderEvent({
      businessId,
      orderId: updatedOrder.id,
      eventType: "payment_submitted",
      actorType: "bot",
      actorLabel: "bot",
      payload: {
        aiCheckStatus: paymentRow.aiCheckStatus,
        paymentId: paymentRow.id,
        proofUrl: paymentRow.proofUrl,
      },
    });

    await publishPortalEvent({
      businessId,
      entity: "order",
      op: "upsert",
      entityId: updatedOrder.id,
      payload: toPortalPayload({
        order: {
          ...updatedOrder,
          latestPayment: paymentRow,
        },
      }),
      createdAt: updatedOrder.updatedAt ?? now,
    });

    recordBusinessEvent({
      event: "order.payment_submitted",
      action: "internalOrderPaymentProofPost",
      area: "order",
      businessId,
      entity: "order_payment",
      entityId: paymentRow.id,
      actorType: "bot",
      outcome: "success",
      status: paymentRow.aiCheckStatus ?? "submitted",
      source: "api.internal.orders.payment-proof",
      attributes: {
        order_id: updatedOrder.id,
        proof_url_present: Boolean(paymentRow.proofUrl),
      },
    });
  }

  return NextResponse.json({
    success: true,
    orderId: updatedOrder?.id ?? orderRow.id,
    paymentId: paymentRow?.id ?? null,
    proofUrl: paymentRow?.proofUrl ?? storedProof?.url ?? null,
    aiCheckStatus: paymentRow?.aiCheckStatus ?? null,
    aiCheckNotes: paymentRow?.aiCheckNotes ?? null,
  });
}
