import { BlobServiceClient } from "@azure/storage-blob";

type DocType = "considerations" | "conversations" | "inventory" | "bank" | "address";

const AZURE_CONN = process.env.AZURE_BLOB_CONNECTION_STRING || "";
const AZURE_CONTAINER = process.env.AZURE_BLOB_CONTAINER || "uploads";

export type StoredFile = {
  name: string;
  size: number;
  url: string;
  blobPath: string;
  contentType?: string;
};

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function storeFile(
  businessId: string,
  docType: DocType,
  fileName: string,
  buffer: Buffer,
  contentType?: string
): Promise<StoredFile> {
  if (!AZURE_CONN) {
    throw new Error("Missing AZURE_BLOB_CONNECTION_STRING (blob storage is required)");
  }

  const ext = (() => {
    const base = safeName(fileName);
    const dot = base.lastIndexOf(".");
    return dot >= 0 ? base.slice(dot) : "";
  })();

  // Stable path: always keep only ONE latest blob per business+docType.
  const blobPath = `${businessId}/${docType}/latest${ext}`;

  const service = BlobServiceClient.fromConnectionString(AZURE_CONN);
  const container = service.getContainerClient(AZURE_CONTAINER);
  await container.createIfNotExists();
  const blockBlob = container.getBlockBlobClient(blobPath);
  await blockBlob.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType || undefined },
  });
  const props = await blockBlob.getProperties();
  return {
    name: `latest${ext}`,
    size: Number(props.contentLength || buffer.byteLength),
    url: blockBlob.url,
    blobPath,
    contentType: contentType || props.contentType || undefined,
  };
}
