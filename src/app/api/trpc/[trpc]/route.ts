import { appRouter } from "@/server/routers";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { db } from "@/server/db/client";
import { users } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import { verifyFirebaseIdToken } from "@/server/firebaseAdmin";
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
  // Default: 300 requests per minute per IP to /api/trpc.
  // Override with env vars if needed.
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
      if (!m) return { userEmail: null, userId: null, businessId: null };

      try {
        const decoded = await verifyFirebaseIdToken(m[1]);
        const userEmail = decoded.email || null;
        if (!userEmail) return { userEmail: null, userId: null, businessId: null };

        const rows = await db.select().from(users).where(eq(users.email, userEmail));
        const user = rows[0];
        return {
          userEmail,
          userId: (user?.id as string) ?? null,
          businessId: (user?.businessId as string) ?? null,
        };
      } catch {
        return { userEmail: null, userId: null, businessId: null };
      }
    },
  });

  return withExtraHeaders(res, rl.headers);
};

export { handler as GET, handler as POST };
