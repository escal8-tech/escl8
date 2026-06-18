import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { agents } from "../../../drizzle/schema";
import { and, eq } from "drizzle-orm";

export const agentsRouter = router({
  listAgents: businessProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select()
      .from(agents)
      .where(eq(agents.businessId, ctx.businessId))
      .orderBy(agents.createdAt);

    return rows;
  }),

  createAgent: businessProcedure
    .input(z.object({
      name: z.string().min(1),
      botType: z.string().min(1).default("AGENT"),
      promptOverride: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [newAgent] = await db
        .insert(agents)
        .values({
          businessId: ctx.businessId,
          name: input.name,
          botType: input.botType,
          promptOverride: input.promptOverride || null,
        })
        .returning();

      return newAgent;
    }),

  updateAgent: businessProcedure
    .input(z.object({
      id: z.string().min(1),
      name: z.string().min(1).optional(),
      botType: z.string().min(1).optional(),
      promptOverride: z.string().optional().nullable(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      
      const updateData: Record<string, unknown> = {};
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.botType !== undefined) updateData.botType = updates.botType;
      if (updates.promptOverride !== undefined) updateData.promptOverride = updates.promptOverride;
      if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

      const [updatedAgent] = await db
        .update(agents)
        .set(updateData)
        .where(and(
          eq(agents.id, id),
          eq(agents.businessId, ctx.businessId)
        ))
        .returning();

      return updatedAgent;
    }),

  deleteAgent: businessProcedure
    .input(z.object({
      id: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(agents)
        .where(and(
          eq(agents.id, input.id),
          eq(agents.businessId, ctx.businessId)
        ));
      
      return { success: true };
    }),
});
