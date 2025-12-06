import path from "path";
import { mkdir, writeFile, stat, readdir, unlink } from "fs/promises";
import { BlobServiceClient } from "@azure/storage-blob";

type DocType = "considerations" | "conversations" | "inventory" | "bank" | "address";

const PROVIDER = process.env.STORAGE_PROVIDER || "local"; // "azure" | "local"
const AZURE_CONN = process.env.AZURE_BLOB_CONNECTION_STRING || "";
const AZURE_CONTAINER = process.env.AZURE_BLOB_CONTAINER || "uploads";

export type StoredFile = { name: string; size: number; url?: string };

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function storeFile(
  businessId: string,
  docType: DocType,
  fileName: string,
  buffer: Buffer
): Promise<StoredFile> {
  const name = `${Date.now()}_${safeName(fileName)}`;

  if (PROVIDER.toLowerCase() === "azure" && AZURE_CONN) {
    const service = BlobServiceClient.fromConnectionString(AZURE_CONN);
    const container = service.getContainerClient(AZURE_CONTAINER);
    await container.createIfNotExists();
    // Overwrite policy: keep only one blob per docType; delete any existing under prefix
    const prefix = `${businessId}/${docType}/`;
    for await (const blob of container.listBlobsFlat({ prefix })) {
      const del = container.getBlobClient(blob.name);
      await del.deleteIfExists();
    }
    const blobPath = `${businessId}/${docType}/${name}`;
    const blockBlob = container.getBlockBlobClient(blobPath);
    await blockBlob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: undefined } });
    const props = await blockBlob.getProperties();
    return { name, size: Number(props.contentLength || buffer.byteLength), url: blockBlob.url };
  }

  // Local fallback
  const base = path.join(process.cwd(), "uploads", businessId, docType);
  await mkdir(base, { recursive: true });
  // Overwrite policy: delete existing files in this folder
  try {
    const files = await readdir(base);
    await Promise.all(files.map(async (f) => {
      const fp = path.join(base, f);
      try { await unlink(fp); } catch {}
    }));
  } catch {}
  const fp = path.join(base, name);
  await writeFile(fp, buffer);
  const st = await stat(fp);
  return { name, size: st.size };
}

export function getLocalUploadsDir(biz: string, doc: DocType) {
  return path.join(process.cwd(), "uploads", biz, doc);
}
