import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { customers, messageThreads, threadMessages, whatsappIdentities, SUPPORTED_SOURCES } from "@/../drizzle/schema";
import { and, desc, eq, ilike, isNull, lt, or, sql } from "drizzle-orm";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { observeAssistantMessageViaBot, sendWhatsAppMessagesViaBot } from "../services/botApi";
import { recordAiUsageEvent } from "../services/aiUsage";

const sourceSchema = z.enum(SUPPORTED_SOURCES);
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

  listRecentThreadsPage: businessProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).optional().default(50),
        whatsappIdentityId: z.string().nullish(),
        query: z.string().trim().max(120).optional(),
        cursorThreadId: z.string().optional(),
        cursorSortAt: z.string().datetime().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const whereConditions = [
        eq(messageThreads.businessId, ctx.businessId),
        isNull(messageThreads.deletedAt),
        eq(customers.businessId, ctx.businessId),
        isNull(customers.deletedAt),
      ];

      if (input.whatsappIdentityId) {
        whereConditions.push(eq(messageThreads.whatsappIdentityId, input.whatsappIdentityId));
      }

      const trimmedQuery = String(input.query || "").trim();
      if (trimmedQuery) {
        const pattern = `%${trimmedQuery}%`;
        whereConditions.push(
          or(
            ilike(customers.name, pattern),
            ilike(customers.phone, pattern),
            ilike(customers.externalId, pattern),
          )!,
        );
      }

      const sortAtExpr = sql<Date>`coalesce(${messageThreads.lastMessageAt}, ${messageThreads.createdAt})`;
      if (input.cursorThreadId && input.cursorSortAt) {
        const cursorSortAt = new Date(input.cursorSortAt);
        whereConditions.push(
          or(
            lt(sortAtExpr, cursorSortAt),
            and(eq(sortAtExpr, cursorSortAt), lt(messageThreads.id, input.cursorThreadId)),
          )!,
        );
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
          sortAt: sortAtExpr,
        })
        .from(messageThreads)
        .innerJoin(customers, eq(messageThreads.customerId, customers.id))
        .where(and(...whereConditions))
        .orderBy(desc(sortAtExpr), desc(messageThreads.id))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const lastItem = items[items.length - 1];

      return {
        items,
        hasMore,
        nextCursor:
          hasMore && lastItem
            ? {
                threadId: lastItem.threadId,
                sortAt: lastItem.sortAt instanceof Date ? lastItem.sortAt.toISOString() : new Date(lastItem.sortAt).toISOString(),
              }
            : null,
      };
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
          aiDisabled: whatsappIdentities.aiDisabled,
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

      const toRaw = String(thread.customerExternalId || thread.customerPhone || "").trim();
      const to = toRaw.replace(/[^\d]/g, "");
      if (!to) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Customer WhatsApp ID is missing." });
      }

      const [botResult] = await sendWhatsAppMessagesViaBot({
        businessId: ctx.businessId,
        phoneNumberId: identity.phoneNumberId,
        to,
        messages: [{ type: "text", text: input.text }],
      });

      const now = new Date();
      const [saved] = await db
        .insert(threadMessages)
        .values({
          threadId: input.threadId,
          externalMessageId: botResult?.messageId || null,
          direction: "outbound",
          messageType: "text",
          textBody: input.text,
          meta: {
            source: "portal_manual_send",
            whatsappIdentityId: thread.whatsappIdentityId,
            providerResponse: botResult?.providerResponse ?? null,
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

      if (saved) {
        recordBusinessEvent({
          event: "message.manual_send_succeeded",
          action: "sendText",
          area: "message",
          businessId: ctx.businessId,
          entity: "thread_message",
          entityId: saved.id,
          userId: ctx.userId,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
          actorType: "user",
          outcome: "success",
          attributes: {
            message_type: saved.messageType,
            text_length: input.text.length,
            thread_id: input.threadId,
            whatsapp_identity_id: thread.whatsappIdentityId,
          },
        });
      }

      try {
        if (!identity.aiDisabled) {
          await observeAssistantMessageViaBot({
            businessId: ctx.businessId,
            phoneNumberId: thread.whatsappIdentityId,
            to,
            text: input.text,
            intent: "general",
          });
          await recordAiUsageEvent({
            businessId: ctx.businessId,
            whatsappIdentityId: thread.whatsappIdentityId,
            threadId: input.threadId,
            eventType: "manual_outbound_message",
            source: "portal_manual_send",
            credits: 1,
            metadata: {
              customerExternalId: thread.customerExternalId ?? null,
            },
          });
        }
      } catch (error) {
        recordBusinessEvent({
          event: "message.manual_send_observe_failed",
          action: "sendText",
          area: "message",
          businessId: ctx.businessId,
          entity: "thread",
          entityId: input.threadId,
          userId: ctx.userId,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
          actorType: "user",
          outcome: "degraded",
          status: "assistant_observe_failed",
          attributes: {
            whatsapp_identity_id: thread.whatsappIdentityId,
          },
        });
      }

      return saved;
    }),

  sendMedia: businessProcedure
    .input(
      z.object({
        threadId: z.string().min(1),
        messages: z.array(mediaPartSchema).min(1).max(10),
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
          aiDisabled: whatsappIdentities.aiDisabled,
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

      const toRaw = String(thread.customerExternalId || thread.customerPhone || "").trim();
      const to = toRaw.replace(/[^\d]/g, "");
      if (!to) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Customer WhatsApp ID is missing." });
      }

      const botResults = await sendWhatsAppMessagesViaBot({
        businessId: ctx.businessId,
        phoneNumberId: identity.phoneNumberId,
        to,
        messages: input.messages,
      });

      const now = new Date();
      const rowsToInsert = input.messages.map((message, index) => {
        const botResult = botResults[index];
        const sharedMeta = {
          source: "portal_manual_send",
          whatsappIdentityId: thread.whatsappIdentityId,
          providerResponse: botResult?.providerResponse ?? null,
        } as Record<string, unknown>;
        if (message.type === "text") {
          return {
            threadId: input.threadId,
            externalMessageId: botResult?.messageId || null,
            direction: "outbound" as const,
            messageType: "text",
            textBody: message.text,
            meta: sharedMeta,
            createdAt: now,
          };
        }
        if (message.type === "image") {
          return {
            threadId: input.threadId,
            externalMessageId: botResult?.messageId || null,
            direction: "outbound" as const,
            messageType: "image",
            textBody: message.caption || "[image]",
            meta: {
              ...sharedMeta,
              imageUrl: message.imageUrl,
              ...(message.caption ? { caption: message.caption } : {}),
            },
            createdAt: now,
          };
        }
        return {
          threadId: input.threadId,
          externalMessageId: botResult?.messageId || null,
          direction: "outbound" as const,
          messageType: "document",
          textBody: message.caption || message.filename || "[document]",
          meta: {
            ...sharedMeta,
            documentUrl: message.documentUrl,
            ...(message.filename ? { filename: message.filename } : {}),
            ...(message.caption ? { caption: message.caption } : {}),
          },
          createdAt: now,
        };
      });

      const saved = await db
        .insert(threadMessages)
        .values(rowsToInsert)
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

      recordBusinessEvent({
        event: "message.manual_media_send_succeeded",
        action: "sendMedia",
        area: "message",
        businessId: ctx.businessId,
        entity: "thread",
        entityId: input.threadId,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: "success",
        attributes: {
          message_count: input.messages.length,
          whatsapp_identity_id: thread.whatsappIdentityId,
        },
      });

      try {
        if (!identity.aiDisabled) {
          const observationText = input.messages
            .map((message) => {
              if (message.type === "text") return message.text;
              if (message.type === "image") return message.caption || "[image sent by staff]";
              return message.caption || message.filename || "[document sent by staff]";
            })
            .filter(Boolean)
            .join("\n");
          if (observationText) {
            await observeAssistantMessageViaBot({
              businessId: ctx.businessId,
              phoneNumberId: thread.whatsappIdentityId,
              to,
              text: observationText,
              intent: "general",
            });
          }
          await recordAiUsageEvent({
            businessId: ctx.businessId,
            whatsappIdentityId: thread.whatsappIdentityId,
            threadId: input.threadId,
            eventType: "manual_outbound_message",
            source: "portal_manual_send",
            credits: input.messages.length,
            metadata: {
              customerExternalId: thread.customerExternalId ?? null,
              messageCount: input.messages.length,
            },
          });
        }
      } catch (error) {
        recordBusinessEvent({
          event: "message.manual_send_observe_failed",
          action: "sendMedia",
          area: "message",
          businessId: ctx.businessId,
          entity: "thread",
          entityId: input.threadId,
          userId: ctx.userId,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
          actorType: "user",
          outcome: "degraded",
          status: "assistant_observe_failed",
          attributes: {
            whatsapp_identity_id: thread.whatsappIdentityId,
          },
        });
      }

      return saved;
    }),
});
