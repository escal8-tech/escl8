import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { customers, messageThreads, threadMessages, SUPPORTED_SOURCES } from "@/../drizzle/schema";
import { and, asc, desc, eq, ilike, isNull, or } from "drizzle-orm";

const sourceSchema = z.enum(SUPPORTED_SOURCES);

export const messagesRouter = router({
  /**
   * List recent threads for the current business, joined with customer info.
   * This is used to populate the Messages UI even when the user hasn't searched yet.
   */
  listRecentThreads: businessProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).optional().default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select({
          threadId: messageThreads.id,
          customerId: customers.id,
          customerName: customers.name,
          customerExternalId: customers.externalId,
          customerPhone: customers.phone,
          customerSource: customers.source,
          status: messageThreads.status,
          lastMessageAt: messageThreads.lastMessageAt,
          threadCreatedAt: messageThreads.createdAt,
        })
        .from(messageThreads)
        .innerJoin(customers, eq(messageThreads.customerId, customers.id))
        .where(
          and(
            eq(messageThreads.businessId, ctx.businessId),
            isNull(messageThreads.deletedAt),
            eq(customers.businessId, ctx.businessId),
            isNull(customers.deletedAt),
          ),
        )
        .orderBy(desc(messageThreads.lastMessageAt), desc(messageThreads.createdAt))
        .limit(input.limit);

      return rows;
    }),

  /**
   * Search customers by phone/externalId for the current business.
   * Defaults to WhatsApp customers.
   */
  searchCustomers: businessProcedure
    .input(
      z.object({
        query: z.string().min(1),
        source: sourceSchema.optional().default("whatsapp"),
        limit: z.number().int().min(1).max(50).optional().default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const q = input.query.trim();
      const pattern = `%${q}%`;

      const rows = await db
        .select({
          id: customers.id,
          name: customers.name,
          externalId: customers.externalId,
          phone: customers.phone,
          lastMessageAt: customers.lastMessageAt,
          source: customers.source,
        })
        .from(customers)
        .where(
          and(
            eq(customers.businessId, ctx.businessId),
            eq(customers.source, input.source),
            isNull(customers.deletedAt),
            or(ilike(customers.externalId, pattern), ilike(customers.phone, pattern)),
          ),
        )
        .orderBy(desc(customers.lastMessageAt))
        .limit(input.limit);

      return rows;
    }),

  /**
   * List threads for a customer (scoped to the current business).
   */
  listThreadsForCustomer: businessProcedure
    .input(z.object({ customerId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select({
          id: messageThreads.id,
          status: messageThreads.status,
          lastMessageAt: messageThreads.lastMessageAt,
          createdAt: messageThreads.createdAt,
        })
        .from(messageThreads)
        .where(
          and(
            eq(messageThreads.businessId, ctx.businessId),
            eq(messageThreads.customerId, input.customerId),
            isNull(messageThreads.deletedAt),
          ),
        )
        .orderBy(desc(messageThreads.lastMessageAt));

      return rows;
    }),

  /**
   * List messages for a thread (enforces business scoping).
   */
  listMessages: businessProcedure
    .input(
      z.object({
        threadId: z.string().min(1),
        limit: z.number().int().min(1).max(500).optional().default(200),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [thread] = await db
        .select({ id: messageThreads.id })
        .from(messageThreads)
        .where(
          and(
            eq(messageThreads.id, input.threadId),
            eq(messageThreads.businessId, ctx.businessId),
            isNull(messageThreads.deletedAt),
          ),
        )
        .limit(1);

      if (!thread) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      }

      const rows = await db
        .select({
          id: threadMessages.id,
          direction: threadMessages.direction,
          messageType: threadMessages.messageType,
          textBody: threadMessages.textBody,
          meta: threadMessages.meta,
          createdAt: threadMessages.createdAt,
        })
        .from(threadMessages)
        .where(eq(threadMessages.threadId, input.threadId))
        .orderBy(asc(threadMessages.createdAt))
        .limit(input.limit);

      return rows;
    }),
});
