import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { customers, requests, SUPPORTED_SOURCES } from "@/../drizzle/schema";
import { eq, and, desc, sql, isNull, lt, or } from "drizzle-orm";

// Source validation
const sourceSchema = z.enum(SUPPORTED_SOURCES);

export const customersRouter = router({
  /**
   * List all customers for the current business (excludes soft-deleted)
   * Each row is one customer per source (same person on 4 platforms = 4 rows)
   * Can filter by source and/or whatsappIdentityId
   */
  list: businessProcedure
    .input(
      z.object({
        source: sourceSchema.optional(),
        includeDeleted: z.boolean().optional(),
        whatsappIdentityId: z.string().nullish(), // null/undefined = all numbers
        limit: z.number().int().min(1).max(2000).optional(),
        cursorUpdatedAt: z.string().datetime().optional(),
        cursorId: z.string().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(customers.businessId, ctx.businessId)];
      
      if (input?.source) {
        conditions.push(eq(customers.source, input.source));
      }
      
      // Exclude soft-deleted by default
      if (!input?.includeDeleted) {
        conditions.push(isNull(customers.deletedAt));
      }

      // Filter by phone number if specified
      if (input?.whatsappIdentityId) {
        conditions.push(eq(customers.whatsappIdentityId, input.whatsappIdentityId));
      }

      if (input?.cursorUpdatedAt && input?.cursorId) {
        const cursorTs = new Date(input.cursorUpdatedAt);
        conditions.push(
          or(
            lt(customers.updatedAt, cursorTs),
            and(eq(customers.updatedAt, cursorTs), lt(customers.id, input.cursorId)),
          )!,
        );
      }

      const limit = input?.limit ?? 2000;
      const rows = await db
        .select()
        .from(customers)
        .where(and(...conditions))
        .orderBy(desc(customers.updatedAt), desc(customers.id))
        .limit(limit);

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
   * Get a single customer by ID
   */
  get: businessProcedure
    .input(z.object({
      id: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const [customer] = await db
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.businessId, ctx.businessId),
            eq(customers.id, input.id),
            isNull(customers.deletedAt)
          )
        )
        .limit(1);

      if (!customer) return null;

      return {
        ...customer,
        tags: (customer.tags as string[]) ?? [],
        platformMeta: customer.platformMeta as Record<string, unknown> | null,
      };
    }),

  /**
   * Get a customer by source + externalId (for lookups when creating requests)
   */
  getByExternalId: businessProcedure
    .input(z.object({
      source: sourceSchema,
      externalId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const [customer] = await db
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.businessId, ctx.businessId),
            eq(customers.source, input.source),
            eq(customers.externalId, input.externalId),
            isNull(customers.deletedAt)
          )
        )
        .limit(1);

      if (!customer) return null;

      return {
        ...customer,
        tags: (customer.tags as string[]) ?? [],
        platformMeta: customer.platformMeta as Record<string, unknown> | null,
      };
    }),

  /**
   * Get requests for a specific customer by customer ID
   */
  getRequests: businessProcedure
    .input(z.object({
      customerId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select({
          id: requests.id,
          sentiment: requests.sentiment,
          status: requests.status,
          type: requests.type,
          source: requests.source,
          customerId: requests.customerId,
          customerNumber: requests.customerNumber,
          price: requests.price,
          paid: requests.paid,
          summary: requests.summary,
          createdAt: requests.createdAt,
        })
        .from(requests)
        .where(
          and(
            eq(requests.businessId, ctx.businessId),
            eq(requests.customerId, input.customerId),
            isNull(requests.deletedAt)
          )
        )
        .orderBy(desc(requests.createdAt));

      return rows;
    }),

  /**
   * Update customer fields (notes, tags, status)
   */
  update: businessProcedure
    .input(z.object({
      id: z.string(),
      notes: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: z.string().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      isHighIntent: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      const updateData: Record<string, unknown> = { updatedAt: new Date() };

      if (updates.notes !== undefined) updateData.notes = updates.notes;
      if (updates.tags !== undefined) updateData.tags = updates.tags;
      if (updates.status !== undefined) updateData.status = updates.status;
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.email !== undefined) updateData.email = updates.email;
      if (updates.phone !== undefined) updateData.phone = updates.phone;
      if (updates.isHighIntent !== undefined) updateData.isHighIntent = updates.isHighIntent;

      await db
        .update(customers)
        .set(updateData)
        .where(
          and(
            eq(customers.businessId, ctx.businessId),
            eq(customers.id, id)
          )
        );

      return { success: true };
    }),

  /**
   * Soft delete a customer
   */
  delete: businessProcedure
    .input(z.object({
      id: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(customers)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(customers.businessId, ctx.businessId),
            eq(customers.id, input.id)
          )
        );

      return { success: true };
    }),

  /**
   * Upsert a customer when a new request comes in
   * Returns the customer ID for linking to the request
   */
  upsertFromRequest: businessProcedure
    .input(z.object({
      source: sourceSchema,
      externalId: z.string(),
      sentiment: z.string(),
      status: z.string(),
      type: z.string().optional(),
      price: z.string().optional(),
      paid: z.boolean().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      platformMeta: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const statusValue = (input.status ?? "").toLowerCase();
      const isSuccessful = statusValue === "completed" || statusValue === "resolved";

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
        const newTotalRequests = (existing.totalRequests ?? 0) + 1;
        const newSuccessful = isSuccessful
          ? (existing.successfulRequests ?? 0) + 1
          : existing.successfulRequests ?? 0;
        const addedRevenue = input.paid && input.price ? parseFloat(input.price) : 0;
        const newRevenue = parseFloat(existing.totalRevenue ?? "0") + addedRevenue;

        const leadScore = calculateLeadScore({
          totalRequests: newTotalRequests,
          successfulRequests: newSuccessful,
          totalRevenue: newRevenue,
          sentiment: input.sentiment,
        });

        const existingMeta = (existing.platformMeta as Record<string, unknown>) ?? {};
        const newMeta = input.platformMeta ? { ...existingMeta, ...input.platformMeta } : existingMeta;

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
          // Restore if soft-deleted
          deletedAt: null,
        };

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

        return { customerId: existing.id, created: false };
      } else {
        const addedRevenue = input.paid && input.price ? parseFloat(input.price) : 0;
        const leadScore = calculateLeadScore({
          totalRequests: 1,
          successfulRequests: isSuccessful ? 1 : 0,
          totalRevenue: addedRevenue,
          sentiment: input.sentiment,
        });

        const [newCustomer] = await db.insert(customers).values({
          businessId: ctx.businessId,
          source: input.source,
          externalId: input.externalId,
          name: input.name,
          email: input.email,
          phone: input.phone,
          platformMeta: input.platformMeta ?? {},
          totalRequests: 1,
          successfulRequests: isSuccessful ? 1 : 0,
          totalRevenue: addedRevenue.toFixed(2),
          lastSentiment: input.sentiment,
          firstMessageAt: now,
          lastMessageAt: now,
          leadScore,
          isHighIntent: leadScore > 70,
          status: "active",
          tags: [],
        }).returning({ id: customers.id });

        return { customerId: newCustomer.id, created: true };
      }
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
      .where(and(
        eq(customers.businessId, ctx.businessId),
        isNull(customers.deletedAt)
      ));

    return result[0] ?? { totalCustomers: 0, totalRevenue: "0", avgLeadScore: 0, highIntentCount: 0 };
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
      .where(and(
        eq(customers.businessId, ctx.businessId),
        isNull(customers.deletedAt)
      ))
      .groupBy(customers.source);

    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.source] = row.count;
    }
    return counts;
  }),

  setBotPaused: businessProcedure
    .input(z.object({
      customerId: z.string(),
      botPaused: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .update(customers)
        .set({ botPaused: input.botPaused, updatedAt: new Date() })
        .where(and(
          eq(customers.businessId, ctx.businessId),
          eq(customers.id, input.customerId),
          isNull(customers.deletedAt),
        ))
        .returning();
      return row ?? null;
    }),
});

function calculateLeadScore(data: {
  totalRequests: number;
  successfulRequests: number;
  totalRevenue: number;
  sentiment: string;
}): number {
  let score = 0;

  if (data.totalRevenue > 1000) score += 40;
  else if (data.totalRevenue > 500) score += 30;
  else if (data.totalRevenue > 100) score += 20;
  else if (data.totalRevenue > 0) score += 10;

  if (data.totalRequests > 0) {
    const conversionRate = data.successfulRequests / data.totalRequests;
    score += Math.round(conversionRate * 30);
  }

  if (data.totalRequests >= 10) score += 20;
  else if (data.totalRequests >= 5) score += 15;
  else if (data.totalRequests >= 2) score += 10;
  else score += 5;

  if (data.sentiment === "positive") score += 10;
  else if (data.sentiment === "neutral") score += 5;

  return Math.min(100, score);
}
