import { appRouter } from "@/server/routers";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";


export const runtime = "nodejs";



const handler = async (req: Request) => {


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
