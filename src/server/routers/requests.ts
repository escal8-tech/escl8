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

  activitySeries: businessProcedure
    .input(
      z
        .object({
          days: z.number().int().min(1).max(365).optional(),
          source: sourceSchema.optional(),
          whatsappIdentityId: z.string().nullish(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const days = input?.days ?? 30;
      let customerIdsForPhone: string[] | null = null;
      if (input?.whatsappIdentityId) {
        const matchingCustomers = await db
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.businessId, ctx.businessId),
              eq(customers.whatsappIdentityId, input.whatsappIdentityId),
            ),
          );
        customerIdsForPhone = matchingCustomers.map((c) => c.id);
      }

      const conditions = [
        eq(requests.businessId, ctx.businessId),
        isNull(requests.deletedAt),
        sql`${requests.createdAt} >= now() - (${days} || ' days')::interval`,
      ];
      if (input?.source) conditions.push(eq(requests.source, input.source));
      if (customerIdsForPhone !== null) {
        if (customerIdsForPhone.length === 0) return [];
        conditions.push(inArray(requests.customerId, customerIdsForPhone));
      }

      const rows = await db
        .select({
          date: sql<string>`to_char(date_trunc('day', ${requests.createdAt}), 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
        })
        .from(requests)
        .where(and(...conditions))
        .groupBy(sql`date_trunc('day', ${requests.createdAt})`)
        .orderBy(sql`date_trunc('day', ${requests.createdAt}) asc`);

      return rows;
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

      const baseWhere = and(...conditions);

      const [totalsRow] = await db
        .select({
          count: sql<number>`count(*)::int`,
          revenue: sql<number>`coalesce(sum(${requests.price}::numeric), 0)::float8`,
          paidCount: sql<number>`count(*) filter (where ${requests.paid} = true)::int`,
          completed: sql<number>`count(*) filter (where lower(coalesce(${requests.status}, '')) = 'completed')::int`,
          failed: sql<number>`count(*) filter (where lower(coalesce(${requests.status}, '')) = 'failed')::int`,
          needsFollowup: sql<number>`count(*) filter (where lower(coalesce(${requests.status}, '')) in ('assistance_required', 'assistance-required', 'needs_followup'))::int`,
        })
        .from(requests)
        .where(baseWhere);

      const sentimentRows = await db
        .select({
          key: sql<string>`lower(coalesce(${requests.sentiment}, 'unknown'))`,
          count: sql<number>`count(*)::int`,
        })
        .from(requests)
        .where(baseWhere)
        .groupBy(sql`lower(coalesce(${requests.sentiment}, 'unknown'))`);

      const statusRows = await db
        .select({
          key: sql<string>`
            case
              when lower(coalesce(${requests.status}, '')) = 'failed' then 'FAILED'
              when lower(coalesce(${requests.status}, '')) = 'completed' then 'COMPLETED'
              when lower(coalesce(${requests.status}, '')) in ('assistance_required', 'assistance-required', 'needs_followup') then 'NEEDS_FOLLOWUP'
              else 'ONGOING'
            end
          `,
          count: sql<number>`count(*)::int`,
        })
        .from(requests)
        .where(baseWhere)
        .groupBy(sql`
          case
            when lower(coalesce(${requests.status}, '')) = 'failed' then 'FAILED'
            when lower(coalesce(${requests.status}, '')) = 'completed' then 'COMPLETED'
            when lower(coalesce(${requests.status}, '')) in ('assistance_required', 'assistance-required', 'needs_followup') then 'NEEDS_FOLLOWUP'
            else 'ONGOING'
          end
        `);

      const sourceRows = await db
        .select({
          key: sql<string>`coalesce(${requests.source}, 'whatsapp')`,
          count: sql<number>`count(*)::int`,
        })
        .from(requests)
        .where(baseWhere)
        .groupBy(sql`coalesce(${requests.source}, 'whatsapp')`);

      const bySentiment: Record<string, number> = {};
      for (const row of sentimentRows) {
        bySentiment[row.key] = row.count;
      }

      const byStatus: Record<string, number> = {
        ONGOING: 0,
        NEEDS_FOLLOWUP: 0,
        FAILED: 0,
        COMPLETED: 0,
      };
      for (const row of statusRows) {
        byStatus[row.key] = row.count;
      }

      const bySource: Record<string, number> = {};
      for (const row of sourceRows) {
        bySource[row.key] = row.count;
      }

      const total = Number(totalsRow?.count ?? 0);
      const revenue = Number(totalsRow?.revenue ?? 0);
      const paidCount = Number(totalsRow?.paidCount ?? 0);
      const completed = Number(totalsRow?.completed ?? 0);
      const failed = Number(totalsRow?.failed ?? 0);
      const needsFollowup = Number(totalsRow?.needsFollowup ?? 0);
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
