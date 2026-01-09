import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { trainingDocuments, users } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import { storeFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

type DocType = "considerations" | "conversations" | "inventory" | "bank" | "address";
const ALLOWED_MIME = new Set([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
]);

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

export async function GET(request: Request) {
  const email = request.headers.get("x-user-email") || undefined;
  let businessId: string | null = null;
  if (email) {
    try {
      const rows = await db.select().from(users).where(eq(users.email, email));
      const user = rows[0];
      if (user?.businessId) businessId = user.businessId as string;
    } catch {}
  }
  const files = businessId ? await listCurrent(businessId) : {
    considerations: null,
    conversations: null,
    inventory: null,
    bank: null,
    address: null,
  } as any;
  return NextResponse.json({ ok: true, businessId, files });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const docType = (formData.get("docType") as string) as DocType;
    const email = request.headers.get("x-user-email") || undefined;
    let businessId: string | null = null;
    if (email) {
      try {
        const rows = await db.select().from(users).where(eq(users.email, email));
        const user = rows[0];
        if (user?.businessId) businessId = user.businessId as string;
      } catch {}
    }
    if (!businessId) {
      return NextResponse.json({ error: "Business ID not set for user" }, { status: 400 });
    }

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
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
    return NextResponse.json({ ok: true, file: latest[docType] ?? { name: file.name, size: stored.size } });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Upload failed" }, { status: 500 });
  }
}
