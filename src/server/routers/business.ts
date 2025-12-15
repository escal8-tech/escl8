import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { db } from "../db/client";
import { businesses, users } from "../../../drizzle/schema";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

async function getBusinessByUserEmail(email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) return null;
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, user.businessId));
  return biz ?? null;
}

export const businessRouter = router({
  getMine: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input }) => {
      const biz = await getBusinessByUserEmail(input.email);
      if (!biz) return null;
      return biz;
    }),

  updateBookingConfig: publicProcedure
    .input(z.object({
      email: z.string().email(),
      businessId: z.string().min(1),
      unitCapacity: z.number().int().min(1),
      timeslotMinutes: z.number().int().min(5).max(600),
      openTime: z.string().regex(/^\d{2}:\d{2}$/),
      closeTime: z.string().regex(/^\d{2}:\d{2}$/),
    }))
    .mutation(async ({ input }) => {
      const user = await db.select().from(users).where(eq(users.email, input.email)).then(r => r[0]);
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      if (user.businessId !== input.businessId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "User not in this business" });
      }

      const [updated] = await db
        .update(businesses)
        .set({
          bookingUnitCapacity: input.unitCapacity,
          bookingTimeslotMinutes: input.timeslotMinutes,
          bookingOpenTime: input.openTime,
          bookingCloseTime: input.closeTime,
          updatedAt: new Date(),
        })
        .where(eq(businesses.id, input.businessId))
        .returning();
      return updated;
    }),
});
