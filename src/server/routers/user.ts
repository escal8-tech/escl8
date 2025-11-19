import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { db } from "../db/client";
import { users } from "../../../drizzle/schema";
import { eq } from "drizzle-orm";

export const userRouter = router({
  getMe: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input }) => {
      try {
        const rows = await db.select().from(users).where(eq(users.email, input.email));
        return rows[0] ?? null;
      } catch (err: any) {
        const msg = String(err?.message || "Database error");
        if (msg.includes("relation") && msg.includes("does not exist")) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "Users table not found. Ensure the database is initialized/migrated before use.",
          });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }
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
      try {
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
      } catch (err: any) {
        const msg = String(err?.message || "Database error");
        if (msg.includes("relation") && msg.includes("does not exist")) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "Users table not found. Please run the DB init/migration task before logging in.",
          });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }
    }),
});
