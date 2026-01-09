import { BlobServiceClient } from "@azure/storage-blob";

export type BlobObject = {
  blobPath: string;
  buffer: Buffer;
  contentType?: string;
};

function getAzure() {
  const conn = process.env.AZURE_BLOB_CONNECTION_STRING;
  const containerName = process.env.AZURE_BLOB_CONTAINER || "uploads";
  if (!conn) {
    throw new Error("Missing AZURE_BLOB_CONNECTION_STRING");
  }
  const service = BlobServiceClient.fromConnectionString(conn);
  const container = service.getContainerClient(containerName);
  return { container };
}

export async function downloadBlobToBuffer(blobPath: string): Promise<BlobObject> {
  const { container } = getAzure();
  const blob = container.getBlobClient(blobPath);
  console.log(`[rag:blob] download blobPath=${blobPath}`);
  const buf = await blob.downloadToBuffer();
  const props = await blob.getProperties();
  console.log(`[rag:blob] downloaded bytes=${buf.length} contentType=${props.contentType || "unknown"}`);
  return {
    blobPath,
    buffer: buf,
    contentType: props.contentType || undefined,
  };
}
