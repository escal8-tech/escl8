import { initTRPC } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import superjson from "superjson";

export type Context = {
  userEmail?: string | null;
  userId?: string | null;
  businessId?: string | null;
};

type AuthedContext = Context & { userEmail: string };
type BusinessContext = AuthedContext & { businessId: string };

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.userEmail) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  return next({ ctx: { ...ctx, userEmail: ctx.userEmail } as AuthedContext });
});

const requireBusiness = t.middleware(({ ctx, next }) => {
  if (!ctx.businessId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Missing businessId" });
  }
  return next({ ctx: { ...ctx, businessId: ctx.businessId } as BusinessContext });
});

export const protectedProcedure = t.procedure.use(requireAuth);
export const businessProcedure = t.procedure.use(requireAuth).use(requireBusiness);
