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
  const firebaseUid = request.headers.get("x-firebase-uid");
  const email = request.headers.get("x-user-email");
  const businessId = request.headers.get("x-business-id");
  const userId = request.headers.get("x-user-id");

  if (!firebaseUid || !email) {
    return null;
  }

  return {
    user: {
      id: userId || "",
      firebaseUid,
      email,
      businessId: businessId || "",
    },
    decoded: {
      uid: firebaseUid,
      email,
    },
    firebaseUid,
    email,
    businessId: businessId || "",
  };
}
