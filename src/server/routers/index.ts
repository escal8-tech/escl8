import { router } from "../trpc";
import { userRouter } from "./user";
import { requestsRouter } from "./requests";
import { bookingsRouter } from "./bookings";
import { businessRouter } from "./business";
import { ragRouter } from "./rag";
import { customersRouter } from "./customers";

export const appRouter = router({
  user: userRouter,
  requests: requestsRouter,
  bookings: bookingsRouter,
  business: businessRouter,
  rag: ragRouter,
  customers: customersRouter,
});

export type AppRouter = typeof appRouter;
