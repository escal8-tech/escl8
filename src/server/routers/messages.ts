import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import {
  customers,
  orders,
  threadMessages,
  SUPPORTED_SOURCES,
} from "@/../drizzle/schema";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { ORDER_END_MESSAGE_KINDS } from "@/lib/messageFields";
import * as support from "../services/messageLifecycleSupport";

const sourceSchema = z.enum(SUPPORTED_SOURCES);
const digitsOnly = (value: string) => value.replace(/\D+/g, "");

const orderEndMessageKinds = Array.from(ORDER_END_MESSAGE_KINDS);

const mediaPartSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string().min(1).max(4096) }),
  z.object({ type: z.literal("image"), imageUrl: z.string().url(), caption: z.string().max(1024).optional() }),
  z.object({
    type: z.literal("document"),
    documentUrl: z.string().url(),
    filename: z.string().max(240).optional(),
    caption: z.string().max(1024).optional(),
  }),
]);

export const messagesRouter = router({
  listRecentThreads: businessProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).optional().default(50),
        channelIdentityId: z.string().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return support.listRecentThreads(ctx, input);
    }),

  listRecentThreadsPage: businessProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).optional().default(50),
        channelIdentityId: z.string().nullish(),
        query: z.string().trim().max(120).optional(),
        cursorThreadId: z.string().optional(),
        cursorSortAt: z.string().datetime().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return support.listRecentThreadsPage(ctx, input);
    }),

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
      const digitsQuery = digitsOnly(q);
      const digitPattern = `%${digitsQuery}%`;

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
            or(
              ilike(customers.externalId, pattern),
              ilike(customers.phone, pattern),
              ...(digitsQuery
                ? [
                    sql`regexp_replace(coalesce(${customers.externalId}, ''), '[^0-9]+', '', 'g') ilike ${digitPattern}`,
                    sql`regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]+', '', 'g') ilike ${digitPattern}`,
                  ]
                : []),
            ),
          ),
        )
        .orderBy(desc(customers.lastMessageAt))
        .limit(input.limit);

      return rows;
    }),

  listThreadsForCustomer: businessProcedure
    .input(z.object({ customerId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return support.listThreadsForCustomer(ctx, input);
    }),

  listMessages: businessProcedure
    .input(
      z.object({
        threadId: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional().default(20),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return support.listMessages(ctx, input);
    }),

  getOrderThreadAnchor: businessProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [order] = await db
        .select({
          id: orders.id,
          threadId: orders.threadId,
          threadAnchorMessageId: orders.threadAnchorMessageId,
        })
        .from(orders)
        .where(and(eq(orders.id, input.orderId), eq(orders.businessId, ctx.businessId)))
        .limit(1);

      if (!order?.threadId) {
        return { threadId: null, anchorMessageId: null, anchorCreatedAt: null as Date | null };
      }

      if (order.threadAnchorMessageId) {
        const [storedAnchor] = await db
          .select({
            id: threadMessages.id,
            createdAt: threadMessages.createdAt,
          })
          .from(threadMessages)
          .where(
            and(
              eq(threadMessages.id, order.threadAnchorMessageId),
              eq(threadMessages.threadId, order.threadId),
            ),
          )
          .limit(1);

        if (storedAnchor) {
          return {
            threadId: order.threadId,
            anchorMessageId: storedAnchor.id,
            anchorCreatedAt: storedAnchor.createdAt,
          };
        }
      }

      const [linkedAnchor] = await db
        .select({
          id: threadMessages.id,
          createdAt: threadMessages.createdAt,
        })
        .from(threadMessages)
        .where(
          and(
            eq(threadMessages.threadId, order.threadId),
            eq(threadMessages.linkedOrderId, input.orderId),
            inArray(threadMessages.messageKind, orderEndMessageKinds),
          ),
        )
        .orderBy(desc(threadMessages.createdAt), desc(threadMessages.id))
        .limit(1);

      if (linkedAnchor) {
        return {
          threadId: order.threadId,
          anchorMessageId: linkedAnchor.id,
          anchorCreatedAt: linkedAnchor.createdAt,
        };
      }

      const [legacyAnchor] = await db
        .select({
          id: threadMessages.id,
          createdAt: threadMessages.createdAt,
        })
        .from(threadMessages)
        .where(
          and(
            eq(threadMessages.threadId, order.threadId),
            or(
              sql`${threadMessages.meta} -> 'orderAnchor' ->> 'orderId' = ${input.orderId}`,
              sql`${threadMessages.meta} -> 'sourceMeta' ->> 'orderId' = ${input.orderId}`,
            ),
          ),
        )
        .orderBy(desc(threadMessages.createdAt), desc(threadMessages.id))
        .limit(1);

      return {
        threadId: order.threadId,
        anchorMessageId: legacyAnchor?.id ?? null,
        anchorCreatedAt: legacyAnchor?.createdAt ?? null,
      };
    }),

  listThreadWindow: businessProcedure
    .input(
      z.object({
        threadId: z.string().min(1),
        anchorMessageId: z.string().optional(),
        beforeLimit: z.number().int().min(1).max(60).optional().default(24),
        afterLimit: z.number().int().min(0).max(20).optional().default(6),
        olderCursor: z.string().optional(),
        newerCursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return support.listThreadWindow(ctx, input);
    }),

  getThreadSessionWindow: businessProcedure
    .input(z.object({ threadId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return support.getThreadSessionWindow(ctx, input);
    }),

  sendText: businessProcedure
    .input(
      z.object({
        threadId: z.string().min(1),
        text: z.string().min(1).max(4096),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return support.sendText(ctx as any, input);
    }),

  sendMedia: businessProcedure
    .input(
      z.object({
        threadId: z.string().min(1),
        messages: z.array(mediaPartSchema).min(1).max(10),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return support.sendMedia(ctx as any, input);
    }),
});
