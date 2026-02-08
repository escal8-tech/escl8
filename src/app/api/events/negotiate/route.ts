import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { users } from "@/../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { verifyFirebaseIdToken } from "@/server/firebaseAdmin";

export const runtime = "nodejs";

async function getAuthedIdentity(req: Request): Promise<{ businessId: string; userId: string } | null> {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  try {
    const decoded = await verifyFirebaseIdToken(m[1]);
    const userEmail = decoded.email || null;
    const firebaseUid = decoded.uid || null;
    if (!userEmail || !firebaseUid) return null;

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

    const businessId = (user?.businessId as string) ?? "";
    if (!businessId) return null;
    return { businessId, userId: firebaseUid };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  const identity = await getAuthedIdentity(req);
  if (!identity) {
    console.warn("[realtime:negotiate] unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conn = process.env.WEB_PUBSUB_CONNECTION_STRING || process.env.WEB_PUBSUB_CONN || "";
  const hub = process.env.WEB_PUBSUB_HUB || "portal";
  if (!conn) {
    console.error("[realtime:negotiate] missing WEB_PUBSUB_CONNECTION_STRING");
    return NextResponse.json({ error: "WEB_PUBSUB_CONNECTION_STRING missing" }, { status: 503 });
  }

  let WebPubSubServiceClientCtor: any;
  try {
    const reqFn = eval("require") as NodeRequire;
    WebPubSubServiceClientCtor = reqFn("@azure/web-pubsub").WebPubSubServiceClient;
  } catch {
    console.error("[realtime:negotiate] @azure/web-pubsub not installed");
    return NextResponse.json({ error: "@azure/web-pubsub not installed" }, { status: 503 });
  }

  const group = `business.${identity.businessId}`;
  const client = new WebPubSubServiceClientCtor(conn, hub);
  const token = await client.getClientAccessToken({
    userId: identity.userId,
    roles: [`webpubsub.joinLeaveGroup.${group}`],
  });
  console.info(
    "[realtime:negotiate] ok businessId=%s hub=%s durationMs=%d",
    identity.businessId,
    hub,
    Date.now() - startedAt,
  );

  return NextResponse.json({
    url: token.url,
    hub,
    group,
    subprotocol: "json.webpubsub.azure.v1",
  });
}
