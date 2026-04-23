"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { showErrorToast, showInfoToast, showSuccessToast } from "@/components/toast-utils";
import { useToast } from "@/components/ToastProvider";
import { InlineThreadPanel } from "@/app/portal/messages/components/InlineThreadPanel";
import { TicketDetailsDrawer } from "@/app/portal/tickets/components/TicketDetailsDrawer";
import {
  getTicketString,
  getTicketValue,
  type TicketRow,
} from "@/app/portal/tickets/lib/ticketPageUtils";
import { trpc } from "@/utils/trpc";

function toMutationDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const normalized = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(normalized.getTime()) ? undefined : normalized;
}

function buildThreadHref(ticket: TicketRow | null): string {
  if (!ticket) return "/messages";
  const params = new URLSearchParams();
  if (ticket.threadId) params.set("threadId", ticket.threadId);
  else if (ticket.customerId) params.set("customerId", ticket.customerId);
  else if (ticket.customerPhone) params.set("phone", ticket.customerPhone);
  const query = params.toString();
  return query ? `/messages?${query}` : "/messages";
}

export function TicketWorkbenchScreen({
  forcedTypeKey,
  backBasePath = "/ticket",
}: {
  forcedTypeKey?: string;
  backBasePath?: string;
} = {}) {
  const params = useParams<{ ticketId?: string; orderId?: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const utils = trpc.useUtils();
  const ticketId = String(params?.ticketId || params?.orderId || "").trim();
  const typeKey = String(forcedTypeKey || searchParams?.get("type") || "").trim();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [orderActionTicketId, setOrderActionTicketId] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const ticketQuery = trpc.tickets.getTicketById.useQuery({ ticketId }, { enabled: Boolean(ticketId) });
  const ticket = (ticketQuery.data ?? null) as TicketRow | null;
  const backHref = forcedTypeKey
    ? backBasePath
    : typeKey
      ? `${backBasePath}?type=${encodeURIComponent(typeKey)}`
      : backBasePath;

  const approveOrderTicket = trpc.tickets.approveOrderTicket.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.tickets.listTickets.invalidate(),
        utils.tickets.listTicketLedger.invalidate(),
        utils.tickets.getTicketById.invalidate(),
        utils.tickets.listTicketEvents.invalidate(),
        utils.tickets.getPerformance.invalidate(),
        utils.orders.listOrders.invalidate(),
        utils.orders.listOrdersPage.invalidate(),
        utils.orders.getOverview.invalidate(),
        utils.orders.getStats.invalidate(),
      ]);
      if (result.delivery && !result.delivery.ok && result.delivery.error) {
        showInfoToast(toast, {
          title: "Ticket approved",
          message: `Ticket was approved, but payment instructions could not be sent: ${result.delivery.error}`,
          durationMs: 6200,
        });
        return;
      }
      showSuccessToast(toast, { title: "Ticket approved", message: "The order workflow was updated." });
    },
    onError: (error) => {
      showErrorToast(toast, { title: "Approval failed", message: error.message || "Failed to approve order ticket." });
    },
    onSettled: () => setOrderActionTicketId(null),
  });

  const denyOrderTicket = trpc.tickets.denyOrderTicket.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.tickets.listTickets.invalidate(),
        utils.tickets.listTicketLedger.invalidate(),
        utils.tickets.getTicketById.invalidate(),
        utils.tickets.listTicketEvents.invalidate(),
        utils.tickets.getPerformance.invalidate(),
        utils.orders.listOrders.invalidate(),
        utils.orders.listOrdersPage.invalidate(),
        utils.orders.getOverview.invalidate(),
        utils.orders.getStats.invalidate(),
      ]);
      showSuccessToast(toast, { title: "Ticket denied", message: "The ticket was closed and the order stage was updated." });
    },
    onError: (error) => {
      showErrorToast(toast, { title: "Denial failed", message: error.message || "Failed to deny order ticket." });
    },
    onSettled: () => setOrderActionTicketId(null),
  });

  const handleApproveTicket = async (row: TicketRow) => {
    setOrderActionTicketId(row.id);
    try {
      await approveOrderTicket.mutateAsync({
        id: row.id,
        expectedUpdatedAt: toMutationDate(getTicketValue(row, "updatedAt", "updated_at")),
      });
    } catch {
      // Toast is handled by mutation.
    }
  };

  const handleDenyTicket = (row: TicketRow) => {
    const reason = window.prompt("Reason for denying this order", getTicketString(row, "lossReason", "loss_reason") || "Out of stock");
    if (reason === null) return;
    setOrderActionTicketId(row.id);
    denyOrderTicket.mutate({
      id: row.id,
      expectedUpdatedAt: toMutationDate(getTicketValue(row, "updatedAt", "updated_at")),
      reason: reason.trim() || "Denied",
    });
  };

  const customerName = useMemo(
    () => ticket ? getTicketString(ticket, "customerName", "customer_name") : "",
    [ticket],
  );
  const customerPhone = useMemo(
    () => ticket ? getTicketString(ticket, "customerPhone", "customer_phone") : "",
    [ticket],
  );
  const customerId = useMemo(
    () => ticket ? getTicketString(ticket, "customerId", "customer_id") : "",
    [ticket],
  );
  const customerHref = useMemo(() => {
    if (customerId) return `/customers?customerId=${encodeURIComponent(customerId)}`;
    if (customerPhone) return `/customers?phone=${encodeURIComponent(customerPhone)}`;
    return null;
  }, [customerId, customerPhone]);

  return (
    <div className="portal-detail-page-shell">
      {ticketQuery.isLoading ? (
        <div className="portal-detail-page-empty">Loading ticket details...</div>
      ) : !ticket ? (
        <div className="portal-detail-page-empty">This ticket could not be found.</div>
      ) : (
        <div className="portal-workbench-grid">
          <main className="portal-workbench-main">
            <TicketDetailsDrawer
              key={`${ticket.id}:${String(getTicketValue(ticket, "updatedAt", "updated_at") ?? "")}`}
              variant="page"
              ticket={ticket}
              onClose={() => router.push(backHref)}
              threadHref={buildThreadHref(ticket)}
              nowMs={nowMs}
              onApproveOrderTicket={handleApproveTicket}
              onDenyOrderTicket={handleDenyTicket}
              orderActionPending={orderActionTicketId !== null}
            />
          </main>
          <aside className="portal-workbench-thread">
            <InlineThreadPanel
              threadId={ticket.threadId}
              customerName={customerName}
              customerPhone={customerPhone}
              customerHref={customerHref}
            />
          </aside>
        </div>
      )}
    </div>
  );
}

export default function TicketWorkbenchPage() {
  return <TicketWorkbenchScreen />;
}
