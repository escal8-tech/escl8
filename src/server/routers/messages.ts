import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { customers, messageThreads, threadMessages, whatsappIdentities, SUPPORTED_SOURCES } from "@/../drizzle/schema";
import { and, desc, eq, ilike, isNull, lt, or, sql } from "drizzle-orm";
import { graphEndpoint, graphJson, MetaGraphError } from "@/server/meta/graph";

const sourceSchema = z.enum(SUPPORTED_SOURCES);

export const messagesRouter = router({
  /**
   * List recent threads for the current business, joined with customer info.
   * This is used to populate the Messages UI even when the user hasn't searched yet.
   * Optionally filter by whatsappIdentityId (phone number).
   */
  listRecentThreads: businessProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).optional().default(50),
        whatsappIdentityId: z.string().nullish(), // null/undefined = all numbers
      }),
    )
    .query(async ({ ctx, input }) => {
      const whereConditions = [
        eq(messageThreads.businessId, ctx.businessId),
        isNull(messageThreads.deletedAt),
        eq(customers.businessId, ctx.businessId),
        isNull(customers.deletedAt),
      ];

      // If a specific phone number is selected, filter by it
      if (input.whatsappIdentityId) {
        whereConditions.push(eq(messageThreads.whatsappIdentityId, input.whatsappIdentityId));
      }

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
          whatsappIdentityId: messageThreads.whatsappIdentityId,
        })
        .from(messageThreads)
        .innerJoin(customers, eq(messageThreads.customerId, customers.id))
        .where(and(...whereConditions))
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
   * Supports cursor-based pagination for infinite scroll.
   * Returns messages in descending order (newest first) for easier pagination,
   * client reverses for display.
   */
  listMessages: businessProcedure
    .input(
      z.object({
        threadId: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional().default(20),
        cursor: z.string().optional(), // message ID to fetch messages before
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

      // If cursor provided, get the createdAt of that message for pagination
      let cursorDate: Date | null = null;
      if (input.cursor) {
        const [cursorMsg] = await db
          .select({ createdAt: threadMessages.createdAt })
          .from(threadMessages)
          .where(eq(threadMessages.id, input.cursor))
          .limit(1);
        cursorDate = cursorMsg?.createdAt ?? null;
      }

      // Fetch messages older than cursor (or all if no cursor), newest first
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
        .where(
          cursorDate
            ? and(
                eq(threadMessages.threadId, input.threadId),
                lt(threadMessages.createdAt, cursorDate),
              )
            : eq(threadMessages.threadId, input.threadId),
        )
        .orderBy(desc(threadMessages.createdAt))
        .limit(input.limit + 1); // Fetch one extra to check if there are more

      const hasMore = rows.length > input.limit;
      const messages = hasMore ? rows.slice(0, input.limit) : rows;

      // Return in ascending order for display (oldest first within batch)
      // Client will prepend older batches
      return {
        messages: messages.reverse(),
        nextCursor: hasMore ? messages[0]?.id : null,
        hasMore,
      };
    }),

  getThreadSessionWindow: businessProcedure
    .input(z.object({ threadId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [thread] = await db
        .select({
          id: messageThreads.id,
          whatsappIdentityId: messageThreads.whatsappIdentityId,
          customerSource: customers.source,
        })
        .from(messageThreads)
        .innerJoin(customers, eq(messageThreads.customerId, customers.id))
        .where(
          and(
            eq(messageThreads.id, input.threadId),
            eq(messageThreads.businessId, ctx.businessId),
            isNull(messageThreads.deletedAt),
            isNull(customers.deletedAt),
          ),
        )
        .limit(1);

      if (!thread) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      }

      const source = String(thread.customerSource || "").toLowerCase();
      const isWhatsApp = source === "whatsapp" || Boolean(thread.whatsappIdentityId);
      if (!isWhatsApp) {
        return {
          channel: source || "unknown",
          lastInboundAt: null as Date | null,
          closesAt: null as Date | null,
          isOpen: false,
          secondsRemaining: 0,
        };
      }

      const [agg] = await db
        .select({
          lastInboundAt: sql<Date | null>`
            max(${threadMessages.createdAt})
            filter (
              where lower(coalesce(${threadMessages.direction}, '')) in ('inbound', 'incoming', 'customer', 'user')
            )
          `,
          lastMessageAt: sql<Date | null>`max(${threadMessages.createdAt})`,
        })
        .from(threadMessages)
        .where(eq(threadMessages.threadId, input.threadId));

      const parseUtc = (value: unknown): Date | null => {
        if (!value) return null;
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
        if (typeof value === "string") {
          const parsed = new Date(value);
          return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        return null;
      };

      const lastInboundAt = parseUtc(agg?.lastInboundAt);
      const lastMessageAt = parseUtc(agg?.lastMessageAt);
      // Fallback for legacy rows where direction was not set consistently.
      // Use latest thread activity as the reference point for window visibility.
      const windowAnchorAt = lastInboundAt ?? lastMessageAt;
      if (!windowAnchorAt) {
        return {
          channel: "whatsapp",
          lastInboundAt: null as Date | null,
          closesAt: null as Date | null,
          isOpen: false,
          secondsRemaining: 0,
        };
      }

      const closesAt = new Date(windowAnchorAt.getTime() + 24 * 60 * 60 * 1000);
      const secondsRemaining = Math.max(0, Math.floor((closesAt.getTime() - Date.now()) / 1000));
      return {
        channel: "whatsapp",
        lastInboundAt,
        closesAt,
        isOpen: secondsRemaining > 0,
        secondsRemaining,
      };
    }),

  sendText: businessProcedure
    .input(
      z.object({
        threadId: z.string().min(1),
        text: z.string().min(1).max(4096),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [thread] = await db
        .select({
          id: messageThreads.id,
          whatsappIdentityId: messageThreads.whatsappIdentityId,
          customerExternalId: customers.externalId,
          customerPhone: customers.phone,
          customerSource: customers.source,
        })
        .from(messageThreads)
        .innerJoin(customers, eq(messageThreads.customerId, customers.id))
        .where(
          and(
            eq(messageThreads.id, input.threadId),
            eq(messageThreads.businessId, ctx.businessId),
            isNull(messageThreads.deletedAt),
            isNull(customers.deletedAt),
          ),
        )
        .limit(1);

      if (!thread) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      }
      if (thread.customerSource !== "whatsapp") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Manual send is supported only for WhatsApp threads." });
      }
      if (!thread.whatsappIdentityId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Thread has no WhatsApp identity configured." });
      }

      const [identity] = await db
        .select({
          phoneNumberId: whatsappIdentities.phoneNumberId,
        })
        .from(whatsappIdentities)
        .where(
          and(
            eq(whatsappIdentities.phoneNumberId, thread.whatsappIdentityId),
            eq(whatsappIdentities.businessId, ctx.businessId),
          ),
        )
        .limit(1);
      if (!identity) {
        throw new TRPCError({ code: "NOT_FOUND", message: "WhatsApp identity not found for this business." });
      }

      const businessToken = process.env.META_SYSTEM_USER_TOKEN || null;
      if (!businessToken) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Missing META_SYSTEM_USER_TOKEN.",
        });
      }

      const toRaw = String(thread.customerExternalId || thread.customerPhone || "").trim();
      const to = toRaw.replace(/[^\d]/g, "");
      if (!to) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Customer WhatsApp ID is missing." });
      }

      const metaGraphApiVersion = process.env.META_GRAPH_API_VERSION ?? "v24.0";
      let providerResponse: unknown;
      try {
        providerResponse = await graphJson<unknown>({
          endpoint: graphEndpoint(metaGraphApiVersion, `/${thread.whatsappIdentityId}/messages`),
          method: "POST",
          accessToken: businessToken,
          json: {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "text",
            text: {
              body: input.text,
            },
          },
        });
      } catch (error: unknown) {
        if (error instanceof MetaGraphError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message || "WhatsApp send failed.",
          });
        }
        throw error;
      }

      const externalMessageId =
        typeof providerResponse === "object" &&
        providerResponse !== null &&
        Array.isArray((providerResponse as { messages?: Array<{ id?: string }> }).messages)
          ? (providerResponse as { messages: Array<{ id?: string }> }).messages[0]?.id
          : undefined;

      const now = new Date();
      const [saved] = await db
        .insert(threadMessages)
        .values({
          threadId: input.threadId,
          externalMessageId: externalMessageId || null,
          direction: "outbound",
          messageType: "text",
          textBody: input.text,
          meta: {
            source: "portal_manual_send",
            whatsappIdentityId: thread.whatsappIdentityId,
          },
          createdAt: now,
        })
        .returning({
          id: threadMessages.id,
          direction: threadMessages.direction,
          messageType: threadMessages.messageType,
          textBody: threadMessages.textBody,
          meta: threadMessages.meta,
          createdAt: threadMessages.createdAt,
        });

      await db
        .update(messageThreads)
        .set({
          lastMessageAt: now,
          updatedAt: now,
        })
        .where(eq(messageThreads.id, input.threadId));

      return saved;
    }),
});
