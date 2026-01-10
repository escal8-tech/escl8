import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { trainingDocuments, users } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import { storeFile } from "@/lib/storage";
import { verifyFirebaseIdToken } from "@/server/firebaseAdmin";
import { checkRateLimit } from "@/server/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DocType = "considerations" | "conversations" | "inventory" | "bank" | "address";
const ALLOWED_MIME = new Set([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
]);

const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB
function maxUploadBytes() {
  const n = Number(process.env.MAX_UPLOAD_BYTES ?? "");
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_UPLOAD_BYTES;
}

async function listCurrent(businessId: string) {
  const out: Record<DocType, {
    name: string;
    size: number;
    indexingStatus: string;
    lastIndexedAt: string | null;
    lastError: string | null;
    uploadedAt: string | null;
  } | null> = {
    considerations: null,
    conversations: null,
    inventory: null,
    bank: null,
    address: null,
  };

  const rows = await db
    .select()
    .from(trainingDocuments)
    .where(eq(trainingDocuments.businessId, businessId));

  for (const row of rows) {
    const dt = row.docType as DocType;
    if (!dt || !(dt in out)) continue;
    const name = row.originalFilename || row.blobPath.split("/").slice(-1)[0] || "latest";
    const size = Number(row.sizeBytes ?? 0);
    out[dt] = {
      name,
      size,
      indexingStatus: String(row.indexingStatus ?? "not_indexed"),
      lastIndexedAt: row.lastIndexedAt ? new Date(row.lastIndexedAt as any).toISOString() : null,
      lastError: (row.lastError as any) ?? null,
      uploadedAt: row.uploadedAt ? new Date(row.uploadedAt as any).toISOString() : null,
    };
  }

  return out;
}

async function getAuthedBusinessId(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  try {
    const decoded = await verifyFirebaseIdToken(m[1]);
    const email = decoded.email;
    if (!email) return null;
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return (user?.businessId as string) ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  // Polling endpoint: allow relatively high volume.
  const rl = checkRateLimit(request, {
    name: "upload_docs_get",
    max: Number(process.env.RATE_LIMIT_UPLOAD_DOCS_GET_MAX ?? "120"),
    windowMs: Number(process.env.RATE_LIMIT_UPLOAD_DOCS_GET_WINDOW_MS ?? String(60_000)),
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too Many Requests" },
      {
        status: 429,
        headers: {
          ...rl.headers,
          "retry-after": String(Math.max(1, Math.ceil((rl.resetAtMs - Date.now()) / 1000))),
        },
      },
    );
  }

  const businessId = await getAuthedBusinessId(request);
  if (!businessId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const files = await listCurrent(businessId);
  return NextResponse.json({ ok: true, businessId, files }, { headers: rl.headers });
}

export async function POST(request: Request) {
  try {
    // Upload endpoint: stricter.
    const rl = checkRateLimit(request, {
      name: "upload_docs_post",
      max: Number(process.env.RATE_LIMIT_UPLOAD_DOCS_POST_MAX ?? "20"),
      windowMs: Number(process.env.RATE_LIMIT_UPLOAD_DOCS_POST_WINDOW_MS ?? String(60_000)),
    });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too Many Requests" },
        {
          status: 429,
          headers: {
            ...rl.headers,
            "retry-after": String(Math.max(1, Math.ceil((rl.resetAtMs - Date.now()) / 1000))),
          },
        },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const docType = (formData.get("docType") as string) as DocType;
    const businessId = await getAuthedBusinessId(request);
    if (!businessId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const maxBytes = maxUploadBytes();
    if (Number.isFinite(file.size) && file.size > maxBytes) {
      return NextResponse.json(
        { error: `File too large. Max allowed is ${maxBytes} bytes.` },
        { status: 413 },
      );
    }
    if (!docType || !["considerations","conversations","inventory","bank","address"].includes(docType)) {
      return NextResponse.json({ error: "Invalid docType" }, { status: 400 });
    }

    const mime = file.type || "";
    if (mime && !ALLOWED_MIME.has(mime)) {
      return NextResponse.json({ error: `Unsupported file type: ${mime}` }, { status: 415 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const stored = await storeFile(businessId, docType, file.name, buffer, file.type || undefined);

    const now = new Date();
    await db
      .insert(trainingDocuments)
      .values({
        businessId,
        docType,
        blobPath: stored.blobPath,
        blobUrl: stored.url,
        originalFilename: file.name,
        contentType: stored.contentType ?? file.type ?? null,
        sizeBytes: stored.size,
        indexingStatus: "not_indexed",
        uploadedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [trainingDocuments.businessId, trainingDocuments.docType],
        set: {
          blobPath: stored.blobPath,
          blobUrl: stored.url,
          originalFilename: file.name,
          contentType: stored.contentType ?? file.type ?? null,
          sizeBytes: stored.size,
          indexingStatus: "not_indexed",
          lastError: null,
          updatedAt: now,
          uploadedAt: now,
        },
      });

    const latest = await listCurrent(businessId);
    return NextResponse.json(
      { ok: true, file: latest[docType] ?? { name: file.name, size: stored.size } },
      { headers: rl.headers },
    );
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Upload failed" }, { status: 500 });
  }
}
