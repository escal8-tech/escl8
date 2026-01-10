import { appRouter } from "@/server/routers";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { db } from "@/server/db/client";
import { users } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import { verifyFirebaseIdToken } from "@/server/firebaseAdmin";

const handler = (req: Request) =>
  fetchRequestHandler({
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

export { handler as GET, handler as POST };
