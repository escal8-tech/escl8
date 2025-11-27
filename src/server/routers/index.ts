import { router } from "../trpc";
import { userRouter } from "./user";
import { requestsRouter } from "./requests";
import { bookingsRouter } from "./bookings";

export const appRouter = router({
  user: userRouter,
  requests: requestsRouter,
  bookings: bookingsRouter,
});

export type AppRouter = typeof appRouter;
