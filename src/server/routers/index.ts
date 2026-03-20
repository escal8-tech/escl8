import { router } from "../trpc";
import { userRouter } from "./user";
import { requestsRouter } from "./requests";
import { bookingsRouter } from "./bookings";
import { businessRouter } from "./business";
import { ragRouter } from "./rag";
import { customersRouter } from "./customers";
import { messagesRouter } from "./messages";
import { ticketsRouter } from "./tickets";
import { ordersRouter } from "./orders";

export const appRouter = router({
  user: userRouter,
  requests: requestsRouter,
  bookings: bookingsRouter,
  business: businessRouter,
  rag: ragRouter,
  customers: customersRouter,
  messages: messagesRouter,
  tickets: ticketsRouter,
  orders: ordersRouter,
});

export type AppRouter = typeof appRouter;
