/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { router, protectedProcedure, businessProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { db } from "../db/client";
import crypto from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { businesses, businessUserInvites, users } from "../../../drizzle/schema";
import { controlDb } from "@/server/control/db";
import { suiteMemberships, suiteTenants } from "@/server/control/schema";
import { getTenantModuleAccess } from "@/server/control/access";
import { ensureDefaultTicketTypes } from "../services/ticketDefaults";
import { sendBusinessGmailMessage } from "../services/companyGmail";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import * as support from "../services/userLifecycleSupport";

export const userRouter = router({
  ensure: protectedProcedure
    .mutation(async ({ ctx }) => {
      try {
        const email = support.normalizeEmail(ctx.userEmail!);
        const firebaseUid = ctx.firebaseUid;
        if (!firebaseUid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Missing Firebase UID" });
        }

        const suiteUser = await support.ensureSuiteUser(firebaseUid, email);
        if (!suiteUser) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to initialize suite user" });
        }

        let existing = await support.getExistingUser(firebaseUid, email);
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
          await support.maybeSyncAllowedClaims(firebaseUid, business.suiteTenantId, existing.suiteUserId);
        }
        return existing;
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        const msg = String(err?.message || "Database error");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }
    }),

  getMe: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const email = support.normalizeEmail(ctx.userEmail!);
        if (!ctx.firebaseUid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
        }

        let user = await db.select().from(users).where(eq(users.firebaseUid, ctx.firebaseUid)).then((r) => r[0] ?? null);
        if (!user) {
          user = await db.select().from(users).where(eq(users.email, email)).then((r) => r[0] ?? null);
        }

        if (user && !user.suiteUserId) {
          const suiteUser = await support.ensureSuiteUser(ctx.firebaseUid, email);
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
    .query(async ({ ctx }) => {
      const email = support.normalizeEmail(ctx.userEmail!);
      if (!ctx.firebaseUid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
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
        const email = support.normalizeEmail(ctx.userEmail!);
        if (!ctx.firebaseUid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
        }

        const now = new Date();
        const ownerProfile = {
          firstName: input.firstName?.trim() || "",
          lastName: input.lastName?.trim() || "",
          phone: input.phone?.trim() || "",
          country: input.country?.trim() || "",
        };
        const whatsappConnected = input.whatsappConnected ?? false;

        const suiteUser = await support.ensureSuiteUser(ctx.firebaseUid, email);
        if (!suiteUser) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to initialize suite user" });

        let existing = await support.getExistingUser(ctx.firebaseUid, email);

        if (input.inviteToken) {
          const tokenHash = support.hashInviteToken(input.inviteToken);
          const invite = await db
            .select()
            .from(businessUserInvites)
            .where(and(eq(businessUserInvites.tokenHash, tokenHash), isNull(businessUserInvites.acceptedAt), gt(businessUserInvites.expiresAt, now)))
            .then((r) => r[0] ?? null);

          if (!invite || support.normalizeEmail(invite.email) !== email) {
            throw new TRPCError({ code: "FORBIDDEN", message: "This invite is invalid, expired, or belongs to another email." });
          }

          if (existing && existing.businessId !== invite.businessId) {
            throw new TRPCError({ code: "CONFLICT", message: "This account already belongs to another business. Use a different account for this invite." });
          }

          const businessTenant = await support.ensureBusinessTenant(invite.businessId, support.businessNameFromEmail(email));
          if (!businessTenant) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

          const membershipRole = invite.role === "admin" ? "admin" : "member";
          await support.ensureTenantMembership(businessTenant.suiteTenantId, suiteUser.id, membershipRole);

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
          await support.maybeSyncAllowedClaims(ctx.firebaseUid, businessTenant.suiteTenantId, suiteUser.id);
          return existing;
        }

        if (existing) {
          if (input.businessId && input.businessId !== existing.businessId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Business switching is disabled. Use an invite with a separate account if needed." });
          }

          const businessTenant = await support.ensureBusinessTenant(existing.businessId, support.businessNameFromEmail(email));
          if (!businessTenant) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
          }

          await support.ensureTenantMembership(businessTenant.suiteTenantId, suiteUser.id, "member");
          await support.maybeSyncAllowedClaims(ctx.firebaseUid, businessTenant.suiteTenantId, suiteUser.id);

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

        const businessName = input.businessName?.trim() || support.businessNameFromEmail(email);
        const created = await db.transaction(async (tx) => {
          const [suiteTenant] = await controlDb
            .insert(suiteTenants)
            .values({
              name: businessName,
              metadata: { seededFrom: "agent.user.signup.create" },
            })
            .returning();

          const bizId = support.newBusinessId();
          await tx.insert(businesses).values({
            id: bizId,
            suiteTenantId: suiteTenant.id,
            name: businessName,
            instructions: support.defaultBusinessInstructions(),
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
        await support.maybeSyncAllowedClaims(ctx.firebaseUid, created.suiteTenantId, suiteUser.id);

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
    const admin = await support.requireBusinessAdmin(ctx);
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
        accessLevel: support.accessLevelFromMembershipRole(membership?.role),
        isActive: membership?.isActive ?? true,
        isCurrentUser: member.id === admin.user.id,
        createdAt: member.createdAt,
      };
    });
  }),

  listInvites: businessProcedure.query(async ({ ctx }) => {
    await support.requireBusinessAdmin(ctx);
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
    .input(z.object({ email: z.string().email(), accessLevel: z.enum(support.ACCESS_LEVELS).default("staff") }))
    .mutation(async ({ input, ctx }) => {
      const admin = await support.requireBusinessAdmin(ctx);
      const email = support.normalizeEmail(input.email);

      const existing = await db
        .select()
        .from(users)
        .where(and(eq(users.businessId, ctx.businessId), eq(users.email, email)))
        .then((r) => r[0] ?? null);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "This email is already part of the business." });

      const token = crypto.randomBytes(32).toString("base64url");
      const inviteUrl = `${support.inviteBaseUrl()}/signup?invite=${encodeURIComponent(token)}`;
      const role = support.membershipRoleFromAccessLevel(input.accessLevel);
      const now = new Date();
      const [invite] = await db
        .insert(businessUserInvites)
        .values({
          id: crypto.randomUUID(),
          businessId: ctx.businessId,
          email,
          role,
          tokenHash: support.hashInviteToken(token),
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
      await support.requireBusinessAdmin(ctx);
      await db
        .delete(businessUserInvites)
        .where(and(eq(businessUserInvites.id, input.id), eq(businessUserInvites.businessId, ctx.businessId), isNull(businessUserInvites.acceptedAt)));
      return { ok: true };
    }),

  setMemberRole: businessProcedure
    .input(z.object({ id: z.string().min(1), accessLevel: z.enum(support.ACCESS_LEVELS) }))
    .mutation(async ({ input, ctx }) => {
      const admin = await support.requireBusinessAdmin(ctx);
      const target = await db
        .select()
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.businessId, ctx.businessId)))
        .then((r) => r[0] ?? null);
      if (!target?.suiteUserId) throw new TRPCError({ code: "NOT_FOUND", message: "Team member not found" });

      const memberships = await support.listActiveAdminMemberships(admin.businessTenant.suiteTenantId);
      const targetMembership = memberships.find((membership) => membership.suiteUserId === target.suiteUserId);
      const demotingAdmin = targetMembership && ["owner", "admin"].includes(String(targetMembership.role)) && input.accessLevel !== "admin";
      if (demotingAdmin && memberships.length <= 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Promote another admin before demoting the last admin." });
      }

      const role = support.membershipRoleFromAccessLevel(input.accessLevel);
      const finalRole = targetMembership?.role === "owner" ? "owner" : role;
      await controlDb
        .update(suiteMemberships)
        .set({ role: finalRole, isActive: true, updatedAt: new Date() })
        .where(and(eq(suiteMemberships.suiteTenantId, admin.businessTenant.suiteTenantId), eq(suiteMemberships.suiteUserId, target.suiteUserId)));

      return { ...target, accessLevel: support.accessLevelFromMembershipRole(finalRole) };
    }),

  removeMember: businessProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const admin = await support.requireBusinessAdmin(ctx);
      if (input.id === admin.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot remove yourself." });

      const target = await db
        .select()
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.businessId, ctx.businessId)))
        .then((r) => r[0] ?? null);
      if (!target?.suiteUserId) throw new TRPCError({ code: "NOT_FOUND", message: "Team member not found" });

      const memberships = await support.listActiveAdminMemberships(admin.businessTenant.suiteTenantId);
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
