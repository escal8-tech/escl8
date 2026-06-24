import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { SUPPORTED_SOURCES } from "@/../drizzle/schema";
import * as support from "../services/messageLifecycleSupport";

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
   * Optionally filter by channelIdentityId (phone number).
   */
  listRecentThreads: businessProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).optional().default(50),
        channelIdentityId: z.string().nullish(), // null/undefined = all numbers
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
      return support.searchCustomers(ctx, input);
    }),

  /**
   * List threads for a customer (scoped to the current business).
   */
  listThreadsForCustomer: businessProcedure
    .input(z.object({ customerId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return support.listThreadsForCustomer(ctx, input);
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
      return support.listMessages(ctx, input);
    }),

  getOrderThreadAnchor: businessProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return support.getOrderThreadAnchor(ctx, input);
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
      return support.sendText(ctx, input);
    }),

  sendMedia: businessProcedure
    .input(
      z.object({
        threadId: z.string().min(1),
        messages: z.array(mediaPartSchema).min(1).max(10),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return support.sendMedia(ctx, input);
    }),
});
