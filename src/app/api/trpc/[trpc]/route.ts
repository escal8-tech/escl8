import { appRouter } from "@/server/routers";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

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


  const trpcPath = decodeURIComponent(new URL(req.url).pathname);
  const procedures = trpcPath.split("/api/trpc/")[1]?.split(",") ?? [];
  const ALLOWED_BYPASS_PROCEDURES = ["business.getSetupStatus", "business.completeOnboardingSetup"];
  const _setupAccessBypass = procedures.length > 0 && procedures.every((p) => ALLOWED_BYPASS_PROCEDURES.includes(p));

  const res = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async () => {
      const firebaseUid = req.headers.get("x-firebase-uid") || null;
      const userEmail = req.headers.get("x-user-email") || null;
      const userId = req.headers.get("x-user-id") || null;
      const businessId = req.headers.get("x-business-id") || null;
      const suiteTenantId = req.headers.get("x-suite-tenant-id") || null;

      return {
        firebaseUid,
        userEmail,
        userId,
        businessId,
        suiteTenantId,
      };
    },
  });

  return res;
};

export { handler as GET, handler as POST };
