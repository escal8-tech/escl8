"use client";

import { TicketsPageScreen } from "@/app/portal/tickets/page";

export default function OrdersPage() {
  return <TicketsPageScreen forcedTypeKey="ordercreation" basePath="/orders" />;
}
