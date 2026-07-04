import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { publishEvent } from "@/lib/eventgrid";
import { getAuthedUserFromRequest } from "@/server/apiAuth";

export const dynamic = "force-dynamic";

const ALLOWED_MIME = new Set([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(request: Request) {
  const auth = await getAuthedUserFromRequest(request);
  if (!auth?.businessId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const businessId = auth.businessId;

  try {
    const formData = await request.formData();
    const files = formData.getAll("files");

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const uploadDir = path.join(process.cwd(), "uploads", businessId.replace(/[^a-zA-Z0-9_-]/g, "_"));
    await mkdir(uploadDir, { recursive: true });

    const saved: { name: string; size: number }[] = [];

    for (const f of files) {
      if (!(f instanceof File)) continue;

      if (f.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File too large: ${f.name}. Max size is 10MB.` },
          { status: 413 }
        );
      }

      const mime = f.type || "";
      if (mime && !ALLOWED_MIME.has(mime)) {
        return NextResponse.json(
          { error: `Unsupported file type: ${mime}` },
          { status: 415 }
        );
      }

      const bytes = await f.arrayBuffer();
      const buffer = Buffer.from(bytes);

      // Enhanced sanitization: strip everything except alphanumeric, dots, and dashes.
      const safeName = f.name
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/\.{2,}/g, ".") // Prevent directory traversal via ".."
        .replace(/^_+|_+$/g, "");

      const fileName = `${Date.now()}_${safeName}`;
      const filePath = path.join(uploadDir, fileName);

      // Verify that the resolved path is still within the uploadDir (extra protection)
      if (!filePath.startsWith(uploadDir)) {
        throw new Error("Invalid file path");
      }

      await writeFile(filePath, buffer);
      saved.push({ name: fileName, size: buffer.byteLength });
    }

    for (const file of saved) {
      await publishEvent("file.uploaded", "file_upload", {
        fileName: file.name,
        fileSize: file.size,
        timestamp: new Date().toISOString()
      });
    }

    return NextResponse.json({ ok: true, files: saved });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
