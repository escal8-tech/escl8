import { router } from "../trpc";
import { userRouter } from "./user";
import { requestsRouter } from "./requests";
import { bookingsRouter } from "./bookings";
import { businessRouter } from "./business";

export const appRouter = router({
  user: userRouter,
  requests: requestsRouter,
  bookings: bookingsRouter,
  business: businessRouter,
});

export type AppRouter = typeof appRouter;
