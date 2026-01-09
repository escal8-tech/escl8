import crypto from "crypto";
import { downloadBlobToBuffer } from "./blob";
import { extractTextFromBuffer } from "./extractText";
import { chunkText } from "./chunk";
import { embedTexts } from "./embed";
import { getPineconeIndex } from "./pinecone";

export type DocType = "considerations" | "conversations" | "inventory" | "bank" | "address";

function sha256Hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export async function indexSingleDocType(params: {
  businessId: string;
  docType: DocType;
  blobPath: string;
  filename: string;
  contentType?: string;
}): Promise<{ chunkCount: number; sha256: string }>
{
  const { businessId, docType, blobPath, filename } = params;
  const blob = await downloadBlobToBuffer(blobPath);
  const hash = sha256Hex(blob.buffer);

  const extracted = await extractTextFromBuffer({
    buffer: blob.buffer,
    filename,
    contentType: params.contentType ?? blob.contentType,
  });

  const text = extracted.text;
  const chunks = chunkText(text, {
    chunkSize: Number(process.env.RAG_CHUNK_SIZE || 900),
    overlap: Number(process.env.RAG_CHUNK_OVERLAP || 120),
  });

  const index = getPineconeIndex();

  // Delete only this docType for this business namespace
  await index.namespace(businessId).deleteMany({ filter: { docType } });

  const batchSize = Number(process.env.RAG_EMBED_BATCH_SIZE || 64);
  let upserted = 0;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const vectors = await embedTexts(batch);

    const records = vectors.map((values, j) => {
      const idx = i + j;
      return {
        id: `${docType}:${hash}:${idx}`,
        values,
        metadata: {
          businessId,
          docType,
          source: blobPath,
          filename,
          chunkIndex: idx,
          text: batch[j],
        },
      };
    });

    await index.namespace(businessId).upsert(records);
    upserted += records.length;
  }

  return { chunkCount: upserted, sha256: hash };
}
