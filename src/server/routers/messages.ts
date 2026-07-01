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
      return readSupport.listRecentThreadsForBusiness(ctx.businessId, input);
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
      return readSupport.listRecentThreadsPageForBusiness(ctx.businessId, input);
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
      return readSupport.searchCustomersForBusiness(ctx.businessId, input);
    }),

  listThreadsForCustomer: businessProcedure
    .input(z.object({ customerId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return readSupport.listThreadsForCustomerInBusiness(ctx.businessId, input.customerId);
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
      return readSupport.listMessagesForThread(ctx.businessId, input);
    }),

  getOrderThreadAnchor: businessProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return readSupport.getOrderThreadAnchorForBusiness(ctx.businessId, input.orderId);
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
      return readSupport.listThreadWindowForBusiness(ctx.businessId, input);
    }),

  getThreadSessionWindow: businessProcedure
    .input(z.object({ threadId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return readSupport.getThreadSessionWindowForBusiness(ctx.businessId, input.threadId);
    }),

  sendText: businessProcedure
    .input(
      z.object({
        threadId: z.string().min(1),
        text: z.string().min(1).max(4096),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return lifecycleSupport.sendTextForBusiness(ctx, input);
    }),

  sendMedia: businessProcedure
    .input(
      z.object({
        threadId: z.string().min(1),
        messages: z.array(mediaPartSchema).min(1).max(10),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return lifecycleSupport.sendMediaForBusiness(ctx, input);
    }),
});
