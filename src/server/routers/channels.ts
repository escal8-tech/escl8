import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { channelIdentities, businesses } from "../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const channelsRouter = router({
  listChannels: businessProcedure.query(async ({ ctx }) => {
    const [business] = await db
      .select({ creditPool: businesses.creditPool })
      .from(businesses)
      .where(eq(businesses.id, ctx.businessId));

    const rows = await db
      .select()
      .from(channelIdentities)
      .where(eq(channelIdentities.businessId, ctx.businessId))
      .orderBy(channelIdentities.createdAt);

    return {
      channels: rows,
      businessCreditPool: business?.creditPool || 0,
    };
  }),

  updateChannel: businessProcedure
    .input(z.object({
      id: z.string().min(1),
      aiEnabled: z.boolean().optional(),
      autoReplyPaused: z.boolean().optional(),
      monthlyCreditLimit: z.number().int().min(0).optional(),
      useSharedPool: z.boolean().optional(),
      agentId: z.string().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.monthlyCreditLimit !== undefined || input.useSharedPool !== undefined) {
        const allChannels = await db.select().from(channelIdentities).where(eq(channelIdentities.businessId, ctx.businessId));
        const [business] = await db.select({ creditPool: businesses.creditPool }).from(businesses).where(eq(businesses.id, ctx.businessId));
        
        let newTotal = 0;
        for (const ch of allChannels) {
          const isTarget = ch.id === input.id;
          const limit = isTarget ? (input.monthlyCreditLimit ?? ch.monthlyCreditLimit) : ch.monthlyCreditLimit;
          const shared = isTarget ? (input.useSharedPool ?? ch.useSharedPool) : ch.useSharedPool;
          
          if (!shared) {
            newTotal += limit;
          }
        }
        
        if (newTotal > (business?.creditPool || 0)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Total allocated credits cannot exceed business credit pool." });
        }
      }

      const [row] = await db
        .update(channelIdentities)
        .set({
          ...(input.aiEnabled !== undefined ? { aiEnabled: input.aiEnabled } : {}),
          ...(input.autoReplyPaused !== undefined ? { autoReplyPaused: input.autoReplyPaused } : {}),
          ...(input.monthlyCreditLimit !== undefined ? { monthlyCreditLimit: input.monthlyCreditLimit } : {}),
          ...(input.useSharedPool !== undefined ? { useSharedPool: input.useSharedPool } : {}),
          ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
          updatedAt: new Date(),
        })
        .where(and(
          eq(channelIdentities.businessId, ctx.businessId),
          eq(channelIdentities.id, input.id),
        ))
        .returning();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Channel identity not found for this business." });
      }

      return row;
    }),
});
