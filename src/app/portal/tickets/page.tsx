"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { showErrorToast, showInfoToast, showSuccessToast } from "@/components/toast-utils";
import { trpc } from "@/utils/trpc";
import { useRouter, useSearchParams } from "next/navigation";
import { PortalSelect } from "@/app/portal/components/PortalSelect";
import { TableSearchControl } from "@/app/portal/components/TableToolbarControls";
import { TablePagination } from "@/app/portal/components/TablePagination";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { RowActionsMenu } from "@/app/portal/components/RowActionsMenu";
import { PortalBotToggleButton } from "@/app/portal/components/PortalBotToggleButton";
import { PortalHeaderCard, PortalMetricCard } from "@/app/portal/components/PortalSurfacePrimitives";
import { ManualOrderLauncher } from "@/app/portal/orders/components/ManualOrderLauncher";
import { ManualSupportTicketLauncher } from "@/app/portal/tickets/components/ManualSupportTicketLauncher";
import {
  PAGE_SIZE,
  canApproveOrderStage,
  canDenyOrderStage,
  firstFieldText,
  formatSupportTicketState,
  formatDate,
  formatChatWindowCountdown,
  formatItemsCell,
  formatOrderStage,
  formatTicketReference,
  getTicketFields,
  getTicketString,
  getTicketTypeLabel,
  getTicketValue,
  isLikelyInvalidCustomerName,
  orderStagePillClass,
  priorityPillClass,
  resolveOrderStage,
  resolveSupportTicketState,
  supportTicketStatePillClass,
  toLooseStringList,
  type OrderStage,
  type SupportTicketState,
  type TicketListFilter,
  type TicketRow,
} from "@/app/portal/tickets/lib/ticketPageUtils";

function toMutationDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const normalized = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(normalized.getTime()) ? undefined : normalized;
}

export function TicketsPageScreen({
  forcedTypeKey,
  basePath = "/ticket",
}: {
  forcedTypeKey?: string;
  basePath?: string;
} = {}) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const router = useRouter();
  const [filtersByType, setFiltersByType] = useState<Record<string, TicketListFilter>>({});
  const [ticketIdQuery, setTicketIdQuery] = useState("");
  const [resolvingSupportTicketId, setResolvingSupportTicketId] = useState<string | null>(null);
  const [orderActionTicketId, setOrderActionTicketId] = useState<string | null>(null);
  const [denyDialogTicket, setDenyDialogTicket] = useState<TicketRow | null>(null);
  const [denyReasonDraft, setDenyReasonDraft] = useState("Out of stock");
  const [pendingBotCustomerIds, setPendingBotCustomerIds] = useState<Record<string, boolean>>({});
  const [botPausedOverrides, setBotPausedOverrides] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const searchParams = useSearchParams();
  const queryTypeKey = (forcedTypeKey || searchParams?.get("type") || "").toLowerCase();
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const ticketTypesQuery = trpc.tickets.listTypes.useQuery({ includeDisabled: true });
  const ticketTypesData = useMemo(() => ticketTypesQuery.data ?? [], [ticketTypesQuery.data]);
  const typeOptions = useMemo(
    () =>
      [...ticketTypesData]
        .map((type) => ({
          typeKey: type.key,
          label: getTicketTypeLabel(type.key),
          enabled: type.enabled,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [ticketTypesData],
  );
  const allowedTypeKeys = useMemo(() => new Set(typeOptions.map((type) => type.typeKey)), [typeOptions]);
  const effectiveTypeKey = useMemo(() => {
    if (forcedTypeKey) return forcedTypeKey.toLowerCase();
    if (queryTypeKey && allowedTypeKeys.has(queryTypeKey)) return queryTypeKey;
    if (!typeOptions.length) return null;
    return typeOptions[0]?.typeKey ?? null;
  }, [allowedTypeKeys, forcedTypeKey, queryTypeKey, typeOptions]);
  const activeFilterKey = effectiveTypeKey ?? "__all";
  const isOrderTicketView = effectiveTypeKey === "ordercreation";
  const statusFilter = filtersByType[activeFilterKey] ?? (isOrderTicketView ? "pending_approval" : "all");
  const ticketLedgerInput = useMemo(
    () => ({
      typeKey: effectiveTypeKey || undefined,
      search: ticketIdQuery.trim() || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      ...(isOrderTicketView
        ? { orderStage: statusFilter !== "all" ? (statusFilter as OrderStage) : undefined }
        : { supportState: statusFilter !== "all" ? (statusFilter as SupportTicketState) : undefined }),
    }),
    [effectiveTypeKey, isOrderTicketView, page, statusFilter, ticketIdQuery],
  );
  const ticketsQuery = trpc.tickets.listTicketLedger.useQuery(ticketLedgerInput, {
    enabled: Boolean(effectiveTypeKey),
  });
  const performanceInput = useMemo(
    () => (effectiveTypeKey ? { typeKey: effectiveTypeKey, windowDays: 30 } : { windowDays: 30 }),
    [effectiveTypeKey],
  );
  const resolveSupportTicket = trpc.tickets.resolveSupportTicket.useMutation({
    onSuccess: async () => {
      await Promise.all([ticketsQuery.refetch(), performanceQuery.refetch()]);
    },
    onSettled: () => setResolvingSupportTicketId(null),
  });
  const invalidateTickets = useCallback(async () => {
    await Promise.all([
      utils.tickets.listTicketLedger.invalidate(),
      utils.tickets.getTicketById.invalidate(),
      utils.tickets.listTypes.invalidate(),
      utils.tickets.getPerformance.invalidate(),
    ]);
  }, [utils]);

  const toggleBot = trpc.customers.setBotPaused.useMutation({
    onMutate: async (vars) => {
      setPendingBotCustomerIds((prev) => ({ ...prev, [vars.customerId]: true }));
      setBotPausedOverrides((prev) => ({ ...prev, [vars.customerId]: vars.botPaused }));
    },
    onError: (_error, vars) => {
      setBotPausedOverrides((prev) => {
        const next = { ...prev };
        delete next[vars.customerId];
        return next;
      });
    },
    onSettled: async (_data, _error, vars) => {
      if (vars?.customerId) {
        setPendingBotCustomerIds((prev) => {
          const next = { ...prev };
          delete next[vars.customerId];
          return next;
        });
        setBotPausedOverrides((prev) => {
          const next = { ...prev };
          delete next[vars.customerId];
          return next;
        });
      }
      await utils.customers.getBotPausedByIds.invalidate();
    },
  });
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
      showSuccessToast(toast, {
        title: "Ticket approved",
        message:
          result.delivery?.channel === "none"
            ? "Manual order approved. No customer notification was sent."
            : String(result.order?.paymentMethod || "").toLowerCase() === "bank_qr"
            ? result.delivery?.channel === "email"
              ? "Ticket was approved and payment instructions were emailed to the customer."
              : "Ticket was approved and payment instructions were sent to the customer."
            : "Ticket was approved successfully.",
      });
    },
    onError: (error) => {
      showErrorToast(toast, {
        title: "Approval failed",
        message: error.message || "Failed to approve order ticket.",
      });
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
      setDenyDialogTicket(null);
      showSuccessToast(toast, {
        title: "Ticket denied",
        message: "Ticket was denied successfully.",
      });
    },
    onError: (error) => {
      showErrorToast(toast, {
        title: "Denial failed",
        message: error.message || "Failed to deny order ticket.",
      });
    },
    onSettled: () => setOrderActionTicketId(null),
  });

  const performanceQuery = trpc.tickets.getPerformance.useQuery(performanceInput);

  const activeGroup = useMemo(
    () =>
      typeOptions.find((g) => g.typeKey === effectiveTypeKey) ?? (
        effectiveTypeKey
          ? {
              typeKey: effectiveTypeKey,
              label: getTicketTypeLabel(effectiveTypeKey),
              enabled: true,
            }
          : null
      ),
    [effectiveTypeKey, typeOptions],
  );
  const activeTypeRequiredFields = useMemo(() => {
    const row = ticketTypesData.find((type) => type.key === effectiveTypeKey);
    return Array.isArray(row?.requiredFields) ? row.requiredFields.map((field) => String(field)) : [];
  }, [effectiveTypeKey, ticketTypesData]);
  const typeRequiresNameMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const type of ticketTypesData as Array<Record<string, unknown>>) {
      const key = String(type.key ?? "").trim().toLowerCase();
      if (!key) continue;
      const required = toLooseStringList((type.requiredFields ?? type.required_fields) as unknown)
        .map((field) => field.toLowerCase().replace(/[^a-z0-9]/g, ""));
      map.set(key, required.includes("name") || required.includes("customername"));
    }
    return map;
  }, [ticketTypesData]);
  const totalCount = ticketsQuery.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = useMemo(() => (ticketsQuery.data?.items ?? []) as TicketRow[], [ticketsQuery.data?.items]);
  const customerIdsOnPage = useMemo(() => {
    const ids = new Set<string>();
    for (const row of pageRows) {
      const customerId = getTicketString(row as TicketRow, "customerId", "customer_id");
      if (customerId) ids.add(customerId);
    }
    return Array.from(ids);
  }, [pageRows]);
  const customerBotPausedMapQuery = trpc.customers.getBotPausedByIds.useQuery(
    { ids: customerIdsOnPage },
    { enabled: customerIdsOnPage.length > 0 },
  );
  const syncCustomerBotPausedState = useCallback((event: { entity: string; payload?: Record<string, unknown> }) => {
    if (event.entity !== "customer" || !customerIdsOnPage.length) return;
    const customer = event.payload?.customer as Record<string, unknown> | undefined;
    const customerId = String(customer?.id ?? "");
    if (!customerId || !customerIdsOnPage.includes(customerId)) return;
    const nextPaused = Boolean(customer?.botPaused ?? customer?.bot_paused);

    setBotPausedOverrides((prev) => ({ ...prev, [customerId]: nextPaused }));
    utils.customers.getBotPausedByIds.setData({ ids: customerIdsOnPage }, (old) => ({
      ...(old ?? {}),
      [customerId]: nextPaused,
    }));
  }, [customerIdsOnPage, utils.customers.getBotPausedByIds]);
  useLivePortalEvents({
    ticketLedgerInput,
    ticketPerformanceInput: performanceInput,
    onCatchup: invalidateTickets,
    onEvent: syncCustomerBotPausedState,
  });
  const getThreadHref = useCallback((ticket: TicketRow) => {
    const params = new URLSearchParams();
    if (ticket.threadId) params.set("threadId", ticket.threadId);
    else if (ticket.customerId) params.set("customerId", ticket.customerId);
    else if (ticket.customerPhone) params.set("phone", ticket.customerPhone);
    const query = params.toString();
    return query ? `/messages?${query}` : "/messages";
  }, []);
  const pageTitle = effectiveTypeKey ? getTicketTypeLabel(effectiveTypeKey) : "Tickets";
  const pageDescription = isOrderTicketView
    ? "Tracks order ticket review, approvals, and queue health from one workflow."
    : "Tracks ticket workflow, chat windows, and routing in one place.";
  const pageWindowSummary = useMemo(() => {
    let open = 0;
    let closed = 0;
    for (const row of pageRows) {
      const expiresAt = getTicketValue(row, "whatsappWindowExpiresAt", "whatsapp_window_expires_at");
      if (!expiresAt) continue;
      const expiresAtMs = new Date(String(expiresAt)).getTime();
      if (Boolean(getTicketValue(row, "whatsappWindowOpen", "whatsapp_window_open")) && Number.isFinite(expiresAtMs) && expiresAtMs > nowMs) {
        open += 1;
      } else {
        closed += 1;
      }
    }
    return { open, closed };
  }, [nowMs, pageRows]);
  const activeRowsOnPage = useMemo(
    () => pageRows.filter((row) => (isOrderTicketView
      ? ["open", "in_progress"].includes(getTicketString(row, "status").toLowerCase())
      : resolveSupportTicketState(row) === "open")).length,
    [isOrderTicketView, pageRows],
  );
  const summaryCards = useMemo(
    () => [
      {
        label: "30d Conversion",
        value: `${performanceQuery.data?.conversionRate ?? 0}%`,
        hint: `Won ${performanceQuery.data?.wonCount ?? 0} / Lost ${performanceQuery.data?.lostCount ?? 0}`,
      },
      {
        label: "Chat Windows",
        value: String(pageWindowSummary.open),
        hint: `${pageWindowSummary.closed} closed on this page`,
      },
      {
        label: "Tickets (30d)",
        value: String(performanceQuery.data?.total ?? 0),
        hint: activeGroup?.label ?? "All types",
      },
      {
        label: "Active On Page",
        value: String(activeRowsOnPage),
        hint: `${totalCount} in this view`,
      },
    ],
    [activeGroup?.label, activeRowsOnPage, pageWindowSummary, performanceQuery.data, totalCount],
  );

  const handleApproveTicket = async (ticket: TicketRow) => {
    setOrderActionTicketId(ticket.id);
    try {
      await approveOrderTicket.mutateAsync({
        id: ticket.id,
        expectedUpdatedAt: toMutationDate(getTicketValue(ticket, "updatedAt", "updated_at")),
      });
    } catch {
      // Toast is handled by the mutation onError path.
    }
  };

  const openDenyDialog = (ticket: TicketRow) => {
    setDenyDialogTicket(ticket);
    setDenyReasonDraft(getTicketString(ticket, "lossReason", "loss_reason") || "Out of stock");
  };

  const handleConfirmDeny = async () => {
    if (!denyDialogTicket) return;
    const normalizedReason = denyReasonDraft.trim() || "Denied";
    setOrderActionTicketId(denyDialogTicket.id);
    try {
      await denyOrderTicket.mutateAsync({
        id: denyDialogTicket.id,
        expectedUpdatedAt: toMutationDate(getTicketValue(denyDialogTicket, "updatedAt", "updated_at")),
        reason: normalizedReason,
      });
    } catch {
      // Toast is handled by the mutation onError path.
    }
  };

  const openTicketWorkbench = useCallback((ticket: TicketRow | string) => {
    const id = typeof ticket === "string" ? ticket : ticket.id;
    const params = new URLSearchParams();
    if (!forcedTypeKey && effectiveTypeKey) params.set("type", effectiveTypeKey);
    const query = params.toString();
    router.push(query ? `${basePath}/${encodeURIComponent(id)}?${query}` : `${basePath}/${encodeURIComponent(id)}`);
  }, [basePath, effectiveTypeKey, forcedTypeKey, router]);

  const handleResolveSupportTicket = async (ticket: TicketRow, resolution: SupportTicketState) => {
    if (resolution === "open") return;
    setResolvingSupportTicketId(ticket.id);
    try {
      await resolveSupportTicket.mutateAsync({
        id: ticket.id,
        expectedUpdatedAt: toMutationDate(getTicketValue(ticket, "updatedAt", "updated_at")),
        resolution,
        failureReason: resolution === "failed" ? getTicketString(ticket, "lossReason", "loss_reason") || "Not completable" : undefined,
      });
      showSuccessToast(toast, {
        title: resolution === "completed" ? "Ticket completed" : "Ticket failed",
        message: resolution === "completed"
          ? "The ticket was marked complete."
          : "The ticket was marked failed.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Update failed",
        message: error instanceof Error ? error.message : "The ticket could not be updated.",
      });
    }
  };

  return (
    <>
      <div className="portal-page-shell">
        <div className="portal-page-stack">
          <PortalHeaderCard
            title={pageTitle}
            description={pageDescription}
            controls={
              isOrderTicketView ? (
                  <ManualOrderLauncher
                  buttonLabel="New Order"
                  onCreated={(ticketId) => {
                    setFiltersByType((prev) => ({ ...prev, [activeFilterKey]: "pending_approval" }));
                    setPage(0);
                    openTicketWorkbench(ticketId);
                  }}
                />
              ) : activeGroup ? (
                <ManualSupportTicketLauncher
                  ticketTypeKey={activeGroup.typeKey}
                  ticketTypeLabel={activeGroup.label}
                  requiredFields={activeTypeRequiredFields}
                  onCreated={(ticketId) => {
                    setFiltersByType((prev) => ({ ...prev, [activeFilterKey]: "open" }));
                    setPage(0);
                    openTicketWorkbench(ticketId);
                  }}
                />
              ) : null
            }
          />

          <div className="portal-summary-grid">
            {summaryCards.map((card, index) => (
              <PortalMetricCard
                key={card.label}
                label={card.label}
                value={card.value}
                hint={card.hint}
                tone={index === 0 ? "blue" : index === 1 ? "gold" : index === 2 ? "amber" : "rose"}
              />
            ))}
          </div>

          <div className="portal-table-surface portal-table-surface--fill">
            <div className="portal-table-toolbar portal-ledger-toolbar">
              <div className="portal-ledger-toolbar__title-group">
                <h2 className="portal-ledger-toolbar__title">Ticket Ledger</h2>
                <span className="portal-ledger-toolbar__badge">
                  {totalCount} {totalCount === 1 ? "Entry" : "Entries"}
                </span>
              </div>
              <div className="portal-ledger-toolbar__filters">
                <PortalSelect
                  value={statusFilter}
                  onValueChange={(value) => {
                    const nextFilter = value as TicketListFilter;
                    setFiltersByType((prev) => ({ ...prev, [activeFilterKey]: nextFilter }));
                    setPage(0);
                  }}
                  options={
                    isOrderTicketView
                      ? [
                          { value: "all", label: "All Stages" },
                          { value: "pending_approval", label: "Pending Approval" },
                          { value: "edit_required", label: "Edit Required" },
                          { value: "approved", label: "Approved" },
                          { value: "awaiting_payment", label: "Awaiting Payment" },
                          { value: "payment_submitted", label: "Payment Review" },
                          { value: "payment_rejected", label: "Payment Rejected" },
                          { value: "paid", label: "Paid" },
                          { value: "refund_pending", label: "Refund Pending" },
                          { value: "refunded", label: "Refunded" },
                          { value: "denied", label: "Denied" },
                        ]
                      : [
                          { value: "all", label: "All Statuses" },
                          { value: "open", label: "Open" },
                          { value: "completed", label: "Completed" },
                          { value: "failed", label: "Failed" },
                        ]
                  }
                  ariaLabel={isOrderTicketView ? "Order stage filter" : "Ticket status filter"}
                  className="portal-toolbar-select"
                  style={{ width: isOrderTicketView ? "176px" : "160px" }}
                />
              </div>
              <div className="portal-ledger-search">
                <TableSearchControl
                  value={ticketIdQuery}
                  onChange={(value) => {
                    setTicketIdQuery(value);
                    setPage(0);
                  }}
                  placeholder="Search ticket #..."
                />
              </div>
            </div>

            {!typeOptions.length ? (
              <div className="empty-state" style={{ flex: 1 }}>
                <div className="empty-state-title">No tickets found</div>
              </div>
            ) : activeGroup ? (
              <div className="portal-ledger-table-wrap">
                <div className="portal-table-scroll">
                  <table className="table table-clickable portal-modern-table portal-ledger-table portal-mobile-cards" style={{ width: "100%", tableLayout: "fixed" }}>
                    <thead>
                      {isOrderTicketView ? (
                        <tr>
                          <th style={{ textAlign: "left", width: "14%" }}>Ticket</th>
                          <th style={{ textAlign: "center", width: "8%" }}>Bot</th>
                          <th style={{ textAlign: "left", width: "18%" }}>Customer</th>
                          <th style={{ textAlign: "left", width: "21%" }}>Items</th>
                          <th style={{ textAlign: "left", width: "10%" }}>Priority</th>
                          <th style={{ textAlign: "left", width: "8%" }}>Window</th>
                          <th style={{ textAlign: "left", width: "10%" }}>Stage</th>
                          <th style={{ textAlign: "right", width: "11%" }}>Action</th>
                        </tr>
                      ) : (
                        <tr>
                          <th style={{ textAlign: "left", width: "14%" }}>Ticket</th>
                          <th style={{ textAlign: "center", width: "7%" }}>Bot</th>
                          <th style={{ textAlign: "left", width: "18%" }}>Customer</th>
                          <th style={{ textAlign: "left", width: "22%" }}>Items</th>
                          <th style={{ textAlign: "left", width: "11%" }}>Priority</th>
                          <th style={{ textAlign: "left", width: "10%" }}>Window</th>
                          <th style={{ textAlign: "left", width: "14%" }}>Status</th>
                          <th style={{ textAlign: "right", width: "8%" }}>Action</th>
                        </tr>
                      )}
                    </thead>
                    <tbody>
              {pageRows.map((ticket) => {
                const fields = getTicketFields(ticket as TicketRow);
                const typeKey = getTicketString(ticket as TicketRow, "ticketTypeKey", "ticket_type_key").toLowerCase();
                const isOrderRow = typeKey === "ordercreation";
                const orderStage = resolveOrderStage(ticket as TicketRow);
                const requiresName = Boolean(typeRequiresNameMap.get(typeKey));
                const phoneFromTicket = getTicketString(ticket as TicketRow, "customerPhone", "customer_phone").trim();
                const phoneFromFields = firstFieldText(fields, ["contact", "phone", "phoneNumber", "mobile", "whatsapp", "customerPhone"]);
                const customerPhone = phoneFromTicket || phoneFromFields;
                const nameFromFields = firstFieldText(fields, ["name", "customerName", "customer_name"]);
                const nameFromTicket = getTicketString(ticket as TicketRow, "customerName", "customer_name").trim();
                const rawCustomerName = nameFromFields || nameFromTicket;
                const customerName = rawCustomerName && !isLikelyInvalidCustomerName(rawCustomerName) ? rawCustomerName : "";
                const customerPrimary = isOrderRow
                  ? (customerPhone || "-")
                  : (requiresName ? (customerName || customerPhone || "-") : (customerPhone || "-"));
                const customerSecondary = isOrderRow
                  ? (!customerPhone ? "No phone" : "")
                  : (requiresName
                  ? (customerPhone && customerPhone !== customerPrimary ? customerPhone : (!customerPhone ? "No phone" : ""))
                  : (!customerPhone ? "No phone" : ""));
                const itemsLabel = formatItemsCell(fields);
                const supportState = resolveSupportTicketState(ticket as TicketRow);
                const ticketDate = formatDate(
                  (getTicketValue(ticket as TicketRow, "updatedAt", "updated_at") as Date | string | null | undefined) ?? ticket.createdAt,
                );
                const customerId = getTicketString(ticket, "customerId", "customer_id");
                const paused = customerId ? (botPausedOverrides[customerId] ?? Boolean(customerBotPausedMapQuery.data?.[customerId])) : false;
                const isBotPending = customerId ? Boolean(pendingBotCustomerIds[customerId]) : false;
                const ticketReference = formatTicketReference(ticket as TicketRow);
                const ticketCell = (
                  <td data-label="Ticket">
                    <div className="portal-entity-stack">
                      <div className="portal-ledger-table__ref" title={ticket.id}>
                        #{ticketReference}
                      </div>
                      <div className="portal-meta-text">{ticketDate}</div>
                    </div>
                  </td>
                );
                const customerCell = (
                  <td data-label="Customer">
                    <div className="portal-entity-stack">
                      <div className="portal-body-text">{customerPrimary}</div>
                      {customerSecondary ? <div className="portal-meta-text">{customerSecondary}</div> : null}
                    </div>
                  </td>
                );
                const itemsCell = (
                  <td data-label="Items" className="portal-ledger-cell portal-ledger-cell--items">
                    <span className="portal-body-text" title={itemsLabel}>
                      {itemsLabel}
                    </span>
                  </td>
                );
                const priorityCell = (
                  <td data-label="Priority" className="portal-ledger-cell portal-ledger-cell--priority">
                    <span className={priorityPillClass(getTicketString(ticket, "priority") || "normal")}>
                      {(getTicketString(ticket, "priority") || "normal")}
                    </span>
                  </td>
                );
                const windowCell = (
                  <td data-label="Window">
                    {(() => {
                      const windowTimer = formatChatWindowCountdown(
                        getTicketValue(ticket, "whatsappWindowExpiresAt", "whatsapp_window_expires_at") as Date | string | null | undefined,
                        getTicketValue(ticket, "whatsappWindowOpen", "whatsapp_window_open"),
                        nowMs,
                      );
                      const toneColor =
                        windowTimer.tone === "danger" ? "#fca5a5" : windowTimer.tone === "warn" ? "#fdba74" : windowTimer.tone === "ok" ? "#86efac" : "var(--muted)";
                      return <span style={{ fontSize: 12, color: toneColor }}>{windowTimer.label}</span>;
                    })()}
                  </td>
                );
                const botCell = (
                  <td data-label="Bot" style={{ textAlign: "center" }}>
                    <PortalBotToggleButton
                      available={Boolean(customerId)}
                      paused={paused}
                      pending={isBotPending}
                      onToggle={() => {
                        if (!customerId) return;
                        toggleBot.mutate({ customerId, botPaused: !paused });
                      }}
                    />
                  </td>
                );
                const actionCell = (
                  <td data-label="Actions" style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                    <div className="portal-ledger-actions">
                      <button
                        type="button"
                        className={`portal-ledger-action portal-ledger-action--approve${isOrderRow
                          ? (canApproveOrderStage(orderStage) ? "" : " is-hidden")
                          : (supportState === "open" ? "" : " is-hidden")}`}
                        disabled={isOrderRow
                          ? (!isOrderRow || orderActionTicketId !== null || !canApproveOrderStage(orderStage))
                          : (resolvingSupportTicketId !== null || supportState !== "open")}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isOrderRow) {
                            void handleApproveTicket(ticket as TicketRow);
                            return;
                          }
                          void handleResolveSupportTicket(ticket as TicketRow, "completed");
                        }}
                        aria-label={isOrderRow
                          ? (canApproveOrderStage(orderStage) ? "Approve order ticket" : undefined)
                          : (supportState === "open" ? "Complete support ticket" : undefined)}
                      >
                        <TicketCheckIcon />
                      </button>
                      <button
                        type="button"
                        className={`portal-ledger-action portal-ledger-action--reject${isOrderRow
                          ? (canDenyOrderStage(orderStage) ? "" : " is-hidden")
                          : (supportState === "open" ? "" : " is-hidden")}`}
                        disabled={isOrderRow
                          ? (!isOrderRow || orderActionTicketId !== null || !canDenyOrderStage(orderStage))
                          : (resolvingSupportTicketId !== null || supportState !== "open")}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isOrderRow) {
                            openDenyDialog(ticket as TicketRow);
                            return;
                          }
                          void handleResolveSupportTicket(ticket as TicketRow, "failed");
                        }}
                        aria-label={isOrderRow
                          ? (canDenyOrderStage(orderStage) ? "Deny order ticket" : undefined)
                          : (supportState === "open" ? "Fail support ticket" : undefined)}
                      >
                        <TicketCloseIcon />
                      </button>
                      <RowActionsMenu
                        items={
                          [
                            {
                              label: "Open Details",
                              onSelect: () => openTicketWorkbench(ticket as TicketRow),
                            },
                            {
                              label: "Open Thread",
                              onSelect: () => router.push(getThreadHref(ticket as TicketRow)),
                            },
                            {
                              label: "Customer Details",
                              disabled: !customerId,
                              onSelect: () => {
                                if (!customerId) return;
                                router.push(`/customers?customerId=${encodeURIComponent(customerId)}`);
                              },
                            },
                          ]
                        }
                      />
                    </div>
                  </td>
                );
                return (
                  <tr
                    key={ticket.id}
                    onClick={(e) => {
                      const target = e.target as HTMLElement | null;
                      const interactive = target?.closest(
                        "button, a, input, textarea, select, [role='button'], .portal-select-trigger, .portal-select-content, .portal-select-item",
                      );
                      if (interactive) return;
                      openTicketWorkbench(ticket as TicketRow);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    {isOrderTicketView ? (
                      <>
                        {ticketCell}
                        {botCell}
                        {customerCell}
                        {itemsCell}
                        {priorityCell}
                        {windowCell}
                        <td data-label="Stage">
                          <span className={orderStagePillClass(orderStage)}>{formatOrderStage(orderStage)}</span>
                        </td>
                        {actionCell}
                      </>
                    ) : (
                      <>
                        {ticketCell}
                        {botCell}
                        {customerCell}
                        {itemsCell}
                        {priorityCell}
                        {windowCell}
                        <td data-label="Status" className="portal-ledger-cell portal-ledger-cell--status">
                          <span className={supportTicketStatePillClass(supportState)}>
                            {formatSupportTicketState(supportState)}
                          </span>
                        </td>
                        {actionCell}
                      </>
                    )}
                  </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={isOrderTicketView ? 8 : 8} style={{ color: "var(--muted)", textAlign: "center", padding: "24px 10px" }}>
                    {ticketIdQuery ? "No ticket IDs match your search." : "No tickets match this view."}
                  </td>
                </tr>
              )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <TablePagination
              page={safePage}
              totalPages={totalPages}
              shownCount={pageRows.length}
              totalCount={totalCount}
              canPrev={safePage > 0}
              canNext={safePage < totalPages - 1}
              onPrev={() => setPage((p) => Math.max(0, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              onPageChange={setPage}
            />
          </div>
        </div>
      </div>
    {denyDialogTicket ? (
      <>
        <div className="drawer-backdrop open" onClick={() => setDenyDialogTicket(null)} />
        <div
          className="portal-modal-shell"
        >
          <div
            className="portal-modal-card"
          >
            <div className="portal-modal-card__body">
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>Deny order ticket</div>
                <div className="text-muted" style={{ fontSize: 13 }}>
                  Add the internal reason for denying this order. The ticket will close and the order stage will move to denied.
                </div>
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>Reason</div>
                <textarea
                  value={denyReasonDraft}
                  onChange={(e) => setDenyReasonDraft(e.target.value)}
                  placeholder="Out of stock"
                  style={{
                    width: "100%",
                    minHeight: 110,
                    resize: "vertical",
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={orderActionTicketId !== null}
                  onClick={() => setDenyDialogTicket(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={orderActionTicketId !== null}
                  onClick={() => void handleConfirmDeny()}
                >
                  {orderActionTicketId === denyDialogTicket.id ? "Denying..." : "Confirm Deny"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    ) : null}
    </>
  );
}

export default function TicketsPage() {
  return <TicketsPageScreen />;
}

function TicketCheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

function TicketCloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
