import { router } from "../trpc";
import { userRouter } from "./user";
import { requestsRouter } from "./requests";

export const appRouter = router({
  user: userRouter,
  requests: requestsRouter,
});

export type AppRouter = typeof appRouter;
