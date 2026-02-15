/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { db } from "../db/client";
import crypto from "crypto";
import { and, eq, or } from "drizzle-orm";
import { businesses, users } from "../../../drizzle/schema";
import { controlDb } from "@/server/control/db";
import { suiteEntitlements, suiteMemberships, suiteTenants, suiteUsers } from "@/server/control/schema";
import { syncFirebaseSuiteClaims } from "@/server/firebaseAdmin";
import { ensureDefaultTicketTypes } from "../services/ticketDefaults";

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

async function ensureSuiteUser(firebaseUid: string, email: string) {
  let suiteUser = await controlDb.select().from(suiteUsers).where(eq(suiteUsers.firebaseUid, firebaseUid)).then((r) => r[0] ?? null);
  if (!suiteUser) {
    const created = await controlDb
      .insert(suiteUsers)
      .values({
        firebaseUid,
        email,
        displayName: email.split("@")[0] || "User",
      })
      .returning();
    suiteUser = created[0] ?? null;
  }
  return suiteUser;
}

async function ensureTenantOwnership(suiteTenantId: string, suiteUserId: string, asOwner = false) {
  const membership = await controlDb
    .select()
    .from(suiteMemberships)
    .where(and(eq(suiteMemberships.suiteTenantId, suiteTenantId), eq(suiteMemberships.suiteUserId, suiteUserId)))
    .then((r) => r[0] ?? null);

  if (membership) return membership;

  const created = await controlDb
    .insert(suiteMemberships)
    .values({
      suiteTenantId,
      suiteUserId,
      role: asOwner ? "owner" : "member",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [suiteMemberships.suiteTenantId, suiteMemberships.suiteUserId],
      set: { isActive: true, updatedAt: new Date() },
    })
    .returning();

  return created[0] ?? null;
}

async function ensureAgentEntitlement(suiteTenantId: string) {
  const existing = await controlDb
    .select()
    .from(suiteEntitlements)
    .where(and(eq(suiteEntitlements.suiteTenantId, suiteTenantId), eq(suiteEntitlements.module, "agent")))
    .then((r) => r[0] ?? null);

  if (existing) return existing;

  const created = await controlDb
    .insert(suiteEntitlements)
    .values({
      suiteTenantId,
      module: "agent",
      status: "active",
      metadata: { seeded: true },
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [suiteEntitlements.suiteTenantId, suiteEntitlements.module],
      set: { status: "active", updatedAt: new Date() },
    })
    .returning();

  return created[0] ?? null;
}

async function ensureBusinessTenant(businessId: string, fallbackName: string) {
  const business = await db.select().from(businesses).where(eq(businesses.id, businessId)).then((r) => r[0] ?? null);
  if (!business) return null;

  if (business.suiteTenantId) return { business, suiteTenantId: business.suiteTenantId };

  const createdTenant = await controlDb
    .insert(suiteTenants)
    .values({
      name: business.name || fallbackName,
      metadata: { seededFrom: "agent.business", businessId },
    })
    .returning();

  const suiteTenantId = createdTenant[0]?.id;
  if (!suiteTenantId) return null;

  await db.update(businesses).set({ suiteTenantId, updatedAt: new Date() }).where(eq(businesses.id, businessId));
  return { business, suiteTenantId };
}

async function syncAgentClaims(firebaseUid: string, suiteTenantId: string, suiteUserId: string) {
  await syncFirebaseSuiteClaims(firebaseUid, {
    suiteTenantId,
    suiteUserId,
    modules: ["agent"],
  });
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

        const firebaseUid = ctx.firebaseUid;
        if (!firebaseUid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Missing Firebase UID" });
        }

        const suiteUser = await ensureSuiteUser(firebaseUid, input.email);
        if (!suiteUser) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to initialize suite user" });
        }

        let existing = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid)).then((r) => r[0] ?? null);
        if (!existing) {
          existing = await db.select().from(users).where(eq(users.email, input.email)).then((r) => r[0] ?? null);
          if (existing) {
            const repaired = await db
              .update(users)
              .set({ firebaseUid, suiteUserId: suiteUser.id, updatedAt: new Date() })
              .where(and(eq(users.id, existing.id), eq(users.email, input.email)))
              .returning();
            existing = repaired[0] ?? existing;
          }
        }

        if (existing) {
          await ensureDefaultTicketTypes(existing.businessId);
          const business = existing.businessId
            ? await db.select().from(businesses).where(eq(businesses.id, existing.businessId)).then((r) => r[0] ?? null)
            : null;
          if (business?.suiteTenantId && existing.suiteUserId) {
            void syncAgentClaims(firebaseUid, business.suiteTenantId, existing.suiteUserId).catch(() => {});
          }
          return existing;
        }

        const now = new Date();
        const created = await db.transaction(async (tx) => {
          const [suiteTenant] = await controlDb
            .insert(suiteTenants)
            .values({
              name: businessNameFromEmail(input.email),
              metadata: { seededFrom: "agent.user.ensure" },
            })
            .returning();

          const bizId = newBusinessId();
          await tx.insert(businesses).values({
            id: bizId,
            suiteTenantId: suiteTenant.id,
            name: businessNameFromEmail(input.email),
            instructions: defaultBusinessInstructions(),
            createdAt: now,
            updatedAt: now,
          });

          await controlDb.insert(suiteMemberships).values({
            suiteTenantId: suiteTenant.id,
            suiteUserId: suiteUser.id,
            role: "owner",
            isActive: true,
            createdAt: now,
            updatedAt: now,
          });

          await controlDb.insert(suiteEntitlements).values({
            suiteTenantId: suiteTenant.id,
            module: "agent",
            status: "active",
            metadata: { seeded: true },
            createdAt: now,
            updatedAt: now,
          });

          const [u] = await tx
            .insert(users)
            .values({
              email: input.email,
              firebaseUid,
              suiteUserId: suiteUser.id,
              whatsappConnected: false,
              businessId: bizId,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          void syncAgentClaims(firebaseUid, suiteTenant.id, suiteUser.id).catch(() => {});
          return { user: u, businessId: bizId };
        });
        await ensureDefaultTicketTypes(created.businessId);
        return created.user;
      } catch (err: any) {
        const msg = String(err?.message || "Database error");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }
    }),

  getMe: protectedProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input, ctx }) => {
      try {
        if (!ctx.userEmail || !ctx.firebaseUid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
        }
        if (input.email !== ctx.userEmail) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
        }

        let user = await db.select().from(users).where(eq(users.firebaseUid, ctx.firebaseUid)).then((r) => r[0] ?? null);

        if (!user) {
          user = await db.select().from(users).where(eq(users.email, input.email)).then((r) => r[0] ?? null);
        }

        if (user && !user.suiteUserId) {
          const suiteUser = await ensureSuiteUser(ctx.firebaseUid, input.email);
          if (suiteUser) {
            const repaired = await db
              .update(users)
              .set({ suiteUserId: suiteUser.id, updatedAt: new Date() })
              .where(eq(users.id, user.id))
              .returning();
            user = repaired[0] ?? user;
          }
        }

        return user;
      } catch (err: any) {
        const msg = String(err?.message || "Database error");
        if (msg.includes("relation") && msg.includes("does not exist")) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Users table not found. Ensure the database is initialized/migrated before use.",
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
        if (!ctx.userEmail || !ctx.firebaseUid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
        }
        if (input.email !== ctx.userEmail) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
        }

        const now = new Date();
        const whatsappConnected = input.whatsappConnected ?? false;
        const requestedBusinessId = input.businessId;

        const suiteUser = await ensureSuiteUser(ctx.firebaseUid, input.email);
        if (!suiteUser) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to initialize suite user" });

        let existing = await db.select().from(users).where(eq(users.firebaseUid, ctx.firebaseUid)).then((r) => r[0] ?? null);
        if (!existing) {
          existing = await db
            .select()
            .from(users)
            .where(or(eq(users.email, input.email), eq(users.firebaseUid, ctx.firebaseUid)))
            .then((r) => r[0] ?? null);
        }

        if (existing) {
          const finalBusinessId = requestedBusinessId || existing.businessId;
          if (!finalBusinessId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Business assignment missing" });
          }

          const businessTenant = await ensureBusinessTenant(finalBusinessId, businessNameFromEmail(input.email));
          if (!businessTenant) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
          }

          await ensureTenantOwnership(businessTenant.suiteTenantId, suiteUser.id, false);
          await ensureAgentEntitlement(businessTenant.suiteTenantId);
          void syncAgentClaims(ctx.firebaseUid, businessTenant.suiteTenantId, suiteUser.id).catch(() => {});

          const [updated] = await db
            .update(users)
            .set({
              email: input.email,
              firebaseUid: ctx.firebaseUid,
              suiteUserId: suiteUser.id,
              whatsappConnected,
              businessId: finalBusinessId,
              updatedAt: now,
            })
            .where(eq(users.id, existing.id))
            .returning();
          await ensureDefaultTicketTypes(finalBusinessId);
          return updated;
        }

        if (!requestedBusinessId) {
          const created = await db.transaction(async (tx) => {
            const [suiteTenant] = await controlDb
              .insert(suiteTenants)
              .values({
                name: businessNameFromEmail(input.email),
                metadata: { seededFrom: "agent.user.upsert.create" },
              })
              .returning();

            const bizId = newBusinessId();
            await tx.insert(businesses).values({
              id: bizId,
              suiteTenantId: suiteTenant.id,
              name: businessNameFromEmail(input.email),
              instructions: defaultBusinessInstructions(),
              createdAt: now,
              updatedAt: now,
            });

            await controlDb.insert(suiteMemberships).values({
              suiteTenantId: suiteTenant.id,
              suiteUserId: suiteUser.id,
              role: "owner",
              isActive: true,
              createdAt: now,
              updatedAt: now,
            });

            await controlDb.insert(suiteEntitlements).values({
              suiteTenantId: suiteTenant.id,
              module: "agent",
              status: "active",
              metadata: { seeded: true },
              createdAt: now,
              updatedAt: now,
            });

            const [created] = await tx
              .insert(users)
              .values({
                email: input.email,
                firebaseUid: ctx.firebaseUid,
                suiteUserId: suiteUser.id,
                whatsappConnected,
                businessId: bizId,
                createdAt: now,
                updatedAt: now,
              })
              .returning();
            void syncAgentClaims(ctx.firebaseUid, suiteTenant.id, suiteUser.id).catch(() => {});
            return { user: created, businessId: bizId };
          });
          await ensureDefaultTicketTypes(created.businessId);
          return created.user;
        }

        const businessTenant = await ensureBusinessTenant(requestedBusinessId, businessNameFromEmail(input.email));
        if (!businessTenant) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
        }
        await ensureTenantOwnership(businessTenant.suiteTenantId, suiteUser.id, false);
        await ensureAgentEntitlement(businessTenant.suiteTenantId);
        void syncAgentClaims(ctx.firebaseUid, businessTenant.suiteTenantId, suiteUser.id).catch(() => {});

        const [created] = await db
          .insert(users)
          .values({
            email: input.email,
            firebaseUid: ctx.firebaseUid,
            suiteUserId: suiteUser.id,
            whatsappConnected,
            businessId: requestedBusinessId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        await ensureDefaultTicketTypes(requestedBusinessId);
        return created;
      } catch (err: any) {
        const msg = String(err?.message || "Database error");
        if (msg.includes("relation") && msg.includes("does not exist")) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Users table not found. Please run the DB init/migration task before logging in.",
          });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }
    }),
});

