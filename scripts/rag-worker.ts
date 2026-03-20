/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";

import { sql } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { ragJobs, trainingDocuments } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { ensureRagQueue } from "../src/server/rag/queue";
import { publishPortalEvent, toPortalDocumentPayload } from "../src/server/realtime/portalEvents";
import { recordBusinessEvent } from "../src/lib/business-monitoring";
import { captureSentryException } from "../src/lib/sentry-monitoring";
import { registerNodeRuntimeMonitoring } from "../src/lib/node-runtime-monitoring";
import { INDEXING_STATUS, isKeyDocType, RAG_JOB_STATUS } from "../src/lib/rag-documents";

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

  if (job.status !== RAG_JOB_STATUS.QUEUED) {
    await queue.deleteMessage(msg.messageId, msg.popReceipt);
    return null;
  }

  await db
    .update(ragJobs)
    .set({
      status: RAG_JOB_STATUS.RUNNING,
      startedAt: new Date(),
      attempts: sql`COALESCE(${ragJobs.attempts}, 0) + 1`,
    })
    .where(eq(ragJobs.id, job.id));

  console.log(`[rag-worker] claimed job=${job.id} businessId=${job.businessId} docType=${job.docType} attempts=${(job.attempts ?? 0) + 1}`);

  return { job: { ...job, status: RAG_JOB_STATUS.RUNNING, attempts: (job.attempts ?? 0) + 1 }, receipt: { messageId: msg.messageId, popReceipt: msg.popReceipt } };
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
  const rows = (res as { rows?: RagJobRow[] }).rows;
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

  recordBusinessEvent({
    event: "rag.training_started",
    action: "rag-worker.process-job",
    area: "rag",
    businessId: job.businessId,
    entity: "training_document",
    entityId: doc.id,
    outcome: "started",
    status: INDEXING_STATUS.INDEXING,
    attributes: {
      doc_type: docType,
      file_name: doc.originalFilename,
      rag_job_id: job.id,
    },
  });

  const [indexingDoc] = await db
    .update(trainingDocuments)
    .set({ indexingStatus: INDEXING_STATUS.INDEXING, updatedAt: new Date(), lastError: null })
    .where(eq(trainingDocuments.id, doc.id))
    .returning();

  if (indexingDoc) {
    await publishPortalEvent({
      businessId: job.businessId,
      entity: "document",
      op: "upsert",
      entityId: indexingDoc.id,
      payload: { document: toPortalDocumentPayload(indexingDoc as any) as any },
      createdAt: indexingDoc.updatedAt ?? new Date(),
    });
  }

  // Heavy libs (pdf parsing, embeddings) are ONLY loaded in the worker.
  const { indexSingleDocType } = await import("../src/server/rag/indexDocType");

  const res = await indexSingleDocType({
    businessId: job.businessId,
    docType: docType as any,
    blobPath: doc.blobPath,
    filename: doc.originalFilename,
    contentType: doc.contentType ?? undefined,
  });

  const [indexedDoc] = await db
    .update(trainingDocuments)
    .set({
      indexingStatus: INDEXING_STATUS.INDEXED,
      lastIndexedAt: new Date(),
      sha256Hex: res.sha256,
      updatedAt: new Date(),
      lastError: null,
    })
    .where(eq(trainingDocuments.id, doc.id))
    .returning();

  if (indexedDoc) {
    await publishPortalEvent({
      businessId: job.businessId,
      entity: "document",
      op: "upsert",
      entityId: indexedDoc.id,
      payload: { document: toPortalDocumentPayload(indexedDoc as any) as any },
      createdAt: indexedDoc.updatedAt ?? new Date(),
    });
  }

  await db
    .update(ragJobs)
    .set({ status: RAG_JOB_STATUS.SUCCEEDED, finishedAt: new Date(), error: null })
    .where(eq(ragJobs.id, job.id));

  recordBusinessEvent({
    event: "rag.training_completed",
    action: "rag-worker.process-job",
    area: "rag",
    businessId: job.businessId,
    entity: "training_document",
    entityId: indexedDoc?.id ?? doc.id,
    outcome: "success",
    status: INDEXING_STATUS.INDEXED,
    attributes: {
      chunk_count: res.chunkCount,
      doc_type: docType,
      file_name: doc.originalFilename,
      rag_job_id: job.id,
    },
  });

  console.log(`[rag-worker] done job=${job.id} businessId=${job.businessId} docType=${docType} chunks=${res.chunkCount}`);

  // After successful indexing, check if all 3 key docs are indexed and generate bot instructions
  if (isKeyDocType(docType)) {
    try {
      const { generateAndSaveBotInstructions } = await import("../src/server/rag/generateBotInstructions");
      const saved = await generateAndSaveBotInstructions(job.businessId);
      if (saved) {
        recordBusinessEvent({
          event: "rag.instructions_generated",
          action: "rag-worker.generate-instructions",
          area: "rag",
          businessId: job.businessId,
          entity: "rag_job",
          entityId: job.id,
          outcome: "success",
          attributes: {
            doc_type: docType,
          },
        });
        console.log(`[rag-worker] bot instructions generated and saved for businessId=${job.businessId}`);
      }
    } catch (instrErr: any) {
      // Don't fail the job if instruction generation fails, just log it
      recordBusinessEvent({
        event: "rag.instructions_generation_failed",
        level: "error",
        action: "rag-worker.generate-instructions",
        area: "rag",
        businessId: job.businessId,
        entity: "rag_job",
        entityId: job.id,
        outcome: "failed",
        attributes: {
          doc_type: docType,
          error_message: instrErr instanceof Error ? instrErr.message : String(instrErr),
        },
      });
      captureSentryException(instrErr, {
        action: "rag-worker.generate-instructions",
        area: "rag",
        level: "error",
        tags: {
          "rag.doc_type": docType,
          "rag.job_id": job.id,
          "escal8.business_id": job.businessId,
        },
      });
      console.error(`[rag-worker] failed to generate bot instructions: ${instrErr?.message || String(instrErr)}`);
    }
  }
}

async function failJob(job: RagJobRow, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  await db
    .update(ragJobs)
    .set({ status: RAG_JOB_STATUS.FAILED, finishedAt: new Date(), error: msg })
    .where(eq(ragJobs.id, job.id));

  if (job.trainingDocumentId) {
    const [failedDoc] = await db
      .update(trainingDocuments)
      .set({ indexingStatus: INDEXING_STATUS.FAILED, updatedAt: new Date(), lastError: msg })
      .where(eq(trainingDocuments.id, job.trainingDocumentId))
      .returning();

    if (failedDoc) {
      await publishPortalEvent({
        businessId: job.businessId,
        entity: "document",
        op: "upsert",
        entityId: failedDoc.id,
        payload: { document: toPortalDocumentPayload(failedDoc as any) as any },
        createdAt: failedDoc.updatedAt ?? new Date(),
      });
    }
  } else if (job.businessId && job.docType) {
    const [failedDoc] = await db
      .update(trainingDocuments)
      .set({ indexingStatus: INDEXING_STATUS.FAILED, updatedAt: new Date(), lastError: msg })
      .where(and(eq(trainingDocuments.businessId, job.businessId), eq(trainingDocuments.docType, job.docType)))
      .returning();

    if (failedDoc) {
      await publishPortalEvent({
        businessId: job.businessId,
        entity: "document",
        op: "upsert",
        entityId: failedDoc.id,
        payload: { document: toPortalDocumentPayload(failedDoc as any) as any },
        createdAt: failedDoc.updatedAt ?? new Date(),
      });
    }
  }

  recordBusinessEvent({
    event: "rag.training_failed",
    level: "error",
    action: "rag-worker.process-job",
    area: "rag",
    businessId: job.businessId,
    entity: "rag_job",
    entityId: job.id,
    outcome: "failed",
    status: "failed",
    attributes: {
      doc_type: String(job.docType || ""),
      error_message: msg,
      training_document_id: job.trainingDocumentId,
    },
  });
  captureSentryException(err, {
    action: "rag-worker.process-job",
    area: "rag",
    level: "error",
    tags: {
      "rag.doc_type": job.docType,
      "rag.job_id": job.id,
      "escal8.business_id": job.businessId,
    },
    contexts: {
      rag: {
        businessId: job.businessId,
        docType: job.docType,
        jobId: job.id,
        trainingDocumentId: job.trainingDocumentId,
      },
    },
  });
  console.error(`[rag-worker] Failed job=${job.id}: ${msg}`);
  if (stack) console.error(stack);
}

async function main() {
  registerNodeRuntimeMonitoring();
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
