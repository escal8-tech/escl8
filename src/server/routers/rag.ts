import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { db } from "../db/client";
import { ragJobs, trainingDocuments, users } from "../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const docTypeSchema = z.enum(["considerations", "conversations", "inventory", "bank", "address"]);

export const ragRouter = router({
  enqueueRetrain: publicProcedure
    .input(z.object({ email: z.string().email(), docType: docTypeSchema }))
    .mutation(async ({ input }) => {
      const user = await db.select().from(users).where(eq(users.email, input.email)).then((r) => r[0] ?? null);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      const doc = await db
        .select()
        .from(trainingDocuments)
        .where(and(eq(trainingDocuments.businessId, user.businessId), eq(trainingDocuments.docType, input.docType)))
        .then((r) => r[0] ?? null);

      if (!doc) {
        throw new TRPCError({ code: "NOT_FOUND", message: `No uploaded document for ${input.docType}` });
      }

      const now = new Date();
      const [job] = await db
        .insert(ragJobs)
        .values({
          businessId: user.businessId,
          docType: input.docType,
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

      return { ok: true, jobId: job.id, mode: "queued" };
    }),
});
