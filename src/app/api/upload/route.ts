import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

const ALLOWED_MIME = new Set([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files");

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const uploadDir = path.join(process.cwd(), "uploads");
    await mkdir(uploadDir, { recursive: true });

    const saved: { name: string; size: number }[] = [];

    for (const f of files) {
      if (!(f instanceof File)) continue;
      const mime = f.type || "";
      if (mime && !ALLOWED_MIME.has(mime)) {
        return NextResponse.json(
          { error: `Unsupported file type: ${mime}` },
          { status: 415 }
        );
      }
      const bytes = await f.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = path.join(uploadDir, `${Date.now()}_${safeName}`);
      await writeFile(filePath, buffer);
      saved.push({ name: path.basename(filePath), size: buffer.byteLength });
    }

    return NextResponse.json({ ok: true, files: saved });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Upload failed" }, { status: 500 });
  }
}
