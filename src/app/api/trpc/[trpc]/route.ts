import { appRouter } from "@/server/routers";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { db } from "@/server/db/client";
import { businesses, users } from "@/../drizzle/schema";
import { controlDb } from "@/server/control/db";
import { suiteEntitlements, suiteMemberships, suiteTenants, suiteUsers } from "@/server/control/schema";
import { and, eq, sql } from "drizzle-orm";
import { syncFirebaseSuiteClaims, verifyFirebaseIdToken } from "@/server/firebaseAdmin";
import { checkRateLimit } from "@/server/rateLimit";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function withExtraHeaders(res: Response, extra: Record<string, string>) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

const handler = async (req: Request) => {
  const max = Number(process.env.RATE_LIMIT_TRPC_MAX ?? "300");
  const windowMs = Number(process.env.RATE_LIMIT_TRPC_WINDOW_MS ?? String(60_000));
  const rl = checkRateLimit(req, { name: "trpc", max, windowMs });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too Many Requests" },
      {
        status: 429,
        headers: {
          ...rl.headers,
          "retry-after": String(Math.max(1, Math.ceil((rl.resetAtMs - Date.now()) / 1000))),
        },
      },
    );
  }

  const res = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async () => {
      const auth = req.headers.get("authorization") || "";
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (!m) return { userEmail: null, firebaseUid: null, userId: null, businessId: null };

      try {
        const decoded = await verifyFirebaseIdToken(m[1]);
        const userEmail = decoded.email || null;
        const firebaseUid = decoded.uid || null;
        if (!userEmail || !firebaseUid) {
          return { userEmail: null, firebaseUid: null, userId: null, businessId: null };
        }

        const claimModules = Array.isArray((decoded as Record<string, unknown>).modules)
          ? ((decoded as Record<string, unknown>).modules as unknown[]).filter((m): m is string => typeof m === "string")
          : [];
        const hasAgentClaim = claimModules.includes("agent");
        const claimSuiteTenantId =
          typeof (decoded as Record<string, unknown>).suiteTenantId === "string"
            ? ((decoded as Record<string, unknown>).suiteTenantId as string)
            : null;

        let user = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid)).then((r) => r[0] ?? null);

        if (!user) {
          user = await db.select().from(users).where(eq(users.email, userEmail)).then((r) => r[0] ?? null);
          if (user && !user.firebaseUid) {
            const repaired = await db
              .update(users)
              .set({ firebaseUid, updatedAt: new Date() })
              .where(and(eq(users.id, user.id), eq(users.email, userEmail)))
              .returning();
            user = repaired[0] ?? user;
          }
        }
        if (!user) {
          return { userEmail, firebaseUid, userId: null, businessId: null };
        }

        const business = user?.businessId
          ? await db.select().from(businesses).where(eq(businesses.id, user.businessId)).then((r) => r[0] ?? null)
          : null;
        if (!business) {
          return { userEmail, firebaseUid, userId: (user?.id as string) ?? null, businessId: null };
        }

        if (hasAgentClaim && claimSuiteTenantId && business.suiteTenantId && claimSuiteTenantId === business.suiteTenantId && user.suiteUserId) {
          return {
            userEmail,
            firebaseUid,
            userId: (user?.id as string) ?? null,
            businessId: (user?.businessId as string) ?? null,
          };
        }

        let suiteUser = await controlDb.select().from(suiteUsers).where(eq(suiteUsers.firebaseUid, firebaseUid)).then((r) => r[0] ?? null);
        if (!suiteUser) {
          const createdSuiteUser = await controlDb
            .insert(suiteUsers)
            .values({ firebaseUid, email: userEmail, displayName: userEmail.split("@")[0] || "User" })
            .returning();
          suiteUser = createdSuiteUser[0] ?? null;
        }
        if (!suiteUser) {
          return { userEmail: null, firebaseUid: null, userId: null, businessId: null };
        }

        if (!user.suiteUserId) {
          const repaired = await db
            .update(users)
            .set({ suiteUserId: suiteUser.id, updatedAt: new Date() })
            .where(eq(users.id, user.id))
            .returning();
          user = repaired[0] ?? user;
        }

        let suiteTenantId = business.suiteTenantId;
        if (!suiteTenantId) {
          const createdTenant = await controlDb
            .insert(suiteTenants)
            .values({
              name: business.name || `Business ${business.id.slice(0, 8)}`,
              metadata: { seededFrom: "agent.businesses", businessId: business.id }
            })
            .returning();
          suiteTenantId = createdTenant[0]?.id ?? null;
          if (!suiteTenantId) {
            return { userEmail, firebaseUid, userId: null, businessId: null };
          }
          await db
            .update(businesses)
            .set({ suiteTenantId, updatedAt: new Date() })
            .where(eq(businesses.id, business.id));
        }

        let membership = await controlDb
          .select()
          .from(suiteMemberships)
          .where(and(eq(suiteMemberships.suiteTenantId, suiteTenantId), eq(suiteMemberships.suiteUserId, suiteUser.id)))
          .then((r) => r[0] ?? null);
        if (!membership) {
          const existingMemberships = await controlDb
            .select({ count: sql<number>`count(*)::int` })
            .from(suiteMemberships)
            .where(eq(suiteMemberships.suiteTenantId, suiteTenantId));
          const isFirst = (existingMemberships[0]?.count ?? 0) === 0;
          if (isFirst) {
            const createdMembership = await controlDb
              .insert(suiteMemberships)
              .values({
                suiteTenantId,
                suiteUserId: suiteUser.id,
                role: "owner",
                isActive: true
              })
              .returning();
            membership = createdMembership[0] ?? null;
          }
        }
        if (!membership?.isActive) {
          return { userEmail, firebaseUid, userId: null, businessId: null };
        }

        let entitlement = await controlDb
          .select()
          .from(suiteEntitlements)
          .where(and(eq(suiteEntitlements.suiteTenantId, suiteTenantId), eq(suiteEntitlements.module, "agent")))
          .then((r) => r[0] ?? null);
        if (!entitlement) {
          const existingEntitlements = await controlDb
            .select({ count: sql<number>`count(*)::int` })
            .from(suiteEntitlements)
            .where(eq(suiteEntitlements.suiteTenantId, suiteTenantId));
          const isFirstEntitlement = (existingEntitlements[0]?.count ?? 0) === 0;
          if (isFirstEntitlement) {
            const createdEntitlement = await controlDb
              .insert(suiteEntitlements)
              .values({
                suiteTenantId,
                module: "agent",
                status: "active",
                metadata: { seeded: true }
              })
              .returning();
            entitlement = createdEntitlement[0] ?? null;
          }
        }
        if (!entitlement || !["active", "trial"].includes(String(entitlement.status))) {
          return { userEmail, firebaseUid, userId: null, businessId: null };
        }

        void syncFirebaseSuiteClaims(firebaseUid, {
          suiteTenantId,
          suiteUserId: suiteUser.id,
          modules: ["agent"],
        }).catch(() => {});

        return {
          userEmail,
          firebaseUid,
          userId: (user?.id as string) ?? null,
          businessId: (user?.businessId as string) ?? null,
        };
      } catch {
        return { userEmail: null, firebaseUid: null, userId: null, businessId: null };
      }
    },
  });

  return withExtraHeaders(res, rl.headers);
};

export { handler as GET, handler as POST };
