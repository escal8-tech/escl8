import { appRouter } from "@/server/routers";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
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

  const trpcPath = decodeURIComponent(new URL(req.url).pathname);
  const procedures = trpcPath.split("/api/trpc/")[1]?.split(",") ?? [];
  const ALLOWED_BYPASS_PROCEDURES = ["business.getSetupStatus", "business.completeOnboardingSetup"];
  const setupAccessBypass = procedures.length > 0 && procedures.every((p) => ALLOWED_BYPASS_PROCEDURES.includes(p));

  const res = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async () => {
      const firebaseUid = req.headers.get("x-firebase-uid") || null;
      const userEmail = req.headers.get("x-user-email") || null;
      const userId = req.headers.get("x-user-id") || null;
      const businessId = req.headers.get("x-business-id") || null;

      return {
        firebaseUid,
        userEmail,
        userId,
        businessId,
      };
    },
  });

  return withExtraHeaders(res, rl.headers);
};

export { handler as GET, handler as POST };
