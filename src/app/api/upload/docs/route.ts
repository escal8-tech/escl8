import { NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import path from "path";
import { db } from "@/server/db/client";
import { users } from "@/../drizzle/schema";
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

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function rootDir() {
  return path.join(process.cwd(), "uploads");
}

async function listCurrent(businessId: string) {
  const base = path.join(rootDir(), businessId);
  const out: Record<DocType, { name: string; size: number } | null> = {
    considerations: null,
    conversations: null,
    inventory: null,
    bank: null,
    address: null,
  } as any;
  for (const key of Object.keys(out) as DocType[]) {
    const dir = path.join(base, key);
    try {
      const files = await readdir(dir);
      // choose the latest by mtime
      let best: { name: string; size: number; mtimeMs: number } | null = null;
      for (const f of files) {
        const fp = path.join(dir, f);
        const st = await stat(fp);
        if (st.isFile()) {
          const rec = { name: f, size: st.size, mtimeMs: st.mtimeMs };
          if (!best || rec.mtimeMs > best.mtimeMs) best = rec;
        }
      }
      out[key] = best ? { name: best.name, size: best.size } : null;
    } catch {}
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

    // Storage is handled by storeFile (Azure/local). No need to prepare local dirs here.

      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const stored = await storeFile(businessId, docType, file.name, buffer);
  const latest = await listCurrent(businessId);
      // Prefer just-uploaded file if listing doesn't reflect azure immediately
      return NextResponse.json({ ok: true, file: latest[docType] || stored });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Upload failed" }, { status: 500 });
  }
}
