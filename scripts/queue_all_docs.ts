import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { trainingDocuments, ragJobs } from "../drizzle/schema";
import { enqueueRagJobMessage } from "../src/server/rag/queue";

async function main() {
  console.log("Queueing all documents for re-indexing...");

  const allDocs = await db.select().from(trainingDocuments);
  console.log(`Found ${allDocs.length} documents.`);

  for (const doc of allDocs) {
    console.log(`Queueing document ${doc.id} (type: ${doc.docType})...`);

    const now = new Date();
    const [job] = await db
      .insert(ragJobs)
      .values({
        businessId: doc.businessId,
        docType: doc.docType,
        trainingDocumentId: doc.id,
        status: "queued",
        attempts: 0,
        createdAt: now,
      })
      .returning();

    await db
      .update(trainingDocuments)
      .set({ indexingStatus: "queued", updatedAt: new Date(), lastError: null })
      .where(eq(trainingDocuments.id, doc.id));

    try {
      await enqueueRagJobMessage(job.id);
      console.log(`  -> Queued job ${job.id}`);
    } catch (err: any) {
      console.error(`  -> Failed to enqueue job ${job.id}:`, err);
    }
  }

  console.log("Done queueing all documents.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
