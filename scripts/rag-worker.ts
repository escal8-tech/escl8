import "dotenv/config";

import { sql } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { ragJobs, trainingDocuments } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { ensureRagQueue } from "../src/server/rag/queue";

type RagJobRow = typeof ragJobs.$inferSelect;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type QueueReceipt = {
  messageId: string;
  popReceipt: string;
};

async function claimNextJobFromQueue(): Promise<{ job: RagJobRow; receipt: QueueReceipt } | null> {
  const queue = await ensureRagQueue();
  const visibilityTimeout = Number(process.env.RAG_QUEUE_VISIBILITY_TIMEOUT || 120);
  const res = await queue.receiveMessages({ numberOfMessages: 1, visibilityTimeout });
  const msg = res.receivedMessageItems?.[0];
  if (!msg) return null;

  let payload: { jobId?: string } = {};
  try {
    payload = JSON.parse(msg.messageText || "{}");
  } catch {
    await queue.deleteMessage(msg.messageId, msg.popReceipt);
    return null;
  }

  if (!payload.jobId) {
    await queue.deleteMessage(msg.messageId, msg.popReceipt);
    return null;
  }

  const [job] = await db.select().from(ragJobs).where(eq(ragJobs.id, payload.jobId));
  if (!job) {
    await queue.deleteMessage(msg.messageId, msg.popReceipt);
    return null;
  }

  if (job.status !== "queued") {
    await queue.deleteMessage(msg.messageId, msg.popReceipt);
    return null;
  }

  await db
    .update(ragJobs)
    .set({
      status: "running",
      startedAt: new Date(),
      attempts: sql`COALESCE(${ragJobs.attempts}, 0) + 1`,
    })
    .where(eq(ragJobs.id, job.id));

  console.log(`[rag-worker] claimed job=${job.id} businessId=${job.businessId} docType=${job.docType} attempts=${(job.attempts ?? 0) + 1}`);

  return { job: { ...job, status: "running", attempts: (job.attempts ?? 0) + 1 }, receipt: { messageId: msg.messageId, popReceipt: msg.popReceipt } };
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
    RETURNING
      j.id as "id",
      j.business_id as "businessId",
      j.doc_type as "docType",
      j.training_document_id as "trainingDocumentId",
      j.status as "status",
      j.attempts as "attempts",
      j.created_at as "createdAt",
      j.started_at as "startedAt",
      j.finished_at as "finishedAt",
      j.error as "error";
  `);

  // drizzle returns { rows } on node-postgres driver
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (res as any).rows as RagJobRow[] | undefined;
  const job = rows?.[0] ?? null;
  if (job) {
    console.log(`[rag-worker] claimed job=${job.id} businessId=${job.businessId} docType=${job.docType} attempts=${job.attempts}`);
  }
  return job;
}

async function processJob(job: RagJobRow) {
  const docType = job.docType as string;
  console.log(`[rag-worker] start job=${job.id} businessId=${job.businessId} docType=${docType}`);

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

  console.log(`[rag-worker] done job=${job.id} businessId=${job.businessId} docType=${docType} chunks=${res.chunkCount}`);

  // After successful indexing, check if all 3 key docs are indexed and generate bot instructions
  const keyDocTypes = ["considerations", "conversations", "inventory"];
  if (keyDocTypes.includes(docType)) {
    try {
      const { generateAndSaveBotInstructions } = await import("../src/server/rag/generateBotInstructions");
      const saved = await generateAndSaveBotInstructions(job.businessId);
      if (saved) {
        console.log(`[rag-worker] bot instructions generated and saved for businessId=${job.businessId}`);
      }
    } catch (instrErr: any) {
      // Don't fail the job if instruction generation fails, just log it
      console.error(`[rag-worker] failed to generate bot instructions: ${instrErr?.message || String(instrErr)}`);
    }
  }
}

async function failJob(job: RagJobRow, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  await db
    .update(ragJobs)
    .set({ status: "failed", finishedAt: new Date(), error: msg })
    .where(eq(ragJobs.id, job.id));

  if (job.trainingDocumentId) {
    await db
      .update(trainingDocuments)
      .set({ indexingStatus: "failed", updatedAt: new Date(), lastError: msg })
      .where(eq(trainingDocuments.id, job.trainingDocumentId));
  } else if (job.businessId && job.docType) {
    await db
      .update(trainingDocuments)
      .set({ indexingStatus: "failed", updatedAt: new Date(), lastError: msg })
      .where(and(eq(trainingDocuments.businessId, job.businessId), eq(trainingDocuments.docType, job.docType)));
  }

  console.error(`[rag-worker] Failed job=${job.id}: ${msg}`);
  if (stack) console.error(stack);
}

async function main() {
  const pollMs = Number(process.env.RAG_WORKER_POLL_MS || 1500);
  const mode = (process.env.RAG_WORKER_MODE || "").toLowerCase();
  let useQueue = mode === "queue" || (mode !== "db");
  if (useQueue) {
    try {
      await ensureRagQueue();
    } catch (err: any) {
      console.error(`[rag-worker] queue init failed, falling back to db polling: ${err?.message || String(err)}`);
      useQueue = false;
    }
  }
  console.log(`[rag-worker] started (poll=${pollMs}ms mode=${useQueue ? "queue" : "db"})`);

  while (true) {
    if (useQueue) {
      const claimed = await claimNextJobFromQueue();
      if (!claimed) {
        await sleep(pollMs);
        continue;
      }

      try {
        await processJob(claimed.job);
        const queue = await ensureRagQueue();
        await queue.deleteMessage(claimed.receipt.messageId, claimed.receipt.popReceipt);
      } catch (e) {
        await failJob(claimed.job, e);
        const queue = await ensureRagQueue();
        await queue.deleteMessage(claimed.receipt.messageId, claimed.receipt.popReceipt);
      }
    } else {
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
