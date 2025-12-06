import { NextResponse } from "next/server";
import path from "path";
import { spawn } from "child_process";
import { readdir } from "fs/promises";
import { db } from "@/server/db/client";
import { users } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import os from "os";
import fs from "fs";
import { BlobServiceClient } from "@azure/storage-blob";

export const dynamic = "force-dynamic";

type DocType = "considerations" | "conversations" | "inventory" | "bank" | "address";

function uploadsDir(biz: string, doc: DocType) {
  return path.join(process.cwd(), "uploads", biz, doc);
}

function pythonExe() {
  // Allow override via env if needed
  return process.env.PYTHON_PATH || "python"; // On Windows, ensure Python is on PATH
}

async function gatherPaths(biz: string, doc: DocType) {
  const provider = process.env.STORAGE_PROVIDER || "local";
  if (provider.toLowerCase() === "azure" && process.env.AZURE_BLOB_CONNECTION_STRING) {
    // Download blobs to temp files and return local paths
    const service = BlobServiceClient.fromConnectionString(process.env.AZURE_BLOB_CONNECTION_STRING as string);
    const container = service.getContainerClient(process.env.AZURE_BLOB_CONTAINER || "uploads");
    const prefix = `${biz}/${doc}/`;
    const out: string[] = [];
    for await (const blob of container.listBlobsFlat({ prefix })) {
      const client = container.getBlobClient(blob.name);
      const tmp = path.join(os.tmpdir(), `escl8_${safeFile(blob.name)}`);
      const buf = await client.downloadToBuffer();
      await fs.promises.writeFile(tmp, buf);
      out.push(tmp);
    }
    return out;
  }
  const dir = uploadsDir(biz, doc);
  try {
    const files = await readdir(dir);
    return files.map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function safeFile(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
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
    const docType = (body.docType as DocType);
    if (!docType || !["considerations","conversations","inventory","bank","address"].includes(docType)) {
      return NextResponse.json({ error: "Invalid docType" }, { status: 400 });
    }

    const paths = await gatherPaths(businessId, docType);
    if (paths.length === 0) {
      return NextResponse.json({ error: `No uploaded files for ${docType}` }, { status: 404 });
    }

    const script = path.join(process.cwd(), "scripts", "index_documents.py");

    // We pass only the selected docType paths; script will infer type and index accordingly
  const args = [script, ...paths, "--business-id", businessId, "--purge-doc-type", docType];

    const py = spawn(pythonExe(), args, { cwd: process.cwd(), env: process.env });

    let output = "";
    let error = "";
    py.stdout.on("data", (d) => (output += d.toString()));
    py.stderr.on("data", (d) => (error += d.toString()));

    const done: Promise<number> = new Promise((resolve) => {
      py.on("close", (code) => resolve(code ?? 0));
    });

    const code = await done;
    const message = `Index script exited with code ${code}`;
    const payload = { ok: code === 0, message, output: output.slice(-4000) };

    if (code !== 0) {
      // Include tail of stderr for debugging
      return NextResponse.json({ ...payload, error: error.slice(-4000) }, { status: 500 });
    }

    return NextResponse.json(payload);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Retrain failed" }, { status: 500 });
  }
}
