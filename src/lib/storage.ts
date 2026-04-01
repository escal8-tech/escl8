import {
  BlobSASPermissions,
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import type { DocType } from "@/lib/rag-documents";

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

function parseConnectionString(connectionString: string): { accountName: string; accountKey: string } | null {
  const accountNameMatch = connectionString.match(/AccountName=([^;]+)/);
  const accountKeyMatch = connectionString.match(/AccountKey=([^;]+)/);
  if (!accountNameMatch || !accountKeyMatch) return null;
  return {
    accountName: accountNameMatch[1],
    accountKey: accountKeyMatch[1],
  };
}

function buildReadUrl(blobUrl: string, blobPath: string, expiresOn: Date): string {
  const creds = parseConnectionString(AZURE_CONN);
  if (!creds) return blobUrl;
  const sharedKey = new StorageSharedKeyCredential(creds.accountName, creds.accountKey);
  const sas = generateBlobSASQueryParameters(
    {
      containerName: AZURE_CONTAINER,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse("r"),
      expiresOn,
    },
    sharedKey,
  ).toString();
  return `${blobUrl}?${sas}`;
}

export function buildPrivateBlobReadUrl(blobPath: string, readTtlHours = 72): string | null {
  const normalizedPath = String(blobPath || "").trim();
  if (!AZURE_CONN || !normalizedPath) return null;
  const service = BlobServiceClient.fromConnectionString(AZURE_CONN);
  const container = service.getContainerClient(AZURE_CONTAINER);
  const blob = container.getBlockBlobClient(normalizedPath);
  return buildReadUrl(
    blob.url,
    normalizedPath,
    new Date(Date.now() + Math.max(1, Number(readTtlHours || 72)) * 60 * 60 * 1000),
  );
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

export async function storePrivateFileAtPath(params: {
  blobPath: string;
  buffer: Buffer;
  fileName: string;
  contentType?: string;
  readTtlHours?: number;
}): Promise<StoredFile> {
  if (!AZURE_CONN) {
    throw new Error("Missing AZURE_BLOB_CONNECTION_STRING (blob storage is required)");
  }

  const service = BlobServiceClient.fromConnectionString(AZURE_CONN);
  const container = service.getContainerClient(AZURE_CONTAINER);
  await container.createIfNotExists();
  const blockBlob = container.getBlockBlobClient(params.blobPath);
  await blockBlob.uploadData(params.buffer, {
    blobHTTPHeaders: { blobContentType: params.contentType || undefined },
  });
  const props = await blockBlob.getProperties();
  const readUrl = buildReadUrl(
    blockBlob.url,
    params.blobPath,
    new Date(Date.now() + Math.max(1, Number(params.readTtlHours ?? 72)) * 60 * 60 * 1000),
  );

  return {
    name: safeName(params.fileName),
    size: Number(props.contentLength || params.buffer.byteLength),
    url: readUrl,
    blobPath: params.blobPath,
    contentType: params.contentType || props.contentType || undefined,
  };
}
