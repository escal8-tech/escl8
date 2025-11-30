import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { db } from "../db/client";
import { bookings } from "../../../drizzle/schema";
import { and, eq } from "drizzle-orm";

export const bookingsRouter = router({
  list: publicProcedure
    .input(z.object({ userId: z.string() }).optional())
    .query(async ({ input }) => {
      if (input?.userId) {
        return await db.select().from(bookings).where(eq(bookings.userId, input.userId));
      }
      return await db.select().from(bookings);
    }),

  create: publicProcedure
    .input(z.object({
      userId: z.string(),
      startTime: z.string(), // ISO
      durationMinutes: z.number().int().min(5).max(600).default(60),
      unitsBooked: z.number().int().min(1),
      phoneNumber: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [row] = await db.insert(bookings).values({
        userId: input.userId,
        startTime: new Date(input.startTime),
        durationMinutes: input.durationMinutes,
        unitsBooked: input.unitsBooked,
        phoneNumber: input.phoneNumber,
        notes: input.notes,
      }).returning();
      return row;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const [row] = await db.delete(bookings).where(eq(bookings.id, input.id)).returning();
      return row;
    }),
});

export type BookingsRouter = typeof bookingsRouter;
