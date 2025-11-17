import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { db } from "../db/client";
import { users } from "../../../drizzle/schema";
import { eq } from "drizzle-orm";

export const userRouter = router({
  getMe: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input }) => {
      const rows = await db.select().from(users).where(eq(users.email, input.email));
      return rows[0] ?? null;
    }),

  upsert: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        phoneNumber: z.string().min(5).max(32).optional(),
        whatsappConnected: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const existing = await db.select().from(users).where(eq(users.email, input.email));
      const whatsappConnected = input.whatsappConnected ?? false;

      if (existing[0]) {
        const [updated] = await db
          .update(users)
          .set({
            phoneNumber: input.phoneNumber,
            whatsappConnected,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existing[0].id))
          .returning();
        return updated;
      }

      const [created] = await db
        .insert(users)
        .values({
          email: input.email,
          phoneNumber: input.phoneNumber,
          whatsappConnected,
        })
        .returning();
      return created;
    }),
});
