import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { ragJobs, trainingDocuments, users } from "../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const docTypeSchema = z.enum(["considerations", "conversations", "inventory", "bank", "address"]);

export const ragRouter = router({
  enqueueRetrain: businessProcedure
    .input(z.object({ email: z.string().email(), docType: docTypeSchema }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.userEmail && input.email !== ctx.userEmail) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }
      console.log(`[rag] enqueueRetrain requested email=${input.email} docType=${input.docType}`);

      const doc = await db
        .select()
        .from(trainingDocuments)
        .where(and(eq(trainingDocuments.businessId, ctx.businessId), eq(trainingDocuments.docType, input.docType)))
        .then((r) => r[0] ?? null);

      if (!doc) {
        throw new TRPCError({ code: "NOT_FOUND", message: `No uploaded document for ${input.docType}` });
      }

      const now = new Date();
      const [job] = await db
        .insert(ragJobs)
        .values({
          businessId: ctx.businessId,
          docType: input.docType,
          trainingDocumentId: doc.id,
          status: "queued",
          attempts: 0,
          createdAt: now,
        })
        .returning();

      console.log(`[rag] queued job=${job.id} businessId=${ctx.businessId} docType=${input.docType} trainingDocumentId=${doc.id}`);

      await db
        .update(trainingDocuments)
        .set({ indexingStatus: "queued", updatedAt: new Date(), lastError: null })
        .where(eq(trainingDocuments.id, doc.id));

      return { ok: true, jobId: job.id, mode: "queued" };
    }),
});
