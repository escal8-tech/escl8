"use client";

import { TicketWorkbenchScreen } from "@/app/portal/tickets/[ticketId]/page";

export default function OrderTicketWorkbenchPage() {
  return <TicketWorkbenchScreen forcedTypeKey="ordercreation" backBasePath="/orders" />;
}
