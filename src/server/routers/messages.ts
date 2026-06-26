import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { SUPPORTED_SOURCES } from "@/../drizzle/schema";
import * as readSupport from "../services/messageReadSupport";
import * as lifecycleSupport from "../services/messageLifecycleSupport";

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
  listRecentThreads: businessProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).optional().default(50),
        channelIdentityId: z.string().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return readSupport.listRecentThreads({
        businessId: ctx.businessId,
        limit: input.limit,
        channelIdentityId: input.channelIdentityId,
      });
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
      return readSupport.listRecentThreadsPage({
        businessId: ctx.businessId,
        limit: input.limit,
        channelIdentityId: input.channelIdentityId,
        query: input.query,
        cursorThreadId: input.cursorThreadId,
        cursorSortAt: input.cursorSortAt,
      });
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
      return readSupport.searchCustomers({
        businessId: ctx.businessId,
        query: input.query,
        source: input.source,
        limit: input.limit,
      });
    }),

  listThreadsForCustomer: businessProcedure
    .input(z.object({ customerId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return readSupport.listThreadsForCustomer({
        businessId: ctx.businessId,
        customerId: input.customerId,
      });
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
      return readSupport.listMessages({
        businessId: ctx.businessId,
        threadId: input.threadId,
        limit: input.limit,
        cursor: input.cursor,
      });
    }),

  getOrderThreadAnchor: businessProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return readSupport.getOrderThreadAnchor({
        businessId: ctx.businessId,
        orderId: input.orderId,
      });
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
      return readSupport.listThreadWindow({
        businessId: ctx.businessId,
        threadId: input.threadId,
        anchorMessageId: input.anchorMessageId,
        beforeLimit: input.beforeLimit,
        afterLimit: input.afterLimit,
        olderCursor: input.olderCursor,
        newerCursor: input.newerCursor,
      });
    }),

  getThreadSessionWindow: businessProcedure
    .input(z.object({ threadId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return readSupport.getThreadSessionWindow({
        businessId: ctx.businessId,
        threadId: input.threadId,
      });
    }),

  sendText: businessProcedure
    .input(
      z.object({
        threadId: z.string().min(1),
        text: z.string().min(1).max(4096),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return lifecycleSupport.sendText({
        businessId: ctx.businessId,
        userId: ctx.userId,
        firebaseUid: ctx.firebaseUid,
        threadId: input.threadId,
        text: input.text,
      });
    }),

  sendMedia: businessProcedure
    .input(
      z.object({
        threadId: z.string().min(1),
        messages: z.array(mediaPartSchema).min(1).max(10),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return lifecycleSupport.sendMedia({
        businessId: ctx.businessId,
        userId: ctx.userId,
        firebaseUid: ctx.firebaseUid,
        threadId: input.threadId,
        messages: input.messages,
      });
    }),
});
