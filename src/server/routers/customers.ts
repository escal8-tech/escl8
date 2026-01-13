import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { customers, requests } from "@/../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

export const customersRouter = router({
  /**
   * List all customers for the current business
   */
  list: businessProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select()
      .from(customers)
      .where(eq(customers.businessId, ctx.businessId))
      .orderBy(desc(customers.lastMessageAt));

    return rows.map((row) => ({
      ...row,
      totalRequests: row.totalRequests ?? 0,
      totalRevenue: row.totalRevenue ?? "0",
      successfulRequests: row.successfulRequests ?? 0,
      leadScore: row.leadScore ?? 0,
      isHighIntent: row.isHighIntent ?? false,
      tags: (row.tags as string[]) ?? [],
    }));
  }),

  /**
   * Get a single customer with full details
   */
  get: businessProcedure
    .input(z.object({ waId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [customer] = await db
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.businessId, ctx.businessId),
            eq(customers.waId, input.waId)
          )
        )
        .limit(1);

      if (!customer) {
        return null;
      }

      return {
        ...customer,
        tags: (customer.tags as string[]) ?? [],
      };
    }),

  /**
   * Get requests for a specific customer
   */
  getRequests: businessProcedure
    .input(z.object({ waId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select({
          id: requests.id,
          sentiment: requests.sentiment,
          resolutionStatus: requests.resolutionStatus,
          price: requests.price,
          paid: requests.paid,
          summary: requests.summary,
          createdAt: requests.createdAt,
        })
        .from(requests)
        .where(
          and(
            eq(requests.businessId, ctx.businessId),
            eq(requests.customerNumber, input.waId)
          )
        )
        .orderBy(desc(requests.createdAt));

      return rows;
    }),

  /**
   * Update customer fields (notes, tags, status)
   */
  update: businessProcedure
    .input(
      z.object({
        waId: z.string(),
        notes: z.string().optional(),
        tags: z.array(z.string()).optional(),
        status: z.string().optional(),
        name: z.string().optional(),
        isHighIntent: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { waId, ...updates } = input;

      // Build update object with only provided fields
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (updates.notes !== undefined) updateData.notes = updates.notes;
      if (updates.tags !== undefined) updateData.tags = updates.tags;
      if (updates.status !== undefined) updateData.status = updates.status;
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.isHighIntent !== undefined)
        updateData.isHighIntent = updates.isHighIntent;

      await db
        .update(customers)
        .set(updateData)
        .where(
          and(
            eq(customers.businessId, ctx.businessId),
            eq(customers.waId, waId)
          )
        );

      return { success: true };
    }),

  /**
   * Upsert a customer (called when a new request comes in)
   * This updates cached aggregates
   */
  upsertFromRequest: businessProcedure
    .input(
      z.object({
        waId: z.string(),
        sentiment: z.string(),
        resolutionStatus: z.string(),
        price: z.string().optional(),
        paid: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      // Check if customer exists
      const [existing] = await db
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.businessId, ctx.businessId),
            eq(customers.waId, input.waId)
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

        await db
          .update(customers)
          .set({
            totalRequests: newTotalRequests,
            successfulRequests: newSuccessful,
            totalRevenue: newRevenue.toFixed(2),
            lastSentiment: input.sentiment,
            lastMessageAt: now,
            leadScore,
            isHighIntent: leadScore > 70,
            updatedAt: now,
          })
          .where(
            and(
              eq(customers.businessId, ctx.businessId),
              eq(customers.waId, input.waId)
            )
          );
      } else {
        // Create new customer
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
          waId: input.waId,
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
