/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { bookings } from "../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { publishPortalEvent } from "@/server/realtime/portalEvents";

export const bookingsRouter = router({
  list: businessProcedure
    .input(z.object({ businessId: z.string() }).optional())
    .query(async ({ input, ctx }) => {
      if (input?.businessId && input.businessId !== ctx.businessId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Business mismatch" });
      }
      return await db.select().from(bookings).where(eq(bookings.businessId, ctx.businessId));
    }),

  create: businessProcedure
    .input(z.object({
      userId: z.string(),
      businessId: z.string(),
      startTime: z.string(), // ISO
      durationMinutes: z.number().int().min(5).max(600).default(60),
      unitsBooked: z.number().int().min(1),
      phoneNumber: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await db.insert(bookings).values({
        businessId: ctx.businessId,
        userId: input.userId,
        startTime: new Date(input.startTime),
        durationMinutes: input.durationMinutes,
        unitsBooked: input.unitsBooked,
        phoneNumber: input.phoneNumber,
        notes: input.notes,
      }).returning();
      if (row) {
        await publishPortalEvent({
          businessId: ctx.businessId,
          entity: "booking",
          op: "created",
          entityId: row.id,
          payload: { booking: row as any },
          createdAt: row.updatedAt ?? row.createdAt ?? new Date(),
        });
      }
      return row;
    }),

  delete: businessProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await db
        .delete(bookings)
        .where(and(eq(bookings.id, input.id), eq(bookings.businessId, ctx.businessId)))
        .returning();
      if (row) {
        await publishPortalEvent({
          businessId: ctx.businessId,
          entity: "booking",
          op: "deleted",
          entityId: row.id,
          payload: { booking: row as any },
          createdAt: row.updatedAt ?? row.createdAt ?? new Date(),
        });
      }
      return row;
    }),
});

export type BookingsRouter = typeof bookingsRouter;

