import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { orderPayments, orders, whatsappIdentities } from "@/../drizzle/schema";
import { storePrivateFileAtPath } from "@/lib/storage";
import { publishPortalEvent } from "@/server/realtime/portalEvents";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { isInternalApiAuthorized, normalizeServiceBaseUrl } from "@/server/internalSecurity";
import { logOrderEvent } from "@/server/services/orderFlow";
import { assertOperationThrottle } from "@/server/operationalHardening";
import { resolvePaymentProofAssessment } from "@/server/services/paymentProofSupport";
import { recordAiUsageEvent } from "@/server/services/aiUsage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_PAYMENT_PROOF_FILE_BYTES = Number(process.env.ORDER_PAYMENT_PROOF_MAX_BYTES ?? String(10 * 1024 * 1024));
const ALLOWED_PAYMENT_PROOF_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

type PaymentProofAnalyzerResult = {
  provider: string;
  fallback_reason?: string | null;
  status: "passed" | "needs_review";
  confidence: number;
  summary: string;
  checks: {
    amountMatch: boolean;
    dateFormatValid: boolean;
    dateNotFuture: boolean;
    proofPresent: boolean;
  };
  extracted?: Record<string, unknown>;
};

function didConsumePaymentProofAi(result: PaymentProofAnalyzerResult | null): boolean {
  if (!result) return false;
  const provider = String(result.provider || "").trim().toLowerCase();
  if (provider === "openai") return true;
  const fallbackReason = String(result.fallback_reason || "").trim().toLowerCase();
  return fallbackReason === "model_output_parse_failed";
}

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
  return isInternalApiAuthorized(request, getInternalApiKey());
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
  businessId?: string | null;
  phoneNumberId?: string | null;
  paymentProofUrl?: string | null;
  paymentProofText?: string | null;
}): Promise<PaymentProofAnalyzerResult | null> {
  const baseUrl = normalizeServiceBaseUrl(String(process.env.BOT_INTERNAL_BASE_URL || ""));
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
      businessId: input.businessId ?? undefined,
      phoneNumberId: input.phoneNumberId ?? undefined,
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
  const stagedProofUrl = String(formData.get("stagedProofUrl") || "").trim();
  const stagedBlobPath = String(formData.get("stagedBlobPath") || "").trim();
  const stagedFileName = String(formData.get("stagedFileName") || "").trim();
  const stagedMimeType = String(formData.get("stagedMimeType") || "").trim();
  const hasStagedProof = Boolean(stagedProofUrl);

  if (!businessId || !orderId) {
    return NextResponse.json({ success: false, error: "businessId and orderId are required." }, { status: 400 });
  }
  if (!(file instanceof File) && !paymentText && !hasStagedProof) {
    return NextResponse.json(
      { success: false, error: "Payment proof file, staged proof, or text is required." },
      { status: 400 },
    );
  }
  if (paymentText.length > 12_000) {
    return NextResponse.json({ success: false, error: "Payment proof text is too large." }, { status: 400 });
  }

  await assertOperationThrottle(db, {
    businessId,
    bucket: "internal.order_payment_proof.business",
    scope: businessId,
    max: Number(process.env.ORDER_PAYMENT_PROOF_BUSINESS_MAX ?? "120"),
    windowMs: Number(process.env.ORDER_PAYMENT_PROOF_BUSINESS_WINDOW_MS ?? String(5 * 60 * 1000)),
    message: "Too many payment proof submissions were received. Please wait and try again.",
  });
  await assertOperationThrottle(db, {
    businessId,
    bucket: "internal.order_payment_proof.order",
    scope: `${businessId}:${orderId}`,
    max: Number(process.env.ORDER_PAYMENT_PROOF_ORDER_MAX ?? "8"),
    windowMs: Number(process.env.ORDER_PAYMENT_PROOF_ORDER_WINDOW_MS ?? String(10 * 60 * 1000)),
    message: "Too many payment proof submissions were received for this order. Please wait and try again.",
  });

  const [orderRow] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.businessId, businessId), eq(orders.id, orderId)))
    .limit(1);
  if (!orderRow) {
    return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
  }
  const [identityRow] = orderRow.whatsappIdentityId
    ? await db
        .select({
          aiDisabled: whatsappIdentities.aiDisabled,
        })
        .from(whatsappIdentities)
        .where(and(eq(whatsappIdentities.businessId, businessId), eq(whatsappIdentities.phoneNumberId, orderRow.whatsappIdentityId)))
        .limit(1)
    : [{ aiDisabled: false }];

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
    if (file.size > MAX_PAYMENT_PROOF_FILE_BYTES) {
      return NextResponse.json({ success: false, error: "Payment proof file is too large." }, { status: 400 });
    }
    const normalizedType = String(file.type || "").trim().toLowerCase();
    if (normalizedType && !ALLOWED_PAYMENT_PROOF_TYPES.has(normalizedType)) {
      return NextResponse.json({ success: false, error: "Unsupported payment proof file type." }, { status: 400 });
    }
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    storedProof = await storePrivateFileAtPath({
      blobPath: `${businessId}/order-payments/${orderId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
      buffer,
      fileName: file.name,
      contentType: file.type || undefined,
      readTtlHours: 24 * 7,
    });
  } else if (hasStagedProof) {
    storedProof = {
      url: stagedProofUrl,
      blobPath: stagedBlobPath,
      contentType: stagedMimeType || undefined,
      name: stagedFileName || "staged-payment-proof",
    };
  }

  const analysis = identityRow?.aiDisabled
    ? null
    : await analyzePaymentProof({
        businessId,
        phoneNumberId: orderRow.whatsappIdentityId ?? null,
        expectedAmount: toMoneyString(orderRow.expectedAmount),
        currency: String(orderRow.currency || "LKR").trim() || "LKR",
        expectedReference: String(orderRow.paymentReference || "").trim() || null,
        paymentProofUrl: storedProof?.url ?? null,
        paymentProofText: paymentText || null,
      });

  if (didConsumePaymentProofAi(analysis) && !identityRow?.aiDisabled) {
    await recordAiUsageEvent({
      businessId,
      whatsappIdentityId: orderRow.whatsappIdentityId ?? null,
      customerId: orderRow.customerId ?? null,
      threadId: orderRow.threadId ?? null,
      eventType: "payment_proof_ai_analysis",
      source: "order_payment_proof_route",
      credits: 1,
      metadata: { orderId },
    });
  }

  const submittedAmount = toMoneyString(analysis?.extracted?.amount) ?? null;
  const assessed = resolvePaymentProofAssessment({
    analysis,
    expectedAmount: toMoneyString(orderRow.expectedAmount),
    paidAmount: submittedAmount,
    currency: String(orderRow.currency || "LKR").trim() || "LKR",
  });
  const aiCheckStatus = assessed.aiCheckStatus;
  const aiCheckNotes = assessed.aiCheckNotes || (storedProof?.url ? "Payment proof received." : "Payment details received.");
  const now = new Date();
  const txResult = await db.transaction(async (tx) => {
    const [paymentRow] = await tx
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
        aiCheckStatus,
        aiCheckNotes,
        details: {
          analysis: analysis ?? null,
          paymentBalance: assessed.balance,
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

    const [updatedOrder] = await tx
      .update(orders)
      .set({
        status: "payment_submitted",
        paidAmount: submittedAmount,
        updatedAt: now,
      })
      .where(eq(orders.id, orderRow.id))
      .returning();

    return { paymentRow, updatedOrder };
  });
  const { paymentRow, updatedOrder } = txResult;

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
    paymentBalance: assessed.balance,
  });
}
