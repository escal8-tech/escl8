import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { db } from "../db/client";
import { requests } from "../../../drizzle/schema";
import { desc, eq } from "drizzle-orm";

export const requestsRouter = router({
  list: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(200).optional() }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 50;
      const rows = await db.select().from(requests).orderBy(desc(requests.createdAt)).limit(limit);
      return rows;
    }),

  stats: publicProcedure.query(async () => {
    const rows = await db.select().from(requests);
    const bySentiment: Record<string, number> = {};
    let revenue = 0;
    let paidCount = 0;
    let openCount = 0;
    let resolvedCount = 0;

    for (const r of rows) {
      const s = (r.sentiment || "unknown").toLowerCase();
      bySentiment[s] = (bySentiment[s] ?? 0) + 1;
      if (r.paid) paidCount++;
      if (r.resolutionStatus?.toLowerCase() === "resolved") resolvedCount++;
      if (r.resolutionStatus?.toLowerCase() === "open" || r.resolutionStatus?.toLowerCase() === "pending") openCount++;
      const priceNum = Number(r.price as unknown as string);
      if (!Number.isNaN(priceNum)) revenue += priceNum;
    }

    return {
      totals: {
        count: rows.length,
        revenue,
        paidCount,
        openCount,
        resolvedCount,
      },
      bySentiment,
    };
  }),
});
