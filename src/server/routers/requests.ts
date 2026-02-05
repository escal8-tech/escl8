import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { requests, customers, SUPPORTED_SOURCES } from "../../../drizzle/schema";
import { desc, eq, and, sql, isNull, inArray } from "drizzle-orm";

const sourceSchema = z.enum(SUPPORTED_SOURCES);

export const requestsRouter = router({
  list: businessProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(200).optional(),
          source: sourceSchema.optional(),
          includeDeleted: z.boolean().optional(),
          whatsappIdentityId: z.string().nullish(), // null/undefined = all numbers
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const limit = input?.limit ?? 50;

      // If filtering by phone number, get customer IDs first
      let customerIdsForPhone: string[] | null = null;
      if (input?.whatsappIdentityId) {
        const matchingCustomers = await db
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.businessId, ctx.businessId),
              eq(customers.whatsappIdentityId, input.whatsappIdentityId)
            )
          );
        customerIdsForPhone = matchingCustomers.map((c) => c.id);
      }

      const conditions = [eq(requests.businessId, ctx.businessId)];
      if (input?.source) {
        conditions.push(eq(requests.source, input.source));
      }
      // Exclude soft-deleted by default
      if (!input?.includeDeleted) {
        conditions.push(isNull(requests.deletedAt));
      }
      // Filter by phone number through customer relation
      if (customerIdsForPhone !== null) {
        if (customerIdsForPhone.length === 0) {
          // No customers match this phone number, return empty
          return [];
        }
        conditions.push(inArray(requests.customerId, customerIdsForPhone));
      }

      const rows = await db
        .select()
        .from(requests)
        .leftJoin(customers, eq(requests.customerId, customers.id))
        .where(and(...conditions))
        .orderBy(desc(requests.createdAt))
        .limit(limit);
      return rows.map((row) => ({
        ...row.requests,
        botPaused: row.customers?.botPaused ?? false,
      }));
    }),

  stats: businessProcedure
    .input(
      z
        .object({
          source: sourceSchema.optional(),
          whatsappIdentityId: z.string().nullish(), // null/undefined = all numbers
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      // If filtering by phone number, get customer IDs first
      let customerIdsForPhone: string[] | null = null;
      if (input?.whatsappIdentityId) {
        const matchingCustomers = await db
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.businessId, ctx.businessId),
              eq(customers.whatsappIdentityId, input.whatsappIdentityId)
            )
          );
        customerIdsForPhone = matchingCustomers.map((c) => c.id);
      }

      const conditions = [
        eq(requests.businessId, ctx.businessId),
        isNull(requests.deletedAt),
      ];
      if (input?.source) {
        conditions.push(eq(requests.source, input.source));
      }
      // Filter by phone number through customer relation
      if (customerIdsForPhone !== null) {
        if (customerIdsForPhone.length === 0) {
          // No customers match, return empty stats
          return {
            totals: { count: 0, revenue: 0, paidCount: 0, deflectionRate: 0, followUpRate: 0 },
            bySentiment: {},
            byStatus: { ONGOING: 0, NEEDS_FOLLOWUP: 0, FAILED: 0, COMPLETED: 0 },
            bySource: {},
          };
        }
        conditions.push(inArray(requests.customerId, customerIdsForPhone));
      }

      const rows = await db
        .select()
        .from(requests)
        .where(and(...conditions));

      const bySentiment: Record<string, number> = {};
      const byStatus: Record<string, number> = {
        ONGOING: 0,
        NEEDS_FOLLOWUP: 0,
        FAILED: 0,
        COMPLETED: 0,
      };
      const bySource: Record<string, number> = {};
      let revenue = 0;
      let paidCount = 0;

      const normalizeStatus = (raw: string | null | undefined): keyof typeof byStatus => {
        const s = (raw ?? "").toLowerCase();
        if (s === "ongoing") return "ONGOING";
        if (s === "failed") return "FAILED";
        if (s === "completed") return "COMPLETED";
        if (s === "assistance_required" || s === "assistance-required") return "NEEDS_FOLLOWUP";
        return "ONGOING";
      };

      for (const r of rows) {
        const s = (r.sentiment || "unknown").toLowerCase();
        bySentiment[s] = (bySentiment[s] ?? 0) + 1;

        const st = normalizeStatus((r as typeof r & { status?: string | null }).status);
        byStatus[st] = (byStatus[st] ?? 0) + 1;

        // Track by source
        const src = r.source ?? "whatsapp";
        bySource[src] = (bySource[src] ?? 0) + 1;

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
        bySource,
      };
    }),

  /**
   * Get request counts grouped by source for filtering
   */
  getSourceCounts: businessProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        source: requests.source,
        count: sql<number>`count(*)::int`,
      })
      .from(requests)
      .where(eq(requests.businessId, ctx.businessId))
      .groupBy(requests.source);

    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.source ?? "whatsapp"] = row.count;
    }
    return counts;
  }),
});
