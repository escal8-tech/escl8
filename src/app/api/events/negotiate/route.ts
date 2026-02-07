import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { users } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import { verifyFirebaseIdToken } from "@/server/firebaseAdmin";

export const runtime = "nodejs";

async function getAuthedIdentity(req: Request): Promise<{ businessId: string; userId: string } | null> {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  try {
    const decoded = await verifyFirebaseIdToken(m[1]);
    const userEmail = decoded.email || null;
    if (!userEmail) return null;

    const rows = await db.select().from(users).where(eq(users.email, userEmail));
    const businessId = (rows[0]?.businessId as string) ?? "";
    if (!businessId) return null;
    return { businessId, userId: userEmail };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const identity = await getAuthedIdentity(req);
  if (!identity) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conn = process.env.WEB_PUBSUB_CONNECTION_STRING || process.env.WEB_PUBSUB_CONN || "";
  const hub = process.env.WEB_PUBSUB_HUB || "portal";
  if (!conn) {
    return NextResponse.json({ error: "WEB_PUBSUB_CONNECTION_STRING missing" }, { status: 503 });
  }

  let WebPubSubServiceClientCtor: any;
  try {
    const reqFn = eval("require") as NodeRequire;
    WebPubSubServiceClientCtor = reqFn("@azure/web-pubsub").WebPubSubServiceClient;
  } catch {
    return NextResponse.json({ error: "@azure/web-pubsub not installed" }, { status: 503 });
  }

  const group = `business.${identity.businessId}`;
  const client = new WebPubSubServiceClientCtor(conn, hub);
  const token = await client.getClientAccessToken({
    userId: identity.userId,
    roles: [`webpubsub.joinLeaveGroup.${group}`],
  });

  return NextResponse.json({
    url: token.url,
    hub,
    group,
    subprotocol: "json.webpubsub.azure.v1",
  });
}
