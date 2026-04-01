import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/../drizzle/schema";
import { verifyFirebaseIdToken } from "@/server/firebaseAdmin";

export function readBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function getAuthedUserFromRequest(request: Request) {
  const idToken = readBearerToken(request);
  if (!idToken) return null;

  try {
    const decoded = await verifyFirebaseIdToken(idToken);
    const email = decoded.email || null;
    const firebaseUid = decoded.uid || null;
    if (!email || !firebaseUid) return null;

    let user = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid)).then((rows) => rows[0] ?? null);
    if (!user) {
      user = await db.select().from(users).where(eq(users.email, email)).then((rows) => rows[0] ?? null);
      if (user && !user.firebaseUid) {
        const repaired = await db
          .update(users)
          .set({ firebaseUid, updatedAt: new Date() })
          .where(and(eq(users.id, user.id), eq(users.email, email)))
          .returning();
        user = repaired[0] ?? user;
      }
    }

    if (!user) return null;

    return {
      user,
      decoded,
      firebaseUid,
      email,
      businessId: String(user.businessId || ""),
    };
  } catch {
    return null;
  }
}
