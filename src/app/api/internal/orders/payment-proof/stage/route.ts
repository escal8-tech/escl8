import { NextResponse } from "next/server";
import { storePrivateFileAtPath } from "@/lib/storage";
import { isInternalApiAuthorized } from "@/server/internalSecurity";

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

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const businessId = String(formData.get("businessId") || "").trim();
  const file = formData.get("file");

  if (!businessId) {
    return NextResponse.json({ success: false, error: "businessId is required." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "Payment proof file is required." }, { status: 400 });
  }
  if (file.size > MAX_PAYMENT_PROOF_FILE_BYTES) {
    return NextResponse.json({ success: false, error: "Payment proof file is too large." }, { status: 400 });
  }

  const normalizedType = String(file.type || "").trim().toLowerCase();
  if (normalizedType && !ALLOWED_PAYMENT_PROOF_TYPES.has(normalizedType)) {
    return NextResponse.json({ success: false, error: "Unsupported payment proof file type." }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const stored = await storePrivateFileAtPath({
    blobPath: `${businessId}/order-payments/staged/${Date.now()}-${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
    buffer: Buffer.from(arrayBuffer),
    fileName: file.name,
    contentType: file.type || undefined,
    readTtlHours: 24 * 7,
  });

  return NextResponse.json({
    success: true,
    stagedProofUrl: stored.url,
    stagedBlobPath: stored.blobPath,
    stagedFileName: stored.name,
    stagedMimeType: stored.contentType ?? null,
  });
}
