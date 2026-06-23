import { TRPCError } from "@trpc/server";
import { and, eq, or } from "drizzle-orm";
import crypto from "crypto";
import { db } from "../db/client";
import { controlDb } from "@/server/control/db";
import { businesses, users } from "../../../drizzle/schema";
import { suiteMemberships, suiteTenants, suiteUsers } from "@/server/control/schema";
import { getTenantModuleAccess } from "@/server/control/access";
import { syncFirebaseSuiteClaims } from "@/server/firebaseAdmin";
export const ACCESS_LEVELS = ["admin", "manager", "staff"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export function defaultBusinessInstructions() {
  return "You are a helpful AI sales and support assistant. Use the uploaded business documents as the source of truth. If information is missing, ask a clarifying question.";
}

export function newBusinessId() {
  return crypto.randomUUID();
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function businessNameFromEmail(email: string) {
  const domain = email.split("@")[1] || "";
  return domain ? `Business (${domain})` : "Business";
}

export function hashInviteToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function inviteBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function membershipRoleFromAccessLevel(accessLevel: AccessLevel) {
  return accessLevel === "admin" ? "admin" : "member";
}

export function accessLevelFromMembershipRole(role?: string | null): AccessLevel {
  return role === "owner" || role === "admin" ? "admin" : "staff";
}

export async function ensureSuiteUser(firebaseUid: string, email: string) {
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

export async function ensureTenantMembership(suiteTenantId: string, suiteUserId: string, role: "owner" | "admin" | "member") {
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

export async function ensureBusinessTenant(businessId: string, fallbackName: string) {
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

export async function syncAgentClaims(firebaseUid: string, suiteTenantId: string, suiteUserId: string) {
  await syncFirebaseSuiteClaims(firebaseUid, {
    suiteTenantId,
    suiteUserId,
    modules: ["agent"],
  });
}

export async function getExistingUser(firebaseUid: string, email: string) {
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

export async function requireBusinessAdmin(ctx: { businessId?: string | null; firebaseUid?: string | null; userEmail?: string | null }) {
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

export async function listActiveAdminMemberships(suiteTenantId: string) {
  const memberships = await controlDb
    .select()
    .from(suiteMemberships)
    .where(eq(suiteMemberships.suiteTenantId, suiteTenantId));
  return memberships.filter((membership) => membership.isActive && ["owner", "admin"].includes(String(membership.role)));
}

export async function maybeSyncAllowedClaims(firebaseUid: string, suiteTenantId: string, suiteUserId: string) {
  const access = await getTenantModuleAccess(suiteTenantId, "agent");
  if (access.allowed) {
    void syncAgentClaims(firebaseUid, suiteTenantId, suiteUserId).catch(() => {});
  }
}
