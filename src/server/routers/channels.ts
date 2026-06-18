import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { channelIdentities, whatsappIdentityDetails, instagramIdentityDetails } from "../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const channelsRouter = router({
  listChannels: businessProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select()
      .from(channelIdentities)
      .where(eq(channelIdentities.businessId, ctx.businessId))
      .orderBy(channelIdentities.createdAt);

    return rows;
  }),

  updateChannel: businessProcedure
    .input(z.object({
      id: z.string().min(1),
      aiEnabled: z.boolean().optional(),
      autoReplyPaused: z.boolean().optional(),
      monthlyCreditLimit: z.number().int().min(0).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .update(channelIdentities)
        .set({
          ...(input.aiEnabled !== undefined ? { aiEnabled: input.aiEnabled } : {}),
          ...(input.autoReplyPaused !== undefined ? { autoReplyPaused: input.autoReplyPaused } : {}),
          ...(input.monthlyCreditLimit !== undefined ? { monthlyCreditLimit: input.monthlyCreditLimit } : {}),
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
