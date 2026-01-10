import crypto from "crypto";
import { downloadBlobToBuffer } from "./blob";
import { extractTextFromBuffer } from "./extractText";
import { smartChunkText, classifyChunksWithLLM, SmartChunk } from "./smartChunk";
import { embedTexts } from "./embed";
import { getPineconeIndex } from "./pinecone";

export type DocType = "considerations" | "conversations" | "inventory" | "bank" | "address";

function sha256Hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function deleteExistingVectorsForDocType(params: {
  index: ReturnType<typeof getPineconeIndex>;
  namespace: string;
  docType: DocType;
}): Promise<void> {
  const { index, namespace, docType } = params;
  const ns: any = index.namespace(namespace);

  // Best-effort strategy:
  // 1) Serverless-safe: list IDs by prefix and delete by ids (does not require metadata filter support).
  // 2) Fallback: delete by metadata filter (works on pod-based indexes; may require metadata indexing on some serverless setups).
  const prefix = `${docType}:`;

  if (typeof ns.list === "function") {
    console.log(`[rag:index] pinecone list+delete namespace=${namespace} prefix=${prefix}`);
    let paginationToken: string | undefined = undefined;
    let totalDeleted = 0;

    for (let page = 0; page < 10_000; page++) {
      const res: any = await ns.list({ prefix, limit: 1000, paginationToken });
      const ids: string[] = (res?.vectors || [])
        .map((v: any) => v?.id)
        .filter((id: any) => typeof id === "string" && id.length > 0);

      if (ids.length > 0) {
        // deleteMany accepts an array of ids
        await ns.deleteMany(ids);
        totalDeleted += ids.length;
      }

      const next: string | undefined = res?.pagination?.next;
      if (!next) break;
      paginationToken = next;
    }

    console.log(`[rag:index] pinecone deleted=${totalDeleted} namespace=${namespace} docType=${docType}`);
    return;
  }

  // Fallback: metadata delete
  console.log(`[rag:index] pinecone deleteMany(filter) namespace=${namespace} docType=${docType}`);
  try {
    await ns.deleteMany({ filter: { docType } });
  } catch (err: any) {
    // 404 is fine on first run (namespace doesn't exist yet)
    if (err?.status === 404 || err?.message?.includes("404")) {
      console.log(`[rag:index] pinecone delete skipped (namespace not found, first run)`);
      return;
    }
    // If filter deletes aren't supported on this index, don't fail the entire job.
    console.log(`[rag:index] pinecone delete by filter failed (continuing): ${err?.message || String(err)}`);
  }
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
  console.log(`[rag:index] begin businessId=${businessId} docType=${docType} blobPath=${blobPath}`);

  const blob = await downloadBlobToBuffer(blobPath);
  const hash = sha256Hex(blob.buffer);

  console.log(
    `[rag:index] downloaded bytes=${blob.buffer.length} contentType=${blob.contentType ?? "unknown"} sha256=${hash.slice(0, 12)}…`,
  );

  const extracted = await extractTextFromBuffer({
    buffer: blob.buffer,
    filename,
    contentType: params.contentType ?? blob.contentType,
  });

  console.log(
    `[rag:index] extracted chars=${extracted.text.length} pages=${extracted.pageCount ?? "?"}`,
  );

  const text = extracted.text;
  
  // Use enterprise-grade smart chunking with structure awareness
  // Hardcoded optimal settings for best RAG performance
  let smartChunks = smartChunkText(text, {
    targetTokens: 250,    // Target tokens per chunk
    minTokens: 100,       // Minimum tokens per chunk
    maxTokens: 400,       // Maximum tokens per chunk
    overlapTokens: 30,    // Overlap for context
  });

  // Use LLM for more accurate chunk type classification
  if (smartChunks.length > 0) {
    console.log(`[rag:index] running LLM chunk classification...`);
    smartChunks = await classifyChunksWithLLM(smartChunks);
  }

  console.log(`[rag:index] smart chunked count=${smartChunks.length} avgTokens=${
    smartChunks.length ? Math.round(smartChunks.reduce((s, c) => s + c.tokenEstimate, 0) / smartChunks.length) : 0
  }`);

  const index = getPineconeIndex();

  // Delete only this docType for this business namespace
  await deleteExistingVectorsForDocType({ index, namespace: businessId, docType });

  const batchSize = Number(process.env.RAG_EMBED_BATCH_SIZE || 64);
  let upserted = 0;

  for (let i = 0; i < smartChunks.length; i += batchSize) {
    const batch = smartChunks.slice(i, i + batchSize);
    const batchTexts = batch.map(c => c.text);
    console.log(`[rag:index] embed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(smartChunks.length / batchSize)} size=${batch.length}`);
    const vectors = await embedTexts(batchTexts);

    const records = vectors.map((values, j) => {
      const chunk = batch[j];
      return {
        id: `${docType}:${hash}:${chunk.chunkIndex}`,
        values,
        metadata: {
          businessId,
          docType,
          chunkType: chunk.chunkType,                        // NEW: chunk classification
          headingContext: chunk.headingContext || "",        // NEW: parent heading (empty string if null)
          source: blobPath,
          filename,
          chunkIndex: chunk.chunkIndex,
          charStart: chunk.charStart,                        // NEW: position tracking
          charEnd: chunk.charEnd,
          tokenEstimate: chunk.tokenEstimate,                // NEW: token count
          text: chunk.text,
        },
      };
    });

    await index.namespace(businessId).upsert(records);
    upserted += records.length;
    console.log(`[rag:index] pinecone upserted=${upserted}/${smartChunks.length}`);
  }

  // Log chunk type distribution for debugging
  const typeCounts: Record<string, number> = {};
  for (const chunk of smartChunks) {
    typeCounts[chunk.chunkType] = (typeCounts[chunk.chunkType] || 0) + 1;
  }
  console.log(`[rag:index] chunk types: ${JSON.stringify(typeCounts)}`);

  console.log(`[rag:index] done businessId=${businessId} docType=${docType} upserted=${upserted}`);
  return { chunkCount: upserted, sha256: hash };
}
