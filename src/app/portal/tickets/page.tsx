"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { showErrorToast, showInfoToast, showSuccessToast } from "@/components/toast-utils";
import { trpc } from "@/utils/trpc";
import { useRouter, useSearchParams } from "next/navigation";
import { TableSearchControl, TableSelect } from "@/app/portal/components/TableToolbarControls";
import { TablePagination } from "@/app/portal/components/TablePagination";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { RowActionsMenu } from "@/app/portal/components/RowActionsMenu";
import { PortalBotToggleButton } from "@/app/portal/components/PortalBotToggleButton";
import { PortalHeaderCard, PortalMetricCard } from "@/app/portal/components/PortalSurfacePrimitives";
import {
  LOSS_REASON_OPTIONS,
  OUTCOME_OPTIONS,
  PAGE_SIZE,
  STATUS_OPTIONS,
  applyOrderEditorToFields,
  buildOrderEditorLines,
  canApproveOrderStage,
  canDenyOrderStage,
  computeOrderEditorLineTotal,
  computeOrderEditorTotal,
  describeOrderStage,
  firstFieldText,
  formatDate,
  formatFieldValue,
  formatItemsCell,
  formatOrderStage,
  formatSlaCountdown,
  formatStatus,
  getImportantFieldRows,
  getOrderDraftTotal,
  getTicketFields,
  getTicketString,
  getTicketTypeLabel,
  getTicketValue,
  isLikelyInvalidCustomerName,
  isOrderTicketRow,
  orderStagePillClass,
  priorityPillClass,
  resolveOrderStage,
  shortId,
  toLooseStringList,
  toDateTimeLocalValue,
  type OrderEditorLine,
  type OrderStage,
  type TicketEventRow,
  type TicketListFilter,
  type TicketOutcome,
  type TicketRow,
  type TicketStatus,
} from "@/app/portal/tickets/lib/ticketPageUtils";

function toMutationDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const normalized = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(normalized.getTime()) ? undefined : normalized;
}

export default function TicketsPage() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const router = useRouter();
  const [filtersByType, setFiltersByType] = useState<Record<string, TicketListFilter>>({});
  const [ticketIdQuery, setTicketIdQuery] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updatingOutcomeId, setUpdatingOutcomeId] = useState<string | null>(null);
  const [orderActionTicketId, setOrderActionTicketId] = useState<string | null>(null);
  const [denyDialogTicket, setDenyDialogTicket] = useState<TicketRow | null>(null);
  const [denyReasonDraft, setDenyReasonDraft] = useState("Out of stock");
  const [pendingBotCustomerIds, setPendingBotCustomerIds] = useState<Record<string, boolean>>({});
  const [botPausedOverrides, setBotPausedOverrides] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(0);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const searchParams = useSearchParams();
  const queryTypeKey = (searchParams?.get("type") || "").toLowerCase();
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
  const effectiveTypeKey = useMemo(() => {
    if (queryTypeKey) return queryTypeKey;
    if (!typeOptions.length) return null;
    return typeOptions[0]?.typeKey ?? null;
  }, [queryTypeKey, typeOptions]);
  const activeFilterKey = effectiveTypeKey ?? "__all";
  const statusFilter = filtersByType[activeFilterKey] ?? "all";
  const isOrderTicketView = effectiveTypeKey === "ordercreation";
  const ticketLedgerInput = useMemo(
    () => ({
      typeKey: effectiveTypeKey || undefined,
      search: ticketIdQuery.trim() || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      ...(isOrderTicketView
        ? { orderStage: statusFilter !== "all" ? (statusFilter as OrderStage) : undefined }
        : { status: statusFilter !== "all" ? (statusFilter as TicketStatus) : undefined }),
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
  const updateStatus = trpc.tickets.updateTicketStatus.useMutation({
    onSuccess: async () => {
      await ticketsQuery.refetch();
    },
    onSettled: () => setUpdatingId(null),
  });
  const updateOutcome = trpc.tickets.updateTicketOutcome.useMutation({
    onSuccess: async () => {
      await Promise.all([ticketsQuery.refetch(), performanceQuery.refetch()]);
    },
    onSettled: () => setUpdatingOutcomeId(null),
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
    onSuccess: async (result, vars) => {
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
      if (selectedTicketId === vars.id) {
        setSelectedTicketId(null);
      }
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
          String(result.order?.paymentMethod || "").toLowerCase() === "bank_qr"
            ? "Ticket was approved and payment instructions were sent to the customer."
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
    onSuccess: async (_result, vars) => {
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
      if (selectedTicketId === vars.id) {
        setSelectedTicketId(null);
      }
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
    activeTicketId: selectedTicketId,
    onCatchup: invalidateTickets,
    onEvent: syncCustomerBotPausedState,
  });
  const selectedTicketQuery = trpc.tickets.getTicketById.useQuery(
    { ticketId: selectedTicketId ?? "" },
    { enabled: Boolean(selectedTicketId) },
  );
  const selectedTicket = selectedTicketQuery.data
    ?? (selectedTicketId ? pageRows.find((ticket) => ticket.id === selectedTicketId) ?? null : null);
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
    : "Tracks ticket workflow, SLA health, and routing in one place.";
  const summaryCards = useMemo(
    () => [
      {
        label: "30d Conversion",
        value: `${performanceQuery.data?.conversionRate ?? 0}%`,
        hint: `Won ${performanceQuery.data?.wonCount ?? 0} / Lost ${performanceQuery.data?.lostCount ?? 0}`,
      },
      {
        label: "SLA On-Time",
        value: `${performanceQuery.data?.slaOnTimeRate ?? 0}%`,
        hint: `${performanceQuery.data?.resolvedOnTime ?? 0} on-time / ${performanceQuery.data?.resolvedTotal ?? 0} resolved`,
      },
      {
        label: "Tickets (30d)",
        value: String(performanceQuery.data?.total ?? 0),
        hint: activeGroup?.label ?? "All types",
      },
      {
        label: "Overdue Open",
        value: String(performanceQuery.data?.overdueOpen ?? 0),
        hint: "Needs attention now",
      },
    ],
    [activeGroup?.label, performanceQuery.data],
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

  return (
    <>
      <div className="portal-page-shell">
        <div className="portal-page-stack">
          <PortalHeaderCard
            title={pageTitle}
            description={pageDescription}
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
              <div className="portal-ledger-toolbar__controls">
                <select
                  className="portal-res-select portal-res-select--compact"
                  value={statusFilter}
                  style={{ minWidth: 148 }}
                  onChange={(e) => {
                    const nextFilter = e.target.value as TicketListFilter;
                    setFiltersByType((prev) => ({ ...prev, [activeFilterKey]: nextFilter }));
                    setPage(0);
                  }}
                >
                  {isOrderTicketView ? (
                    <>
                      <option value="all">All Stages</option>
                      <option value="pending_approval">Pending Approval</option>
                      <option value="approved">Approved</option>
                      <option value="awaiting_payment">Awaiting Payment</option>
                      <option value="payment_submitted">Payment Review</option>
                      <option value="payment_rejected">Payment Rejected</option>
                      <option value="paid">Paid</option>
                      <option value="refund_pending">Refund Pending</option>
                      <option value="refunded">Refunded</option>
                      <option value="denied">Denied</option>
                    </>
                  ) : (
                    <>
                      <option value="all">All Statuses</option>
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                    </>
                  )}
                </select>
                <div className="portal-ledger-search">
                  <TableSearchControl
                    value={ticketIdQuery}
                    onChange={(value) => {
                      setTicketIdQuery(value);
                      setPage(0);
                    }}
                    placeholder="Search ticket ID..."
                    style={{ width: "min(280px, 100%)" }}
                  />
                </div>
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
                          <th style={{ textAlign: "left", width: "8%" }}>SLA</th>
                          <th style={{ textAlign: "left", width: "10%" }}>Stage</th>
                          <th style={{ textAlign: "right", width: "11%" }}>Action</th>
                        </tr>
                      ) : (
                        <tr>
                          <th style={{ textAlign: "left", width: "14%" }}>Ticket</th>
                          <th style={{ textAlign: "center", width: "7%" }}>Bot</th>
                          <th style={{ textAlign: "left", width: "18%" }}>Customer</th>
                          <th style={{ textAlign: "left", width: "23%" }}>Items</th>
                          <th style={{ textAlign: "left", width: "10%" }}>Priority</th>
                          <th style={{ textAlign: "left", width: "10%" }}>SLA</th>
                          <th style={{ textAlign: "left", width: "10%" }}>Status</th>
                          <th style={{ textAlign: "left", width: "10%" }}>Outcome</th>
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
                const customerPrimary = requiresName ? (customerName || customerPhone || "-") : (customerPhone || "-");
                const customerSecondary = requiresName
                  ? (customerPhone && customerPhone !== customerPrimary ? customerPhone : (!customerPhone ? "No phone" : ""))
                  : (!customerPhone ? "No phone" : "");
                const itemsLabel = formatItemsCell(fields);
                const ticketDate = formatDate(
                  (getTicketValue(ticket as TicketRow, "updatedAt", "updated_at") as Date | string | null | undefined) ?? ticket.createdAt,
                );
                const customerId = getTicketString(ticket, "customerId", "customer_id");
                const paused = customerId ? (botPausedOverrides[customerId] ?? Boolean(customerBotPausedMapQuery.data?.[customerId])) : false;
                const isBotPending = customerId ? Boolean(pendingBotCustomerIds[customerId]) : false;
                const ticketCell = (
                  <td data-label="Ticket">
                    <div className="portal-entity-stack">
                      <div className="portal-ledger-table__ref" title={ticket.id}>
                        #{shortId(ticket.id)}
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
                  <td data-label="Items">
                    <span className="portal-body-text" title={itemsLabel}>
                      {itemsLabel}
                    </span>
                  </td>
                );
                const priorityCell = (
                  <td data-label="Priority">
                    <span className={priorityPillClass(getTicketString(ticket, "priority") || "normal")}>
                      {(getTicketString(ticket, "priority") || "normal")}
                    </span>
                  </td>
                );
                const slaCell = (
                  <td data-label="SLA">
                    {(() => {
                      const sla = formatSlaCountdown(
                        getTicketValue(ticket, "slaDueAt", "sla_due_at") as Date | string | null | undefined,
                        nowMs,
                      );
                      const toneColor =
                        sla.tone === "danger" ? "#fca5a5" : sla.tone === "warn" ? "#fdba74" : sla.tone === "ok" ? "#86efac" : "var(--muted)";
                      return <span style={{ fontSize: 12, color: toneColor }}>{sla.label}</span>;
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
                        className={`portal-ledger-action portal-ledger-action--approve${isOrderRow && canApproveOrderStage(orderStage) ? "" : " is-hidden"}`}
                        disabled={!isOrderRow || orderActionTicketId !== null || !canApproveOrderStage(orderStage)}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleApproveTicket(ticket as TicketRow);
                        }}
                        aria-label={isOrderRow && canApproveOrderStage(orderStage) ? "Approve order ticket" : undefined}
                      >
                        <TicketCheckIcon />
                      </button>
                      <button
                        type="button"
                        className={`portal-ledger-action portal-ledger-action--reject${isOrderRow && canDenyOrderStage(orderStage) ? "" : " is-hidden"}`}
                        disabled={!isOrderRow || orderActionTicketId !== null || !canDenyOrderStage(orderStage)}
                        onClick={(e) => {
                          e.stopPropagation();
                          openDenyDialog(ticket as TicketRow);
                        }}
                        aria-label={isOrderRow && canDenyOrderStage(orderStage) ? "Deny order ticket" : undefined}
                      >
                        <TicketCloseIcon />
                      </button>
                      <RowActionsMenu
                        items={
                          [
                            {
                              label: "Open Details",
                              onSelect: () => setSelectedTicketId(ticket.id),
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
                      setSelectedTicketId(ticket.id);
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
                        {slaCell}
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
                        {slaCell}
                        <td data-label="Status" style={{ textAlign: "right" }}>
                          <TableSelect
                            className="portal-ticket-row-select"
                            style={{ width: "100%", maxWidth: 136 }}
                            value={(ticket.status === "closed" ? "resolved" : ticket.status) as TicketStatus}
                            disabled={updatingId === ticket.id}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const nextStatus = e.target.value as TicketStatus;
                              setUpdatingId(ticket.id);
                              updateStatus.mutate({
                                id: ticket.id,
                                expectedUpdatedAt: toMutationDate(getTicketValue(ticket, "updatedAt", "updated_at")),
                                status: nextStatus,
                              });
                            }}
                          >
                            {STATUS_OPTIONS.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </TableSelect>
                        </td>
                        <td data-label="Outcome">
                          <TableSelect
                            className="portal-ticket-row-select"
                            style={{ width: "100%", maxWidth: 136 }}
                            value={(getTicketString(ticket, "outcome", "outcome") || "pending") as TicketOutcome}
                            disabled={updatingOutcomeId === ticket.id || ticket.status !== "resolved"}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const nextOutcome = e.target.value as TicketOutcome;
                              setUpdatingOutcomeId(ticket.id);
                              updateOutcome.mutate({
                                id: ticket.id,
                                expectedUpdatedAt: toMutationDate(getTicketValue(ticket, "updatedAt", "updated_at")),
                                outcome: nextOutcome,
                                lossReason:
                                  nextOutcome === "lost"
                                    ? getTicketString(ticket, "lossReason", "loss_reason") || "Other"
                                    : undefined,
                              });
                            }}
                          >
                            {OUTCOME_OPTIONS.map((outcome) => (
                              <option key={outcome} value={outcome}>
                                {outcome}
                              </option>
                            ))}
                          </TableSelect>
                        </td>
                        {actionCell}
                      </>
                    )}
                  </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={isOrderTicketView ? 8 : 9} style={{ color: "var(--muted)", textAlign: "center", padding: "24px 10px" }}>
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
      <TicketDetailsDrawer
        key={selectedTicket ? `${selectedTicket.id}:${String(getTicketValue(selectedTicket, "updatedAt", "updated_at") ?? "")}` : "ticket-details"}
        ticket={selectedTicket}
        onClose={() => setSelectedTicketId(null)}
        threadHref={selectedTicket ? getThreadHref(selectedTicket) : "/messages"}
        nowMs={nowMs}
        onApproveOrderTicket={handleApproveTicket}
        onDenyOrderTicket={openDenyDialog}
        orderActionPending={orderActionTicketId !== null}
      />
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

function TicketDetailsDrawer({
  ticket,
  onClose,
  threadHref,
  nowMs,
  onApproveOrderTicket,
  onDenyOrderTicket,
  orderActionPending,
}: {
  ticket: TicketRow | null;
  onClose: () => void;
  threadHref: string;
  nowMs: number;
  onApproveOrderTicket: (ticket: TicketRow) => Promise<void>;
  onDenyOrderTicket: (ticket: TicketRow) => void;
  orderActionPending: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [updatingOutcome, setUpdatingOutcome] = useState(false);
  const [updatingSla, setUpdatingSla] = useState(false);
  const [savingTicket, setSavingTicket] = useState(false);
  const ticketId = ticket?.id ?? "";
  const updateOutcome = trpc.tickets.updateTicketOutcome.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.tickets.listTickets.invalidate(),
        utils.tickets.listTicketLedger.invalidate(),
        utils.tickets.getTicketById.invalidate(),
        utils.tickets.getPerformance.invalidate(),
      ]);
      showSuccessToast(toast, {
        title: "Outcome updated",
        message: "Ticket outcome saved successfully.",
      });
    },
    onError: (error) => {
      showErrorToast(toast, {
        title: "Update failed",
        message: error.message || "Ticket outcome could not be saved.",
      });
    },
    onSettled: () => setUpdatingOutcome(false),
  });
  const updateSlaDueAt = trpc.tickets.updateTicketSlaDueAt.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.tickets.listTickets.invalidate(),
        utils.tickets.listTicketLedger.invalidate(),
        utils.tickets.getTicketById.invalidate(),
        utils.tickets.listTicketEvents.invalidate(),
        utils.tickets.getPerformance.invalidate(),
      ]);
      showSuccessToast(toast, {
        title: "SLA updated",
        message: "Ticket SLA saved successfully.",
      });
    },
    onError: (error) => {
      showErrorToast(toast, {
        title: "Update failed",
        message: error.message || "Ticket SLA could not be saved.",
      });
    },
    onSettled: () => setUpdatingSla(false),
  });
  const updateTicket = trpc.tickets.updateTicket.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.tickets.listTickets.invalidate(),
        utils.tickets.listTicketLedger.invalidate(),
        utils.tickets.getTicketById.invalidate(),
        utils.tickets.listTicketEvents.invalidate(),
      ]);
      showSuccessToast(toast, {
        title: "Ticket updated",
        message: "Ticket details saved successfully.",
      });
    },
    onError: (error) => {
      showErrorToast(toast, {
        title: "Save failed",
        message: error.message || "Ticket details could not be saved.",
      });
    },
    onSettled: () => setSavingTicket(false),
  });
  const eventsQuery = trpc.tickets.listTicketEvents.useQuery(
    { ticketId, limit: 80 },
    { enabled: Boolean(ticketId) },
  );
  const slaDueAtRaw = ticket
    ? (getTicketValue(ticket, "slaDueAt", "sla_due_at") as Date | string | null | undefined)
    : null;
  const fields = ticket ? getTicketFields(ticket) : {};
  const initialCustomerName = ticket
    ? (
        firstFieldText(fields, ["name", "customerName", "customer_name"]) ||
        getTicketString(ticket, "customerName", "customer_name")
      )
    : "";
  const initialCustomerPhone = ticket
    ? (
        firstFieldText(fields, ["contact", "phone", "phoneNumber", "mobile", "whatsapp", "customerPhone"]) ||
        getTicketString(ticket, "customerPhone", "customer_phone")
      )
    : "";
  const [slaInput, setSlaInput] = useState(() => toDateTimeLocalValue(slaDueAtRaw));
  const [draftTitle, setDraftTitle] = useState(() => ticket?.title || "");
  const [draftSummary, setDraftSummary] = useState(() => ticket?.summary || "");
  const [draftNotes, setDraftNotes] = useState(() => ticket?.notes || "");
  const [draftCustomerName, setDraftCustomerName] = useState(() => initialCustomerName);
  const [draftCustomerPhone, setDraftCustomerPhone] = useState(() => initialCustomerPhone);
  const [draftOrderLines, setDraftOrderLines] = useState<OrderEditorLine[]>(() => buildOrderEditorLines(fields));
  const [draftOrderTotal, setDraftOrderTotal] = useState(() => getOrderDraftTotal(fields));
  const [draftFieldsText, setDraftFieldsText] = useState(() => JSON.stringify(fields, null, 2));
  if (!ticket) return null;
  const isOrderTicket = isOrderTicketRow(ticket);
  const orderStage = resolveOrderStage(ticket);
  const computedOrderTotal = computeOrderEditorTotal(draftOrderLines);
  const fieldRows = Object.entries(fields);
  const importantFieldRows = getImportantFieldRows(fields);
  const status = getTicketString(ticket, "status");
  const outcome = (getTicketString(ticket, "outcome", "outcome") || "pending") as TicketOutcome;
  const lossReason = getTicketString(ticket, "lossReason", "loss_reason");
  const slaDueAt = slaDueAtRaw;
  const slaCountdown = formatSlaCountdown(slaDueAt, nowMs);
  const priority = getTicketString(ticket, "priority");
  const source = getTicketString(ticket, "source");
  const typeKey = getTicketString(ticket, "ticketTypeKey", "ticket_type_key");
  const createdBy = getTicketString(ticket, "createdBy", "created_by");
  const customerName = initialCustomerName;
  const customerPhone = initialCustomerPhone;
  const customerId = getTicketString(ticket, "customerId", "customer_id");
  const customerHref = customerId ? `/customers?customerId=${encodeURIComponent(customerId)}` : null;
  const createdAt = getTicketValue(ticket, "createdAt", "created_at") as Date | string | null | undefined;
  const updatedAt = getTicketValue(ticket, "updatedAt", "updated_at") as Date | string | null | undefined;
  const resolvedAt = getTicketValue(ticket, "resolvedAt", "resolved_at") as Date | string | null | undefined;
  const closedAt = getTicketValue(ticket, "closedAt", "closed_at") as Date | string | null | undefined;
  const expectedUpdatedAt = toMutationDate(updatedAt);
  const canApproveOrder = isOrderTicket && canApproveOrderStage(orderStage);
  const canDenyOrder = isOrderTicket && canDenyOrderStage(orderStage);

  const handleSaveTicket = () => {
    let parsedFields: Record<string, unknown>;
    try {
      parsedFields = draftFieldsText.trim() ? (JSON.parse(draftFieldsText) as Record<string, unknown>) : {};
    } catch {
      showErrorToast(toast, {
        title: "Invalid JSON",
        message: "Fields must be valid JSON before saving.",
      });
      return;
    }
    if (isOrderTicket) {
      parsedFields = applyOrderEditorToFields(parsedFields, draftOrderLines, draftOrderTotal);
    }
    setSavingTicket(true);
    updateTicket.mutate({
      id: ticket.id,
      expectedUpdatedAt,
      title: draftTitle,
      summary: draftSummary,
      notes: draftNotes,
      customerName: draftCustomerName,
      customerPhone: draftCustomerPhone,
      fields: parsedFields,
    });
  };

  return (
    <>
      <div className="drawer-backdrop open" onClick={onClose} />
      <div className="drawer open portal-drawer-shell">
        <div className="drawer-header">
          <div className="portal-drawer-heading">
            <div>
              <div className="portal-drawer-eyebrow">Ticket Details</div>
              <div className="portal-drawer-title">Ticket #{shortId(ticket.id)}</div>
              <div className="portal-drawer-copy">
                {ticket.title || ticket.summary || "Untitled ticket"}
              </div>
            </div>
            <button className="portal-drawer-close" onClick={onClose} aria-label="Close details">
              <TicketCloseIcon />
            </button>
          </div>
          <div className="portal-drawer-tags">
            <span className={priorityPillClass(priority || "normal")}>{formatStatus(priority || "normal")}</span>
            <span className={isOrderTicket ? orderStagePillClass(orderStage) : "portal-pill portal-pill--neutral"}>
              {isOrderTicket ? formatOrderStage(orderStage) : formatStatus(status || "open")}
            </span>
          </div>
          <div className="portal-drawer-metrics">
            <div className="portal-drawer-metric">
              <div className="portal-drawer-metric__label">Created</div>
              <div className="portal-drawer-metric__value">{formatDate(createdAt)}</div>
            </div>
            <div className="portal-drawer-metric">
              <div className="portal-drawer-metric__label">Updated</div>
              <div className="portal-drawer-metric__value">{formatDate(updatedAt)}</div>
            </div>
            <div className="portal-drawer-metric">
              <div className="portal-drawer-metric__label">SLA Due</div>
              <div className="portal-drawer-metric__value">{formatDate(slaDueAt)}</div>
            </div>
          </div>
        </div>
        <div className="drawer-body">
          <div className="portal-rows">
            <div className="portal-detail-panel">
              <div className="portal-section-head">
                <div className="portal-section-kicker">Ticket #{shortId(ticket.id)}</div>
                <div className="portal-section-title">{ticket.title || ticket.summary || "Untitled ticket"}</div>
                <div className="portal-section-caption">
                  {ticket.summary || ticket.notes || "Review details, update routing, and keep the workflow clean from one place."}
                </div>
              </div>
              <div className="portal-inline-actions" style={{ justifyContent: "flex-start" }}>
                <span className={priorityPillClass(priority || "normal")}>{formatStatus(priority || "normal")}</span>
                <span className={isOrderTicket ? orderStagePillClass(orderStage) : "portal-pill portal-pill--neutral"}>
                  {isOrderTicket ? formatOrderStage(orderStage) : formatStatus(status || "open")}
                </span>
              </div>
              <div className="portal-detail-grid">
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Outcome</div>
                  <div className="portal-detail-value">{isOrderTicket ? formatOrderStage(orderStage) : outcome}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">SLA Due</div>
                  <div className="portal-detail-value">{formatDate(slaDueAt)}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">SLA Timer</div>
                  <div className="portal-detail-value">{slaCountdown.label}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Type</div>
                  <div className="portal-detail-value">{formatStatus(typeKey || "-")}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Source</div>
                  <div className="portal-detail-value">{source || "-"}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Created By</div>
                  <div className="portal-detail-value">{createdBy || "-"}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Created</div>
                  <div className="portal-detail-value">{formatDate(createdAt)}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Updated</div>
                  <div className="portal-detail-value">{formatDate(updatedAt)}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Resolved</div>
                  <div className="portal-detail-value">{formatDate(resolvedAt)}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Closed</div>
                  <div className="portal-detail-value">{formatDate(closedAt)}</div>
                </div>
              </div>
            </div>

            <div className="portal-detail-panel">
              <div className="portal-section-head">
                <div className="portal-section-kicker">Workflow</div>
                <div className="portal-section-title">Routing And Customer Details</div>
                <div className="portal-section-caption">
                  Keep the SLA, customer details, and workflow fields aligned without exposing raw JSON by default.
                </div>
              </div>

              <div className="portal-field">
                <div className="portal-field-label">SLA due date</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    type="datetime-local"
                    value={slaInput}
                    onChange={(e) => setSlaInput(e.target.value)}
                    style={{ flex: "1 1 220px" }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={updatingSla}
                    onClick={() => {
                      setUpdatingSla(true);
                      updateSlaDueAt.mutate({
                        id: ticket.id,
                        expectedUpdatedAt,
                        slaDueAt: slaInput ? new Date(slaInput) : null,
                      });
                    }}
                  >
                    Save SLA
                  </button>
                </div>
              </div>

              {isOrderTicket ? (
                <div className="portal-note-box">
                  <div className="portal-detail-label" style={{ marginBottom: 8 }}>Current stage</div>
                  <span className={orderStagePillClass(orderStage)}>{formatOrderStage(orderStage)}</span>
                  <div className="portal-section-caption" style={{ marginTop: 10 }}>{describeOrderStage(orderStage)}</div>
                  {lossReason ? (
                    <div className="portal-meta-text" style={{ marginTop: 10 }}>
                      Last denial reason: {lossReason}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="portal-form-grid">
                  <div className="portal-field">
                    <div className="portal-field-label">Outcome</div>
                    <TableSelect
                      style={{ width: "100%" }}
                      value={outcome}
                      disabled={updatingOutcome || status !== "resolved"}
                      onChange={(e) => {
                        const nextOutcome = e.target.value as TicketOutcome;
                        setUpdatingOutcome(true);
                        updateOutcome.mutate({
                          id: ticket.id,
                          expectedUpdatedAt,
                          outcome: nextOutcome,
                          lossReason: nextOutcome === "lost" ? lossReason || "Other" : undefined,
                        });
                      }}
                    >
                      {OUTCOME_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </TableSelect>
                  </div>
                  <div className="portal-field">
                    <div className="portal-field-label">Loss reason</div>
                    <TableSelect
                      style={{ width: "100%" }}
                      value={lossReason || "Other"}
                      disabled={updatingOutcome || outcome !== "lost"}
                      onChange={(e) => {
                        setUpdatingOutcome(true);
                        updateOutcome.mutate({
                          id: ticket.id,
                          expectedUpdatedAt,
                          outcome: "lost",
                          lossReason: e.target.value,
                        });
                      }}
                    >
                      {LOSS_REASON_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </TableSelect>
                  </div>
                </div>
              )}

              <div className="portal-detail-grid">
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Customer</div>
                  <div className="portal-detail-value">{customerName || customerPhone || "-"}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Customer Phone</div>
                  <div className="portal-detail-value">{customerPhone || "-"}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Customer ID</div>
                  <div className="portal-detail-value" style={{ fontFamily: "var(--font-mono)" }}>{customerId || "-"}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Summary</div>
                  <div className="portal-detail-value">{ticket.summary || ticket.title || "No summary available."}</div>
                </div>
              </div>

              {importantFieldRows.length ? (
                <div>
                  <div className="portal-detail-label" style={{ marginBottom: 8 }}>Captured details</div>
                  <div className="portal-table-details">
                    {importantFieldRows.map((row) => (
                      <div key={row.key} className="portal-table-details__row">
                        <div className="portal-table-details__label">{row.label}</div>
                        <div className="portal-table-details__value">{row.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {ticket.notes ? (
                <div className="portal-note-box">
                  <div className="portal-detail-label" style={{ marginBottom: 8 }}>Internal notes</div>
                  <div>{ticket.notes}</div>
                </div>
              ) : null}
            </div>

            {isOrderTicket ? (
              <div className="portal-detail-panel">
                <div className="portal-section-head">
                  <div className="portal-section-kicker">Edit</div>
                  <div className="portal-section-title">Ticket And Order Draft</div>
                  <div className="portal-section-caption">
                    Keep the order editor structured first. Advanced JSON stays available, but collapsed until staff actually needs it.
                  </div>
                </div>

                <div className="portal-form-grid">
                  <div className="portal-field">
                    <div className="portal-field-label">Title</div>
                    <input type="text" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
                  </div>
                  <div className="portal-field">
                    <div className="portal-field-label">Customer Name</div>
                    <input type="text" value={draftCustomerName} onChange={(e) => setDraftCustomerName(e.target.value)} />
                  </div>
                  <div className="portal-field">
                    <div className="portal-field-label">Customer Phone</div>
                    <input type="text" value={draftCustomerPhone} onChange={(e) => setDraftCustomerPhone(e.target.value)} />
                  </div>
                  <div className="portal-field portal-field--full">
                    <div className="portal-field-label">Summary</div>
                    <textarea value={draftSummary} onChange={(e) => setDraftSummary(e.target.value)} style={{ minHeight: 96 }} />
                  </div>
                  <div className="portal-field portal-field--full">
                    <div className="portal-field-label">Internal Notes</div>
                    <textarea value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} style={{ minHeight: 88 }} />
                  </div>
                </div>

                <div className="portal-rows">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div className="portal-section-title" style={{ fontSize: 16 }}>Order Items</div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setDraftOrderLines((current) => [...current, { item: "", quantity: "1", unitPrice: "" }])}
                    >
                      Add Item
                    </button>
                  </div>

                  {draftOrderLines.length ? (
                    <div className="portal-rows">
                      {draftOrderLines.map((line, index) => (
                        <div key={`order-line-${index}`} className="portal-order-line">
                          <div className="portal-field">
                            <div className="portal-field-label">Item</div>
                            <input
                              type="text"
                              value={line.item}
                              onChange={(e) =>
                                setDraftOrderLines((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, item: e.target.value } : entry,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div className="portal-field">
                            <div className="portal-field-label">Qty</div>
                            <input
                              type="number"
                              min={1}
                              value={line.quantity}
                              onChange={(e) =>
                                setDraftOrderLines((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, quantity: e.target.value } : entry,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div className="portal-field">
                            <div className="portal-field-label">Unit Price</div>
                            <input
                              type="text"
                              value={line.unitPrice}
                              onChange={(e) =>
                                setDraftOrderLines((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, unitPrice: e.target.value } : entry,
                                  ),
                                )
                              }
                              placeholder="Optional"
                            />
                          </div>
                          <div className="portal-order-line-actions">
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() =>
                                setDraftOrderLines((current) => current.filter((_, entryIndex) => entryIndex !== index))
                              }
                            >
                              Remove
                            </button>
                            <div className="portal-meta-text">
                              Line Total: {computeOrderEditorLineTotal(line) || "-"}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="portal-meta-text">No order items yet.</div>
                  )}
                </div>

                <div className="portal-form-grid">
                  <div className="portal-field">
                    <div className="portal-field-label">Order Total</div>
                    <input
                      type="text"
                      value={draftOrderTotal}
                      onChange={(e) => setDraftOrderTotal(e.target.value)}
                      placeholder={computedOrderTotal || "Optional"}
                    />
                  </div>
                  <div className="portal-field">
                    <div className="portal-field-label">Computed Total</div>
                    <div className="portal-read-box">{computedOrderTotal || "-"}</div>
                  </div>
                </div>

                <details className="portal-disclosure">
                  <summary>Advanced Fields JSON</summary>
                  <div className="portal-disclosure__body">
                    <textarea
                      value={draftFieldsText}
                      onChange={(e) => setDraftFieldsText(e.target.value)}
                      style={{ minHeight: 220, fontFamily: "var(--font-mono)", fontSize: 12 }}
                    />
                  </div>
                </details>

                <div className="portal-inline-actions" style={{ justifyContent: "flex-start" }}>
                  <button type="button" className="btn btn-primary" disabled={savingTicket} onClick={handleSaveTicket}>
                    {savingTicket ? "Saving..." : "Save Ticket"}
                  </button>
                </div>
              </div>
            ) : null}

            {fieldRows.length ? (
              <details className="portal-disclosure">
                <summary>Raw Structured Fields</summary>
                <div className="portal-disclosure__body">
                  <div className="portal-table-details">
                    {fieldRows.map(([key, value]) => (
                      <div key={key} className="portal-table-details__row">
                        <div className="portal-table-details__label">{key}</div>
                        <div className="portal-table-details__value">{formatFieldValue(value, key, fields)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ) : null}

            <div className="portal-detail-panel">
              <div className="portal-section-head">
                <div className="portal-section-kicker">History</div>
                <div className="portal-section-title">Ticket Timeline</div>
                <div className="portal-section-caption">Every major change on the ticket, ordered newest to oldest.</div>
              </div>
              {!eventsQuery.data?.length ? (
                <div className="portal-meta-text">No change history yet.</div>
              ) : (
                <div className="portal-rows">
                  {(eventsQuery.data as TicketEventRow[]).map((evt) => {
                    const payload = evt.payload ?? {};
                    const pretty = (() => {
                      if (evt.eventType === "status_changed") {
                        return `Status ${(payload.from as string) || "-"} -> ${(payload.to as string) || "-"}`;
                      }
                      if (evt.eventType === "outcome_changed") {
                        return `Outcome ${(payload.from as string) || "-"} -> ${(payload.to as string) || "-"}`;
                      }
                      if (evt.eventType === "sla_changed") {
                        return `SLA ${formatDate(payload.from as string | null | undefined)} -> ${formatDate(payload.to as string | null | undefined)}`;
                      }
                      if (evt.eventType === "created") {
                        return "Ticket created";
                      }
                      return evt.eventType.replace(/_/g, " ");
                    })();
                    return (
                      <div key={evt.id} className="portal-note-box">
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{pretty}</div>
                        {(payload.lossReason as string | undefined) ? (
                          <div className="portal-meta-text">Loss reason: {String(payload.lossReason)}</div>
                        ) : null}
                        <div className="portal-meta-text">
                          {formatDate(evt.createdAt)} by {evt.actorLabel || evt.actorType || "system"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        </div>
        <div className="portal-drawer-footer">
          <div className="portal-drawer-footer__label">{isOrderTicket ? "Order Actions" : "Quick Actions"}</div>
          <div className="portal-drawer-footer__actions">
            {isOrderTicket ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={orderActionPending || !canApproveOrder}
                  onClick={() => void onApproveOrderTicket(ticket)}
                >
                  Approve Order
                </button>
                <button
                  type="button"
                  className="btn btn-secondary portal-button--danger"
                  disabled={orderActionPending || !canDenyOrder}
                  onClick={() => onDenyOrderTicket(ticket)}
                >
                  Deny Order
                </button>
              </>
            ) : null}
            <button
              type="button"
              className={isOrderTicket ? "btn btn-secondary" : "btn btn-primary"}
              onClick={() => {
                onClose();
                router.push(threadHref);
              }}
            >
              Open Thread
            </button>
            {customerHref ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  onClose();
                  router.push(customerHref);
                }}
              >
                Customer Details
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" disabled>
                Customer Details
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
