import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { ragJobs, trainingDocuments, businesses } from "../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { generateAndSaveBotInstructions, areKeyDocsIndexed } from "../rag/generateBotInstructions";
import { retrieve, getGroundedContext } from "../rag/retrieve";

const docTypeSchema = z.enum(["considerations", "conversations", "inventory", "bank", "address"]);
const chunkTypeSchema = z.enum(["pricing", "policy", "faq", "example_dialogue", "contact_info", "product_info", "general"]);

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

  /** Manually regenerate bot instructions from the 3 key document types */
  regenerateInstructions: businessProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.userEmail && input.email !== ctx.userEmail) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }

      const allIndexed = await areKeyDocsIndexed(ctx.businessId);
      if (!allIndexed) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "All 3 key documents (considerations, conversations, inventory) must be indexed first",
        });
      }

      const saved = await generateAndSaveBotInstructions(ctx.businessId);
      if (!saved) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to generate instructions" });
      }

      // Return the new instructions
      const [biz] = await db.select().from(businesses).where(eq(businesses.id, ctx.businessId));
      return { ok: true, instructions: biz?.instructions ?? null };
    }),

  /** Get current bot instructions status */
  getInstructionsStatus: businessProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input, ctx }) => {
      if (ctx.userEmail && input.email !== ctx.userEmail) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }

      const [biz] = await db.select().from(businesses).where(eq(businesses.id, ctx.businessId));
      const allIndexed = await areKeyDocsIndexed(ctx.businessId);

      return {
        instructions: biz?.instructions ?? null,
        allKeyDocsIndexed: allIndexed,
      };
    }),

  /** Enterprise-grade RAG retrieval with query expansion, reranking, and citations */
  retrieve: businessProcedure
    .input(z.object({
      email: z.string().email(),
      query: z.string().min(1).max(1000),
      options: z.object({
        topK: z.number().int().min(1).max(20).optional(),
        docTypes: z.array(docTypeSchema).optional(),
        chunkTypes: z.array(chunkTypeSchema).optional(),
        useReranking: z.boolean().optional(),
        useQueryExpansion: z.boolean().optional(),
      }).optional(),
    }))
    .query(async ({ input, ctx }) => {
      if (ctx.userEmail && input.email !== ctx.userEmail) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }

      const result = await retrieve(ctx.businessId, input.query, {
        topK: input.options?.topK ?? 5,
        docTypes: input.options?.docTypes,
        chunkTypes: input.options?.chunkTypes,
        useReranking: input.options?.useReranking ?? true,
        useQueryExpansion: input.options?.useQueryExpansion ?? true,
      });

      return {
        chunks: result.chunks.map(c => ({
          id: c.id,
          text: c.text,
          score: c.rerankScore,
          relevance: c.relevanceLabel,
          docType: c.metadata.docType,
          chunkType: c.metadata.chunkType,
          source: c.metadata.filename,
        })),
        context: result.context,
        citations: result.citations,
        metadata: result.metadata,
      };
    }),

  /** Get grounded context block for bot prompts */
  getContext: businessProcedure
    .input(z.object({
      email: z.string().email(),
      query: z.string().min(1).max(1000),
      topK: z.number().int().min(1).max(10).optional(),
    }))
    .query(async ({ input, ctx }) => {
      if (ctx.userEmail && input.email !== ctx.userEmail) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }

      const context = await getGroundedContext(ctx.businessId, input.query, {
        topK: input.topK ?? 5,
        useReranking: true,
        useQueryExpansion: true,
      });

      return { context };
    }),
});
