/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { router, protectedProcedure, businessProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { db } from "../db/client";
import crypto from "crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { businesses, businessUserInvites, users } from "../../../drizzle/schema";
import { controlDb } from "@/server/control/db";
import { suiteMemberships, suiteTenants, suiteUsers } from "@/server/control/schema";
import { getTenantModuleAccess } from "@/server/control/access";
import { syncFirebaseSuiteClaims } from "@/server/firebaseAdmin";
import { ensureDefaultTicketTypes } from "../services/ticketDefaults";
import { sendBusinessGmailMessage } from "../services/companyGmail";
import { recordBusinessEvent } from "@/lib/business-monitoring";

const ACCESS_LEVELS = ["admin", "manager", "staff"] as const;
type AccessLevel = (typeof ACCESS_LEVELS)[number];

function defaultBusinessInstructions() {
  return "You are a helpful AI sales and support assistant. Use the uploaded business documents as the source of truth. If information is missing, ask a clarifying question.";
}

function newBusinessId() {
  return crypto.randomUUID();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function businessNameFromEmail(email: string) {
  const domain = email.split("@")[1] || "";
  return domain ? `Business (${domain})` : "Business";
}

function hashInviteToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function inviteBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

function membershipRoleFromAccessLevel(accessLevel: AccessLevel) {
  return accessLevel === "admin" ? "admin" : "member";
}

function accessLevelFromMembershipRole(role?: string | null): AccessLevel {
  return role === "owner" || role === "admin" ? "admin" : "staff";
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

async function ensureTenantMembership(suiteTenantId: string, suiteUserId: string, role: "owner" | "admin" | "member") {
  const membership = await controlDb
    .select()
    .from(suiteMemberships)
    .where(and(eq(suiteMemberships.suiteTenantId, suiteTenantId), eq(suiteMemberships.suiteUserId, suiteUserId)))
    .then((r) => r[0] ?? null);

  if (membership) {
    const finalRole = membership.role === "owner" || (membership.role === "admin" && role === "member") ? membership.role : role;
    const updated = await controlDb
      .update(suiteMemberships)
      .set({ role: finalRole, isActive: true, updatedAt: new Date() })
      .where(and(eq(suiteMemberships.suiteTenantId, suiteTenantId), eq(suiteMemberships.suiteUserId, suiteUserId)))
      .returning();
    return updated[0] ?? membership;
  }

  const created = await controlDb
    .insert(suiteMemberships)
    .values({
      suiteTenantId,
      suiteUserId,
      role,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [suiteMemberships.suiteTenantId, suiteMemberships.suiteUserId],
      set: { role, isActive: true, updatedAt: new Date() },
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
  return { business: { ...business, suiteTenantId }, suiteTenantId };
}

async function syncAgentClaims(firebaseUid: string, suiteTenantId: string, suiteUserId: string) {
  await syncFirebaseSuiteClaims(firebaseUid, {
    suiteTenantId,
    suiteUserId,
    modules: ["agent"],
  });
}

async function getExistingUser(firebaseUid: string, email: string) {
  let existing = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid)).then((r) => r[0] ?? null);
  if (!existing) {
    existing = await db
      .select()
      .from(users)
      .where(or(eq(users.email, email), eq(users.firebaseUid, firebaseUid)))
      .then((r) => r[0] ?? null);
  }
  return existing;
}

async function requireBusinessAdmin(ctx: { businessId?: string | null; firebaseUid?: string | null; userEmail?: string | null }) {
  if (!ctx.businessId || !ctx.firebaseUid || !ctx.userEmail) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }

  const user = await db
    .select()
    .from(users)
    .where(and(eq(users.businessId, ctx.businessId), or(eq(users.firebaseUid, ctx.firebaseUid), eq(users.email, ctx.userEmail))))
    .then((r) => r[0] ?? null);
  if (!user) throw new TRPCError({ code: "FORBIDDEN", message: "User is not part of this business" });

  const businessTenant = await ensureBusinessTenant(ctx.businessId, businessNameFromEmail(ctx.userEmail));
  if (!businessTenant || !user.suiteUserId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Business membership is not initialized" });
  }

  const membership = await controlDb
    .select()
    .from(suiteMemberships)
    .where(and(eq(suiteMemberships.suiteTenantId, businessTenant.suiteTenantId), eq(suiteMemberships.suiteUserId, user.suiteUserId)))
    .then((r) => r[0] ?? null);

  if (!membership?.isActive || !["owner", "admin"].includes(String(membership.role))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only business admins can manage users" });
  }

  return { user, businessTenant, membership };
}

async function listActiveAdminMemberships(suiteTenantId: string) {
  const memberships = await controlDb
    .select()
    .from(suiteMemberships)
    .where(eq(suiteMemberships.suiteTenantId, suiteTenantId));
  return memberships.filter((membership) => membership.isActive && ["owner", "admin"].includes(String(membership.role)));
}

async function maybeSyncAllowedClaims(firebaseUid: string, suiteTenantId: string, suiteUserId: string) {
  const access = await getTenantModuleAccess(suiteTenantId, "agent");
  if (access.allowed) {
    void syncAgentClaims(firebaseUid, suiteTenantId, suiteUserId).catch(() => {});
  }
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
        const email = normalizeEmail(input.email);
        if (ctx.userEmail && email !== normalizeEmail(ctx.userEmail)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
        }

        const firebaseUid = ctx.firebaseUid;
        if (!firebaseUid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Missing Firebase UID" });
        }

        const suiteUser = await ensureSuiteUser(firebaseUid, email);
        if (!suiteUser) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to initialize suite user" });
        }

        let existing = await getExistingUser(firebaseUid, email);
        if (existing && (!existing.firebaseUid || existing.firebaseUid !== firebaseUid || !existing.suiteUserId)) {
          const repaired = await db
            .update(users)
            .set({ firebaseUid, suiteUserId: suiteUser.id, updatedAt: new Date() })
            .where(and(eq(users.id, existing.id), eq(users.email, email)))
            .returning();
          existing = repaired[0] ?? existing;
        }

        if (!existing) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "No business is connected to this account. Create a business from signup or use an admin invite link.",
          });
        }

        await ensureDefaultTicketTypes(existing.businessId);
        const business = existing.businessId
          ? await db.select().from(businesses).where(eq(businesses.id, existing.businessId)).then((r) => r[0] ?? null)
          : null;
        if (business?.suiteTenantId && existing.suiteUserId) {
          await maybeSyncAllowedClaims(firebaseUid, business.suiteTenantId, existing.suiteUserId);
        }
        return existing;
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        const msg = String(err?.message || "Database error");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }
    }),

  getMe: protectedProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input, ctx }) => {
      try {
        const email = normalizeEmail(input.email);
        if (!ctx.userEmail || !ctx.firebaseUid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
        }
        if (email !== normalizeEmail(ctx.userEmail)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
        }

        let user = await db.select().from(users).where(eq(users.firebaseUid, ctx.firebaseUid)).then((r) => r[0] ?? null);
        if (!user) {
          user = await db.select().from(users).where(eq(users.email, email)).then((r) => r[0] ?? null);
        }

        if (user && !user.suiteUserId) {
          const suiteUser = await ensureSuiteUser(ctx.firebaseUid, email);
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
        if (err instanceof TRPCError) throw err;
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

  getAccessStatus: protectedProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input, ctx }) => {
      const email = normalizeEmail(input.email);
      if (!ctx.userEmail || !ctx.firebaseUid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
      }
      if (email !== normalizeEmail(ctx.userEmail)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }

      const user =
        (await db.select().from(users).where(eq(users.firebaseUid, ctx.firebaseUid)).then((r) => r[0] ?? null)) ??
        (await db.select().from(users).where(eq(users.email, email)).then((r) => r[0] ?? null));

      if (!user?.businessId) {
        return {
          allowed: false,
          canConnectWhatsapp: false,
          isGrandfathered: false,
          reason: "subscription_missing",
          planCode: null,
          planName: null,
          subscriptionStatus: null,
          grantKind: null,
          lastPaidAt: null,
          nextDueAt: null,
        };
      }

      const business = await db.select().from(businesses).where(eq(businesses.id, user.businessId)).then((r) => r[0] ?? null);
      if (!business?.suiteTenantId) {
        return {
          allowed: false,
          canConnectWhatsapp: false,
          isGrandfathered: false,
          reason: "subscription_missing",
          planCode: null,
          planName: null,
          subscriptionStatus: null,
          grantKind: null,
          lastPaidAt: null,
          nextDueAt: null,
        };
      }

      return getTenantModuleAccess(business.suiteTenantId, "agent");
    }),

  upsert: protectedProcedure
    .input(
      z.object({
        email: z.string().email(),
        whatsappConnected: z.boolean().optional(),
        businessId: z.string().min(1).optional(),
        businessName: z.string().min(1).max(160).optional(),
        inviteToken: z.string().min(10).optional(),
        firstName: z.string().max(120).optional(),
        lastName: z.string().max(120).optional(),
        phone: z.string().max(80).optional(),
        country: z.string().max(120).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const email = normalizeEmail(input.email);
        if (!ctx.userEmail || !ctx.firebaseUid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
        }
        if (email !== normalizeEmail(ctx.userEmail)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
        }

        const now = new Date();
        const ownerProfile = {
          firstName: input.firstName?.trim() || "",
          lastName: input.lastName?.trim() || "",
          phone: input.phone?.trim() || "",
          country: input.country?.trim() || "",
        };
        const whatsappConnected = input.whatsappConnected ?? false;
        const suiteUser = await ensureSuiteUser(ctx.firebaseUid, email);
        if (!suiteUser) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to initialize suite user" });

        let existing = await getExistingUser(ctx.firebaseUid, email);

        if (input.inviteToken) {
          const tokenHash = hashInviteToken(input.inviteToken);
          const invite = await db
            .select()
            .from(businessUserInvites)
            .where(and(eq(businessUserInvites.tokenHash, tokenHash), isNull(businessUserInvites.acceptedAt), gt(businessUserInvites.expiresAt, now)))
            .then((r) => r[0] ?? null);

          if (!invite || normalizeEmail(invite.email) !== email) {
            throw new TRPCError({ code: "FORBIDDEN", message: "This invite is invalid, expired, or belongs to another email." });
          }

          if (existing && existing.businessId !== invite.businessId) {
            throw new TRPCError({ code: "CONFLICT", message: "This account already belongs to another business. Use a different account for this invite." });
          }

          const businessTenant = await ensureBusinessTenant(invite.businessId, businessNameFromEmail(email));
          if (!businessTenant) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

          const membershipRole = invite.role === "admin" ? "admin" : "member";
          await ensureTenantMembership(businessTenant.suiteTenantId, suiteUser.id, membershipRole);

          if (existing) {
            const [updated] = await db
              .update(users)
              .set({ email, firebaseUid: ctx.firebaseUid, suiteUserId: suiteUser.id, whatsappConnected, updatedAt: now })
              .where(eq(users.id, existing.id))
              .returning();
            existing = updated ?? existing;
          } else {
            const [created] = await db
              .insert(users)
              .values({
                email,
                firebaseUid: ctx.firebaseUid,
                suiteUserId: suiteUser.id,
                whatsappConnected,
                businessId: invite.businessId,
                createdAt: now,
                updatedAt: now,
              })
              .returning();
            existing = created;
          }

          await db.update(businessUserInvites).set({ acceptedAt: now, updatedAt: now }).where(eq(businessUserInvites.id, invite.id));
          await ensureDefaultTicketTypes(invite.businessId);
          await maybeSyncAllowedClaims(ctx.firebaseUid, businessTenant.suiteTenantId, suiteUser.id);
          return existing;
        }

        if (existing) {
          if (input.businessId && input.businessId !== existing.businessId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Business switching is disabled. Use an invite with a separate account if needed." });
          }

          const businessTenant = await ensureBusinessTenant(existing.businessId, businessNameFromEmail(email));
          if (!businessTenant) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
          }

          await ensureTenantMembership(businessTenant.suiteTenantId, suiteUser.id, "member");
          await maybeSyncAllowedClaims(ctx.firebaseUid, businessTenant.suiteTenantId, suiteUser.id);

          const [updated] = await db
            .update(users)
            .set({
              email,
              firebaseUid: ctx.firebaseUid,
              suiteUserId: suiteUser.id,
              whatsappConnected,
              updatedAt: now,
            })
            .where(eq(users.id, existing.id))
            .returning();
          await ensureDefaultTicketTypes(existing.businessId);
          return updated;
        }

        if (input.businessId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Joining a business requires an admin invite link." });
        }

        const businessName = input.businessName?.trim() || businessNameFromEmail(email);
        const created = await db.transaction(async (tx) => {
          const [suiteTenant] = await controlDb
            .insert(suiteTenants)
            .values({
              name: businessName,
              metadata: { seededFrom: "agent.user.signup.create" },
            })
            .returning();

          const bizId = newBusinessId();
          await tx.insert(businesses).values({
            id: bizId,
            suiteTenantId: suiteTenant.id,
            name: businessName,
            instructions: defaultBusinessInstructions(),
            settings: { onboarding: { ownerProfile } },
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

          const [createdUser] = await tx
            .insert(users)
            .values({
              email,
              firebaseUid: ctx.firebaseUid,
              suiteUserId: suiteUser.id,
              whatsappConnected,
              businessId: bizId,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          return { user: createdUser, businessId: bizId, suiteTenantId: suiteTenant.id };
        });
        await ensureDefaultTicketTypes(created.businessId);
        await maybeSyncAllowedClaims(ctx.firebaseUid, created.suiteTenantId, suiteUser.id);
        recordBusinessEvent({
          event: "auth.user_upserted",
          action: "upsert",
          area: "auth",
          businessId: created.businessId,
          entity: "user",
          entityId: created.user.id,
          userId: created.user.id,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
          actorType: "user",
          outcome: "success",
          attributes: {
            business_created: true,
            created: true,
            requested_business_id: null,
            whatsapp_connected: whatsappConnected,
          },
        });
        return created.user;
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
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

  listTeam: businessProcedure.query(async ({ ctx }) => {
    const admin = await requireBusinessAdmin(ctx);
    const team = await db.select().from(users).where(eq(users.businessId, ctx.businessId));
    const membershipRows = await controlDb
      .select()
      .from(suiteMemberships)
      .where(eq(suiteMemberships.suiteTenantId, admin.businessTenant.suiteTenantId));
    const membershipBySuiteUser = new Map(membershipRows.map((membership) => [membership.suiteUserId, membership]));

    return team.map((member) => {
      const membership = member.suiteUserId ? membershipBySuiteUser.get(member.suiteUserId) : null;
      return {
        id: member.id,
        email: member.email,
        businessId: member.businessId,
        role: membership?.role ?? "member",
        accessLevel: accessLevelFromMembershipRole(membership?.role),
        isActive: membership?.isActive ?? true,
        isCurrentUser: member.id === admin.user.id,
        createdAt: member.createdAt,
      };
    });
  }),

  listInvites: businessProcedure.query(async ({ ctx }) => {
    await requireBusinessAdmin(ctx);
    return db
      .select({
        id: businessUserInvites.id,
        email: businessUserInvites.email,
        role: businessUserInvites.role,
        expiresAt: businessUserInvites.expiresAt,
        createdAt: businessUserInvites.createdAt,
      })
      .from(businessUserInvites)
      .where(and(eq(businessUserInvites.businessId, ctx.businessId), isNull(businessUserInvites.acceptedAt), gt(businessUserInvites.expiresAt, new Date())));
  }),

  invite: businessProcedure
    .input(z.object({ email: z.string().email(), accessLevel: z.enum(ACCESS_LEVELS).default("staff") }))
    .mutation(async ({ input, ctx }) => {
      const admin = await requireBusinessAdmin(ctx);
      const email = normalizeEmail(input.email);
      const existing = await db
        .select()
        .from(users)
        .where(and(eq(users.businessId, ctx.businessId), eq(users.email, email)))
        .then((r) => r[0] ?? null);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "This email is already part of the business." });

      const token = crypto.randomBytes(32).toString("base64url");
      const inviteUrl = `${inviteBaseUrl()}/signup?invite=${encodeURIComponent(token)}`;
      const role = membershipRoleFromAccessLevel(input.accessLevel);
      const now = new Date();
      const [invite] = await db
        .insert(businessUserInvites)
        .values({
          id: crypto.randomUUID(),
          businessId: ctx.businessId,
          email,
          role,
          tokenHash: hashInviteToken(token),
          invitedByUserId: admin.user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      const businessName = admin.businessTenant.business.name || "your business";
      const emailResult = await sendBusinessGmailMessage({
        businessId: ctx.businessId,
        to: email,
        subject: `${businessName} invited you to Escal8 Concierge`,
        text: `You have been invited to join ${businessName} on Escal8 Concierge. Create your account here: ${inviteUrl}\n\nThis invite expires in 7 days.`,
        html: `<p>You have been invited to join <strong>${businessName}</strong> on Escal8 Concierge.</p><p><a href="${inviteUrl}">Create your account</a></p><p>This invite expires in 7 days.</p>`,
      });

      return { invite, inviteUrl, emailSent: emailResult.success, emailError: emailResult.error ?? null };
    }),

  cancelInvite: businessProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      await requireBusinessAdmin(ctx);
      await db
        .delete(businessUserInvites)
        .where(and(eq(businessUserInvites.id, input.id), eq(businessUserInvites.businessId, ctx.businessId), isNull(businessUserInvites.acceptedAt)));
      return { ok: true };
    }),

  setMemberRole: businessProcedure
    .input(z.object({ id: z.string().min(1), accessLevel: z.enum(ACCESS_LEVELS) }))
    .mutation(async ({ input, ctx }) => {
      const admin = await requireBusinessAdmin(ctx);
      const target = await db
        .select()
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.businessId, ctx.businessId)))
        .then((r) => r[0] ?? null);
      if (!target?.suiteUserId) throw new TRPCError({ code: "NOT_FOUND", message: "Team member not found" });

      const memberships = await listActiveAdminMemberships(admin.businessTenant.suiteTenantId);
      const targetMembership = memberships.find((membership) => membership.suiteUserId === target.suiteUserId);
      const demotingAdmin = targetMembership && ["owner", "admin"].includes(String(targetMembership.role)) && input.accessLevel !== "admin";
      if (demotingAdmin && memberships.length <= 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Promote another admin before demoting the last admin." });
      }

      const role = membershipRoleFromAccessLevel(input.accessLevel);
      const finalRole = targetMembership?.role === "owner" ? "owner" : role;
      await controlDb
        .update(suiteMemberships)
        .set({ role: finalRole, isActive: true, updatedAt: new Date() })
        .where(and(eq(suiteMemberships.suiteTenantId, admin.businessTenant.suiteTenantId), eq(suiteMemberships.suiteUserId, target.suiteUserId)));
      return { ...target, accessLevel: accessLevelFromMembershipRole(finalRole) };
    }),

  removeMember: businessProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const admin = await requireBusinessAdmin(ctx);
      if (input.id === admin.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot remove yourself." });

      const target = await db
        .select()
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.businessId, ctx.businessId)))
        .then((r) => r[0] ?? null);
      if (!target?.suiteUserId) throw new TRPCError({ code: "NOT_FOUND", message: "Team member not found" });

      const memberships = await listActiveAdminMemberships(admin.businessTenant.suiteTenantId);
      const targetMembership = memberships.find((membership) => membership.suiteUserId === target.suiteUserId);
      if (targetMembership && ["owner", "admin"].includes(String(targetMembership.role)) && memberships.length <= 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Promote another admin before removing the last admin." });
      }

      await controlDb
        .update(suiteMemberships)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(suiteMemberships.suiteTenantId, admin.businessTenant.suiteTenantId), eq(suiteMemberships.suiteUserId, target.suiteUserId)));
      await db.delete(users).where(and(eq(users.id, input.id), eq(users.businessId, ctx.businessId)));
      return { ok: true };
    }),
});
