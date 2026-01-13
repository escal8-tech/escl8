import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { requests, SUPPORTED_SOURCES } from "../../../drizzle/schema";
import { desc, eq, and } from "drizzle-orm";

// Source validation
const sourceSchema = z.enum(SUPPORTED_SOURCES);

export const requestsRouter = router({
  list: businessProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(200).optional(),
          source: sourceSchema.optional(), // filter by source
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const limit = input?.limit ?? 50;

      // Build query based on filters
      let whereClause = eq(requests.businessId, ctx.businessId);
      if (input?.source) {
        whereClause = and(whereClause, eq(requests.source, input.source))!;
      }

      const rows = await db
        .select()
        .from(requests)
        .where(whereClause)
        .orderBy(desc(requests.createdAt))
        .limit(limit);
      return rows;
    }),

  stats: businessProcedure
    .input(z.object({ source: sourceSchema.optional() }).optional())
    .query(async ({ ctx, input }) => {
      // Build query based on filters
      let whereClause = eq(requests.businessId, ctx.businessId);
      if (input?.source) {
        whereClause = and(whereClause, eq(requests.source, input.source))!;
      }

      const rows = await db.select().from(requests).where(whereClause);
    const bySentiment: Record<string, number> = {};
    const byStatus: Record<string, number> = {
      ONGOING: 0,
      NEEDS_FOLLOWUP: 0,
      FAILED: 0,
      COMPLETED: 0,
    };
    let revenue = 0;
    let paidCount = 0;

    const normalizeStatus = (raw: string | null | undefined): keyof typeof byStatus => {
      const s = (raw ?? "").toLowerCase();
      // new canonical statuses
      if (s === "ongoing") return "ONGOING";
      if (s === "needs_followup" || s === "needs-followup") return "NEEDS_FOLLOWUP";
      if (s === "failed") return "FAILED";
      if (s === "completed") return "COMPLETED";

      // legacy mappings from older schema/comments
      if (s === "open") return "ONGOING";
      if (s === "pending") return "NEEDS_FOLLOWUP";
      if (s === "requires_assistance" || s === "requires-assistance") return "NEEDS_FOLLOWUP";
      if (s === "resolved") return "COMPLETED";

      // fallback (treat unknown as ongoing)
      return "ONGOING";
    };

    for (const r of rows) {
      const s = (r.sentiment || "unknown").toLowerCase();
      bySentiment[s] = (bySentiment[s] ?? 0) + 1;

      const st = normalizeStatus(r.resolutionStatus);
      byStatus[st] = (byStatus[st] ?? 0) + 1;

      if (r.paid) paidCount++;
      const priceNum = Number(r.price as unknown as string);
      if (!Number.isNaN(priceNum)) revenue += priceNum;
    }

    const total = rows.length;
    const completed = byStatus.COMPLETED ?? 0;
    const failed = byStatus.FAILED ?? 0;
    const needsFollowup = byStatus.NEEDS_FOLLOWUP ?? 0;
    const deflectionRate = completed + failed > 0 ? completed / (completed + failed) : 0;
    const followUpRate = total > 0 ? needsFollowup / total : 0;

    return {
      totals: {
        count: total,
        revenue,
        paidCount,
        deflectionRate,
        followUpRate,
      },
      bySentiment,
      byStatus,
    };
  }),
});
