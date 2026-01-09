import { router } from "../trpc";
import { userRouter } from "./user";
import { requestsRouter } from "./requests";
import { bookingsRouter } from "./bookings";
import { businessRouter } from "./business";
import { ragRouter } from "./rag";

export const appRouter = router({
  user: userRouter,
  requests: requestsRouter,
  bookings: bookingsRouter,
  business: businessRouter,
  rag: ragRouter,
});

export type AppRouter = typeof appRouter;
