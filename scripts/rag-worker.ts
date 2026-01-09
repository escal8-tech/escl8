import "dotenv/config";

import { sql } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { ragJobs, trainingDocuments } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";

type RagJobRow = typeof ragJobs.$inferSelect;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function claimNextJob(): Promise<RagJobRow | null> {
  // Multi-worker safe claim using row locking.
  const res = await db.execute<RagJobRow>(sql`
    WITH next_job AS (
      SELECT id
      FROM rag_jobs
      WHERE status = 'queued'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE rag_jobs j
    SET status = 'running',
        started_at = now(),
        attempts = COALESCE(j.attempts, 0) + 1
    FROM next_job
    WHERE j.id = next_job.id
    RETURNING j.*;
  `);

  // drizzle returns { rows } on node-postgres driver
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (res as any).rows as RagJobRow[] | undefined;
  return rows?.[0] ?? null;
}

async function processJob(job: RagJobRow) {
  const docType = job.docType as string;

  const doc = job.trainingDocumentId
    ? await db
        .select()
        .from(trainingDocuments)
        .where(eq(trainingDocuments.id, job.trainingDocumentId))
        .then((r) => r[0] ?? null)
    : await db
        .select()
        .from(trainingDocuments)
        .where(and(eq(trainingDocuments.businessId, job.businessId), eq(trainingDocuments.docType, docType)))
        .then((r) => r[0] ?? null);

  if (!doc) {
    throw new Error(`Training document not found for businessId=${job.businessId} docType=${docType}`);
  }

  await db
    .update(trainingDocuments)
    .set({ indexingStatus: "indexing", updatedAt: new Date(), lastError: null })
    .where(eq(trainingDocuments.id, doc.id));

  // Heavy libs (pdf parsing, embeddings) are ONLY loaded in the worker.
  const { indexSingleDocType } = await import("../src/server/rag/indexDocType");

  const res = await indexSingleDocType({
    businessId: job.businessId,
    docType: docType as any,
    blobPath: doc.blobPath,
    filename: doc.originalFilename,
    contentType: doc.contentType ?? undefined,
  });

  await db
    .update(trainingDocuments)
    .set({
      indexingStatus: "indexed",
      lastIndexedAt: new Date(),
      sha256Hex: res.sha256,
      updatedAt: new Date(),
      lastError: null,
    })
    .where(eq(trainingDocuments.id, doc.id));

  await db
    .update(ragJobs)
    .set({ status: "succeeded", finishedAt: new Date(), error: null })
    .where(eq(ragJobs.id, job.id));

  console.log(`[rag-worker] Indexed businessId=${job.businessId} docType=${docType} chunks=${res.chunkCount}`);
}

async function failJob(job: RagJobRow, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  await db
    .update(ragJobs)
    .set({ status: "failed", finishedAt: new Date(), error: msg })
    .where(eq(ragJobs.id, job.id));

  if (job.trainingDocumentId) {
    await db
      .update(trainingDocuments)
      .set({ indexingStatus: "failed", updatedAt: new Date(), lastError: msg })
      .where(eq(trainingDocuments.id, job.trainingDocumentId));
  }

  console.error(`[rag-worker] Failed job=${job.id}: ${msg}`);
}

async function main() {
  const pollMs = Number(process.env.RAG_WORKER_POLL_MS || 1500);
  console.log(`[rag-worker] started (poll=${pollMs}ms)`);

  while (true) {
    const job = await claimNextJob();
    if (!job) {
      await sleep(pollMs);
      continue;
    }

    try {
      await processJob(job);
    } catch (e) {
      await failJob(job, e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
