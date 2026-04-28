import { NextResponse } from "next/server";
import { getAuthedUserFromRequest } from "@/server/apiAuth";
import { storePrivateFileAtPath } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_LOGO_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_LOGO_FILE_BYTES = Number(process.env.CUSTOMIZATION_LOGO_MAX_BYTES ?? String(5 * 1024 * 1024));
const CUSTOMIZATION_CONTAINER = process.env.AGENT_CUSTOMIZATION_BLOB_CONTAINER || "agent-customization";

export async function POST(request: Request) {
  const auth = await getAuthedUserFromRequest(request);
  if (!auth?.businessId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Logo image file is required." }, { status: 400 });
  }
  if (file.size > MAX_LOGO_FILE_BYTES) {
    return NextResponse.json({ error: "Logo image is too large." }, { status: 400 });
  }

  const normalizedType = String(file.type || "").trim().toLowerCase();
  if (!normalizedType || !ALLOWED_LOGO_TYPES.has(normalizedType)) {
    return NextResponse.json({ error: "Unsupported logo image type." }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const stored = await storePrivateFileAtPath({
    blobPath: `${auth.businessId}/customization/logo/${Date.now()}-${crypto.randomUUID()}-${safeName}`,
    buffer: Buffer.from(bytes),
    fileName: file.name,
    contentType: normalizedType,
    readTtlHours: 24 * 30,
    containerName: CUSTOMIZATION_CONTAINER,
  });

  return NextResponse.json({
    ok: true,
    logoUrl: stored.url,
    logoBlobPath: stored.blobPath,
    logoContainer: stored.containerName || CUSTOMIZATION_CONTAINER,
    fileName: stored.name,
    contentType: stored.contentType ?? normalizedType,
  });
}
