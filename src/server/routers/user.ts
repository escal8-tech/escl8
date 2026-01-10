import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { db } from "../db/client";
import crypto from "crypto";
import { businesses, users } from "../../../drizzle/schema";
import { eq } from "drizzle-orm";

function defaultBusinessInstructions() {
  return "You are a helpful AI sales and support assistant. Use the uploaded business documents as the source of truth. If information is missing, ask a clarifying question.";
}

function newBusinessId() {
  return crypto.randomUUID();
}

function businessNameFromEmail(email: string) {
  const domain = email.split("@")[1] || "";
  return domain ? `Business (${domain})` : "Business";
}

export const userRouter = router({
  ensure: protectedProcedure
    .input(
      z.object({
        email: z.string().email(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.userEmail && input.email !== ctx.userEmail) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
        }
        const existing = await db.select().from(users).where(eq(users.email, input.email));
        if (existing[0]) {
          return existing[0];
        }

        const now = new Date();
        const created = await db.transaction(async (tx) => {
          const bizId = newBusinessId();
          await tx.insert(businesses).values({
            id: bizId,
            name: businessNameFromEmail(input.email),
            instructions: defaultBusinessInstructions(),
            createdAt: now,
            updatedAt: now,
          });

          const [u] = await tx
            .insert(users)
            .values({
              email: input.email,
              whatsappConnected: false,
              businessId: bizId,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          return u;
        });

        return created;
      } catch (err: any) {
        const msg = String(err?.message || "Database error");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }
    }),

  getMe: protectedProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input, ctx }) => {
      try {
        if (!ctx.userEmail) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
        }
        if (input.email !== ctx.userEmail) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
        }
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

  upsert: protectedProcedure
    .input(
      z.object({
        email: z.string().email(),
        whatsappConnected: z.boolean().optional(),
        businessId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (!ctx.userEmail) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
        }
        if (input.email !== ctx.userEmail) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
        }
        const existing = await db.select().from(users).where(eq(users.email, input.email));
        const whatsappConnected = input.whatsappConnected ?? false;

        // If caller supplies a businessId, we trust it; otherwise we ensure a valid business exists.
        const requestedBusinessId = input.businessId;
        const now = new Date();

        if (existing[0]) {
          const finalBusinessId = requestedBusinessId || existing[0].businessId;
          if (!finalBusinessId) {
            // Repair path for legacy rows (should not normally happen with current schema)
            const ensured = await db.transaction(async (tx) => {
              const bizId = newBusinessId();
              await tx.insert(businesses).values({
                id: bizId,
                name: businessNameFromEmail(input.email),
                instructions: defaultBusinessInstructions(),
                createdAt: now,
                updatedAt: now,
              });
              const [updatedUser] = await tx
                .update(users)
                .set({
                  whatsappConnected,
                  businessId: bizId,
                  updatedAt: now,
                })
                .where(eq(users.id, existing[0].id))
                .returning();
              return updatedUser;
            });
            return ensured;
          }

          const [updated] = await db
            .update(users)
            .set({
              whatsappConnected,
              businessId: finalBusinessId,
              updatedAt: now,
            })
            .where(eq(users.id, existing[0].id))
            .returning();
          return updated;
        }

        // New user: if no businessId provided, create a fresh business.
        if (!requestedBusinessId) {
          return await db.transaction(async (tx) => {
            const bizId = newBusinessId();
            await tx.insert(businesses).values({
              id: bizId,
              name: businessNameFromEmail(input.email),
              instructions: defaultBusinessInstructions(),
              createdAt: now,
              updatedAt: now,
            });
            const [created] = await tx
              .insert(users)
              .values({
                email: input.email,
                whatsappConnected,
                businessId: bizId,
                createdAt: now,
                updatedAt: now,
              })
              .returning();
            return created;
          });
        }

        const [created] = await db
          .insert(users)
          .values({
            email: input.email,
            whatsappConnected,
            businessId: requestedBusinessId,
            createdAt: now,
            updatedAt: now,
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
