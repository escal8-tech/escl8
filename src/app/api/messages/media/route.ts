import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { storePrivateFileAtPath } from "@/lib/storage";
import { getAuthedUserFromRequest } from "@/server/apiAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_MEDIA_FILE_BYTES = Number(process.env.PORTAL_MESSAGE_MEDIA_MAX_BYTES ?? String(15 * 1024 * 1024));
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

function safeName(name: string): string {
  return String(name || "").replace(/[^a-zA-Z0-9._-]/g, "_") || "media";
}

export async function POST(request: Request) {
  const authed = await getAuthedUserFromRequest(request);
  if (!authed?.businessId) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const phoneNumberId = String(formData.get("phoneNumberId") || "").trim() || "unknown";
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "file is required." }, { status: 400 });
  }
  if (file.size > MAX_MEDIA_FILE_BYTES) {
    return NextResponse.json({ success: false, error: "File is too large." }, { status: 400 });
  }

  const mimeType = String(file.type || "").trim().toLowerCase();
  const inferredType = mimeType.startsWith("image/") ? "image" : "document";
  const allowed = inferredType === "image" ? ALLOWED_IMAGE_TYPES : ALLOWED_DOCUMENT_TYPES;
  if (mimeType && !allowed.has(mimeType)) {
    return NextResponse.json({ success: false, error: "Unsupported file type." }, { status: 400 });
  }

  const rawName = safeName(file.name || `${inferredType}`);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const stored = await storePrivateFileAtPath({
    blobPath: `${authed.businessId}/portal-message-media/${phoneNumberId}/${Date.now()}-${crypto.randomUUID()}-${rawName}`,
    buffer,
    fileName: rawName,
    contentType: file.type || undefined,
    readTtlHours: 24 * 30,
  });

  return NextResponse.json({
    success: true,
    mediaType: inferredType,
    mediaUrl: stored.url,
    blobPath: stored.blobPath,
    fileName: stored.name,
    mimeType: stored.contentType || file.type || null,
    size: stored.size,
  });
}
