import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { customers, requests, SUPPORTED_SOURCES } from "@/../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";

// Source validation
const sourceSchema = z.enum(SUPPORTED_SOURCES);

export const customersRouter = router({
  /**
   * List all customers for the current business
   * Each row is one customer per source (same person on 4 platforms = 4 rows)
   */
  list: businessProcedure
    .input(
      z
        .object({
          source: sourceSchema.optional(), // filter by source
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      // Build where conditions
      const conditions = [eq(customers.businessId, ctx.businessId)];
      
      if (input?.source) {
        conditions.push(eq(customers.source, input.source));
      }

      const rows = await db
        .select()
        .from(customers)
        .where(and(...conditions))
        .orderBy(desc(customers.lastMessageAt));

      return rows.map((row) => ({
        ...row,
        totalRequests: row.totalRequests ?? 0,
        totalRevenue: row.totalRevenue ?? "0",
        successfulRequests: row.successfulRequests ?? 0,
        leadScore: row.leadScore ?? 0,
        isHighIntent: row.isHighIntent ?? false,
        tags: (row.tags as string[]) ?? [],
        platformMeta: row.platformMeta as Record<string, unknown> | null,
      }));
    }),

  /**
   * Get a single customer with full details
   * Now requires source + externalId to uniquely identify
   */
  get: businessProcedure
    .input(
      z.object({
        source: sourceSchema,
        externalId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const [customer] = await db
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.businessId, ctx.businessId),
            eq(customers.source, input.source),
            eq(customers.externalId, input.externalId)
          )
        )
        .limit(1);

      if (!customer) {
        return null;
      }

      return {
        ...customer,
        tags: (customer.tags as string[]) ?? [],
        platformMeta: customer.platformMeta as Record<string, unknown> | null,
      };
    }),

  /**
   * Get requests for a specific customer (by source + externalId)
   */
  getRequests: businessProcedure
    .input(
      z.object({
        source: sourceSchema,
        externalId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select({
          id: requests.id,
          sentiment: requests.sentiment,
          resolutionStatus: requests.resolutionStatus,
          source: requests.source,
          price: requests.price,
          paid: requests.paid,
          summary: requests.summary,
          createdAt: requests.createdAt,
        })
        .from(requests)
        .where(
          and(
            eq(requests.businessId, ctx.businessId),
            eq(requests.source, input.source),
            eq(requests.customerNumber, input.externalId)
          )
        )
        .orderBy(desc(requests.createdAt));

      return rows;
    }),

  /**
   * Update customer fields (notes, tags, status)
   * Now requires source + externalId
   */
  update: businessProcedure
    .input(
      z.object({
        source: sourceSchema,
        externalId: z.string(),
        notes: z.string().optional(),
        tags: z.array(z.string()).optional(),
        status: z.string().optional(),
        name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        isHighIntent: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { source, externalId, ...updates } = input;

      // Build update object with only provided fields
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (updates.notes !== undefined) updateData.notes = updates.notes;
      if (updates.tags !== undefined) updateData.tags = updates.tags;
      if (updates.status !== undefined) updateData.status = updates.status;
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.email !== undefined) updateData.email = updates.email;
      if (updates.phone !== undefined) updateData.phone = updates.phone;
      if (updates.isHighIntent !== undefined)
        updateData.isHighIntent = updates.isHighIntent;

      await db
        .update(customers)
        .set(updateData)
        .where(
          and(
            eq(customers.businessId, ctx.businessId),
            eq(customers.source, source),
            eq(customers.externalId, externalId)
          )
        );

      return { success: true };
    }),

  /**
   * Upsert a customer (called when a new request comes in)
   * Creates one row per (businessId, source, externalId) - no cross-platform merging
   */
  upsertFromRequest: businessProcedure
    .input(
      z.object({
        source: sourceSchema,
        externalId: z.string(), // The platform-specific ID (phone for WhatsApp, shop ID for Shopee, etc.)
        sentiment: z.string(),
        resolutionStatus: z.string(),
        price: z.string().optional(),
        paid: z.boolean().optional(),
        name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(), // Phone number if available (separate from externalId)
        platformMeta: z.record(z.string(), z.unknown()).optional(), // Platform-specific metadata
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      // Check if customer exists for this source + externalId
      const [existing] = await db
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.businessId, ctx.businessId),
            eq(customers.source, input.source),
            eq(customers.externalId, input.externalId)
          )
        )
        .limit(1);

      if (existing) {
        // Update aggregates
        const newTotalRequests = (existing.totalRequests ?? 0) + 1;
        const newSuccessful =
          input.resolutionStatus === "resolved"
            ? (existing.successfulRequests ?? 0) + 1
            : existing.successfulRequests ?? 0;
        const addedRevenue =
          input.paid && input.price ? parseFloat(input.price) : 0;
        const newRevenue =
          parseFloat(existing.totalRevenue ?? "0") + addedRevenue;

        // Calculate lead score based on behavior
        const leadScore = calculateLeadScore({
          totalRequests: newTotalRequests,
          successfulRequests: newSuccessful,
          totalRevenue: newRevenue,
          sentiment: input.sentiment,
        });

        // Merge platform metadata if new data provided
        const existingMeta = (existing.platformMeta as Record<string, unknown>) ?? {};
        const newMeta = input.platformMeta
          ? { ...existingMeta, ...input.platformMeta }
          : existingMeta;

        // Build update data
        const updateData: Record<string, unknown> = {
          totalRequests: newTotalRequests,
          successfulRequests: newSuccessful,
          totalRevenue: newRevenue.toFixed(2),
          lastSentiment: input.sentiment,
          lastMessageAt: now,
          leadScore,
          isHighIntent: leadScore > 70,
          platformMeta: newMeta,
          updatedAt: now,
        };

        // Update name/email/phone if provided and not already set
        if (input.name && !existing.name) updateData.name = input.name;
        if (input.email && !existing.email) updateData.email = input.email;
        if (input.phone && !existing.phone) updateData.phone = input.phone;

        await db
          .update(customers)
          .set(updateData)
          .where(
            and(
              eq(customers.businessId, ctx.businessId),
              eq(customers.source, input.source),
              eq(customers.externalId, input.externalId)
            )
          );
      } else {
        // Create new customer row for this source
        const addedRevenue =
          input.paid && input.price ? parseFloat(input.price) : 0;
        const leadScore = calculateLeadScore({
          totalRequests: 1,
          successfulRequests: input.resolutionStatus === "resolved" ? 1 : 0,
          totalRevenue: addedRevenue,
          sentiment: input.sentiment,
        });

        await db.insert(customers).values({
          businessId: ctx.businessId,
          source: input.source,
          externalId: input.externalId,
          name: input.name,
          email: input.email,
          phone: input.phone,
          platformMeta: input.platformMeta ?? null,
          totalRequests: 1,
          successfulRequests: input.resolutionStatus === "resolved" ? 1 : 0,
          totalRevenue: addedRevenue.toFixed(2),
          lastSentiment: input.sentiment,
          firstMessageAt: now,
          lastMessageAt: now,
          leadScore,
          isHighIntent: leadScore > 70,
          status: "active",
          tags: [],
        });
      }

      return { success: true };
    }),

  /**
   * Get aggregate stats across all sources for dashboard
   */
  getStats: businessProcedure.query(async ({ ctx }) => {
    const result = await db
      .select({
        totalCustomers: sql<number>`count(*)::int`,
        totalRevenue: sql<string>`coalesce(sum(${customers.totalRevenue}::numeric), 0)::text`,
        avgLeadScore: sql<number>`coalesce(avg(${customers.leadScore}), 0)::int`,
        highIntentCount: sql<number>`count(*) filter (where ${customers.isHighIntent} = true)::int`,
      })
      .from(customers)
      .where(eq(customers.businessId, ctx.businessId));

    return result[0] ?? {
      totalCustomers: 0,
      totalRevenue: "0",
      avgLeadScore: 0,
      highIntentCount: 0,
    };
  }),

  /**
   * Get customer counts per source for the filter dropdown
   */
  getSourceCounts: businessProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        source: customers.source,
        count: sql<number>`count(*)::int`,
      })
      .from(customers)
      .where(eq(customers.businessId, ctx.businessId))
      .groupBy(customers.source);

    // Convert to record for easy lookup
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.source] = row.count;
    }
    return counts;
  }),
});

/**
 * Calculate lead score (0-100) based on customer behavior
 */
function calculateLeadScore(data: {
  totalRequests: number;
  successfulRequests: number;
  totalRevenue: number;
  sentiment: string;
}): number {
  let score = 0;

  // Revenue (up to 40 points)
  if (data.totalRevenue > 1000) score += 40;
  else if (data.totalRevenue > 500) score += 30;
  else if (data.totalRevenue > 100) score += 20;
  else if (data.totalRevenue > 0) score += 10;

  // Conversion rate (up to 30 points)
  if (data.totalRequests > 0) {
    const conversionRate = data.successfulRequests / data.totalRequests;
    score += Math.round(conversionRate * 30);
  }

  // Engagement (up to 20 points)
  if (data.totalRequests >= 10) score += 20;
  else if (data.totalRequests >= 5) score += 15;
  else if (data.totalRequests >= 2) score += 10;
  else score += 5;

  // Sentiment (up to 10 points)
  if (data.sentiment === "positive") score += 10;
  else if (data.sentiment === "neutral") score += 5;

  return Math.min(100, score);
}
