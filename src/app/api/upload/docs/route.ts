/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { trainingDocuments, users } from "@/../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { storeFile } from "@/lib/storage";
import { verifyFirebaseIdToken } from "@/server/firebaseAdmin";
import { checkRateLimit } from "@/server/rateLimit";
import { publishPortalEvent, toPortalDocumentPayload } from "@/server/realtime/portalEvents";
import { captureSentryException, recordSentryLog, recordSentryMetric } from "@/lib/sentry-monitoring";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { buildDocTypeRecord, INDEXING_STATUS, isDocType, type DocType } from "@/lib/rag-documents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_MIME = new Set([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
]);
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ALLOWED_EXT = [".pdf", ".txt", ".doc", ".docx", ".csv"];

const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB
function maxUploadBytes() {
  const n = Number(process.env.MAX_UPLOAD_BYTES ?? "");
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_UPLOAD_BYTES;
}

async function listCurrent(businessId: string) {
  const out = buildDocTypeRecord<{
    name: string;
    size: number;
    indexingStatus: string;
    lastIndexedAt: string | null;
    lastError: string | null;
    uploadedAt: string | null;
  } | null>(() => null);

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
      indexingStatus: String(row.indexingStatus ?? INDEXING_STATUS.NOT_INDEXED),
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
    const firebaseUid = decoded.uid;
    if (!email || !firebaseUid) return null;

    let user = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid)).then((rows) => rows[0] ?? null);
    if (!user) {
      user = await db.select().from(users).where(eq(users.email, email)).then((rows) => rows[0] ?? null);
      if (user && !user.firebaseUid) {
        const repaired = await db
          .update(users)
          .set({ firebaseUid, updatedAt: new Date() })
          .where(and(eq(users.id, user.id), eq(users.email, email)))
          .returning();
        user = repaired[0] ?? user;
      }
    }

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
  let businessId: string | null = null;
  let docType: DocType | null = null;
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
    docType = (formData.get("docType") as string) as DocType;
    businessId = await getAuthedBusinessId(request);
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
    if (!isDocType(docType)) {
      return NextResponse.json({ error: "Invalid docType" }, { status: 400 });
    }

    const mime = (file.type || "").toLowerCase();
    const lowerName = file.name.toLowerCase();
    const isXlsx = mime === XLSX_MIME || lowerName.endsWith(".xlsx");

    if (isXlsx && docType !== "inventory") {
      return NextResponse.json({ error: "XLSX uploads are only supported for inventory documents" }, { status: 415 });
    }

    if (!isXlsx) {
      const extAllowed = ALLOWED_EXT.some((ext) => lowerName.endsWith(ext));
      const mimeAllowed = !mime || ALLOWED_MIME.has(mime);
      const shouldReject = mime ? (!mimeAllowed && !extAllowed) : !extAllowed;
      if (shouldReject) {
        const detail = mime || file.name || "unknown";
        return NextResponse.json({ error: `Unsupported file type: ${detail}` }, { status: 415 });
      }
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const stored = await storeFile(businessId, docType, file.name, buffer, file.type || undefined);

    const now = new Date();
    const [savedDoc] = await db
      .insert(trainingDocuments)
      .values({
        businessId,
        docType,
        blobPath: stored.blobPath,
        blobUrl: stored.url,
        originalFilename: file.name,
        contentType: stored.contentType ?? file.type ?? null,
        sizeBytes: stored.size,
        indexingStatus: INDEXING_STATUS.NOT_INDEXED,
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
          indexingStatus: INDEXING_STATUS.NOT_INDEXED,
          lastError: null,
          updatedAt: now,
          uploadedAt: now,
        },
      })
      .returning();

    if (savedDoc) {
      await publishPortalEvent({
        businessId,
        entity: "document",
        op: "upsert",
        entityId: savedDoc.id,
        payload: { document: toPortalDocumentPayload(savedDoc as any) as any },
        createdAt: savedDoc.updatedAt ?? now,
      });
    }

    const latest = await listCurrent(businessId);
    recordSentryMetric("count", "escl8.upload.docs.success", 1, {
      area: "upload",
      business_id: businessId,
      doc_type: docType,
    });
    recordSentryLog("info", "portal document uploaded", {
      area: "upload",
      business_id: businessId,
      doc_type: docType,
      file_name: file.name,
      file_size: stored.size,
    });
    recordBusinessEvent({
      event: "upload.document_uploaded",
      action: "upload",
      area: "upload",
      businessId,
      entity: "training_document",
      entityId: savedDoc?.id,
      source: "api.upload.docs",
      outcome: "success",
      status: "uploaded",
      attributes: {
        doc_type: docType,
        file_name: file.name,
        file_size: stored.size,
      },
    });
    return NextResponse.json(
      { ok: true, file: latest[docType] ?? { name: file.name, size: stored.size } },
      { headers: rl.headers },
    );
  } catch (err: any) {
    recordSentryMetric("count", "escl8.upload.docs.errors", 1, {
      area: "upload",
      business_id: businessId,
      doc_type: docType,
    });
    recordBusinessEvent({
      event: "upload.document_upload_failed",
      level: "error",
      action: "upload",
      area: "upload",
      businessId,
      entity: "training_document",
      source: "api.upload.docs",
      outcome: "failed",
      status: "error",
      attributes: {
        doc_type: docType,
      },
    });
    captureSentryException(err, {
      action: "upload-docs-post",
      area: "upload",
      contexts: {
        upload: {
          businessId,
          docType,
        },
      },
      level: "error",
      tags: {
        "escal8.business_id": businessId,
        "upload.doc_type": docType,
      },
    });
    return NextResponse.json({ error: err?.message || "Upload failed" }, { status: 500 });
  }
}
