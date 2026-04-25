import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { businesses, users } from "@/../drizzle/schema";
import { db } from "@/server/db/client";
import { verifyFirebaseIdToken } from "@/server/firebaseAdmin";
import { getTenantModuleAccess } from "@/server/control/access";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  try {
    const decoded = await verifyFirebaseIdToken(match[1]);
    const firebaseUid = decoded.uid || null;
    const userEmail = (decoded.email || "").trim().toLowerCase();
    if (!firebaseUid || !userEmail) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    let user = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid)).limit(1).then((rows) => rows[0] ?? null);
    if (!user) {
      user = await db.select().from(users).where(eq(users.email, userEmail)).limit(1).then((rows) => rows[0] ?? null);
      if (user?.firebaseUid && user.firebaseUid !== firebaseUid) {
        return NextResponse.json({ authenticated: false }, { status: 401 });
      }
      if (user && !user.firebaseUid) {
        const repaired = await db
          .update(users)
          .set({ firebaseUid, updatedAt: new Date() })
          .where(and(eq(users.id, user.id), eq(users.email, userEmail)))
          .returning();
        user = repaired[0] ?? user;
      }
    }

    const onboardingRequired = !user || !user.businessId;
    if (onboardingRequired) {
      return NextResponse.json({
        authenticated: true,
        onboardingRequired: true,
        accessBlocked: false,
        workspaceMode: "blocked",
        access: null,
        user: user
          ? {
              id: user.id,
              businessId: user.businessId,
            }
          : null,
      });
    }

    const business = await db.select().from(businesses).where(eq(businesses.id, user.businessId)).limit(1).then((rows) => rows[0] ?? null);
    const access = business?.suiteTenantId ? await getTenantModuleAccess(business.suiteTenantId, "agent") : null;
    const accessBlocked = Boolean(access && !access.allowed);

    return NextResponse.json({
      authenticated: true,
      onboardingRequired: false,
      accessBlocked: access?.workspaceMode === "blocked" ? accessBlocked : false,
      workspaceMode: access?.workspaceMode ?? "readonly",
      access,
      user: {
        id: user.id,
        businessId: user.businessId,
      },
    });
  } catch {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}
