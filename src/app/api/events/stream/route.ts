import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { users } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import { verifyFirebaseIdToken } from "@/server/firebaseAdmin";
import { serviceBusHub, type PortalEvent } from "@/server/realtime/serviceBusHub";

export const runtime = "nodejs";
const DEBUG = true;

function dlog(msg: string, ...args: unknown[]) {
  if (!DEBUG) return;
  console.log(`[realtime:sse] ${msg}`, ...args);
}

async function getAuthedBusinessId(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  try {
    const decoded = await verifyFirebaseIdToken(m[1]);
    const userEmail = decoded.email || null;
    if (!userEmail) return null;

    const rows = await db.select().from(users).where(eq(users.email, userEmail));
    return (rows[0]?.businessId as string) ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const businessId = await getAuthedBusinessId(req);
  if (!businessId) {
    dlog("unauthorized stream request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      const push = (event: PortalEvent) => {
        if (event.businessId !== businessId) return;
        dlog("push businessId=%s entity=%s op=%s", event.businessId, event.entity, event.op);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      controller.enqueue(encoder.encode(": connected\n\n"));
      dlog("stream connected businessId=%s", businessId);
      cleanup = serviceBusHub.subscribe(push);

      keepalive = setInterval(() => {
        controller.enqueue(encoder.encode("data: [keepalive]\n\n"));
      }, 15000);

      req.signal.addEventListener("abort", () => {
        dlog("stream aborted businessId=%s", businessId);
        if (keepalive) {
          clearInterval(keepalive);
          keepalive = null;
        }
        if (cleanup) {
          cleanup();
          cleanup = null;
        }
      });
    },
    cancel: () => {
      dlog("stream cancelled businessId=%s", businessId);
      if (keepalive) {
        clearInterval(keepalive);
        keepalive = null;
      }
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
