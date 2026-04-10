import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { storePrivateFileAtPath } from "@/lib/storage";
import { isInternalApiAuthorized } from "@/server/internalSecurity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getInternalApiKey(): string {
  return String(
    process.env.BOT_INTERNAL_API_KEY ||
      process.env.WHATSAPP_API_KEY ||
      process.env.PAYMENT_PROOF_ANALYZER_API_KEY ||
      "",
  ).trim();
}

function safeName(name: string): string {
  return String(name || "").replace(/[^a-zA-Z0-9._-]/g, "_") || "media";
}

export async function POST(request: Request) {
  if (!isInternalApiAuthorized(request, getInternalApiKey())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const businessId = String(formData.get("businessId") || "").trim();
  const phoneNumberId = String(formData.get("phoneNumberId") || "").trim() || "unknown";
  const mediaType = String(formData.get("mediaType") || "").trim().toLowerCase();
  const file = formData.get("file");

  if (!businessId || !(file instanceof File)) {
    return NextResponse.json({ success: false, error: "businessId and file are required." }, { status: 400 });
  }

  const rawName = safeName(file.name || `${mediaType || "media"}`);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const stored = await storePrivateFileAtPath({
    blobPath: `${businessId}/thread-media/${phoneNumberId}/${Date.now()}-${crypto.randomUUID()}-${rawName}`,
    buffer,
    fileName: rawName,
    contentType: file.type || undefined,
    readTtlHours: 24 * 30,
  });

  return NextResponse.json({
    success: true,
    mediaUrl: stored.url,
    blobPath: stored.blobPath,
    fileName: stored.name,
    mimeType: stored.contentType || file.type || null,
    mediaType: mediaType || "document",
  });
}
