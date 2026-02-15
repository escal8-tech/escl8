"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { trpc } from "@/utils/trpc";
import { useRouter, useSearchParams } from "next/navigation";
import { TableSelect } from "@/app/portal/components/TableToolbarControls";
import { PortalDataTable } from "@/app/portal/components/PortalDataTable";
import { TablePagination } from "@/app/portal/components/TablePagination";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { RowActionsMenu } from "@/app/portal/components/RowActionsMenu";

type TicketStatus = "open" | "in_progress" | "resolved";
type TicketOutcome = "pending" | "won" | "lost";
type TicketEventRow = {
  id: string;
  eventType: string;
  actorType: string;
  actorLabel?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt?: Date | string | null;
};
type TicketRow = {
  [key: string]: unknown;
  id: string;
  status: string;
  title?: string | null;
  summary?: string | null;
  notes?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  customerId?: string | null;
  threadId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  source?: string | null;
  ticketTypeKey?: string | null;
  ticketTypeId?: string | null;
  businessId?: string | null;
  whatsappIdentityId?: string | null;
  fields?: Record<string, unknown> | null;
  createdBy?: string | null;
  resolvedAt?: Date | string | null;
  closedAt?: Date | string | null;
  priority?: string | null;
  outcome?: string | null;
  lossReason?: string | null;
  slaDueAt?: Date | string | null;
};

const STATUS_OPTIONS: TicketStatus[] = ["open", "in_progress", "resolved"];
const OUTCOME_OPTIONS: TicketOutcome[] = ["pending", "won", "lost"];
const LOSS_REASON_OPTIONS = [
  "Price too high",
  "No response",
  "Competitor chosen",
  "Out of stock",
  "Not ready to buy",
  "Other",
];
const PAGE_SIZE = 20;

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function toDateTimeLocalValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${mins}`;
}

function formatSlaCountdown(
  value: Date | string | null | undefined,
  nowMs: number,
): { label: string; tone: "ok" | "warn" | "danger" | "muted" } {
  if (!value) return { label: "No SLA", tone: "muted" };
  const due = new Date(value).getTime();
  if (!Number.isFinite(due)) return { label: "No SLA", tone: "muted" };
  const diffMs = due - nowMs;
  const abs = Math.abs(diffMs);
  const minutes = Math.floor(abs / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const compact = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  if (diffMs < 0) return { label: `Overdue by ${compact}`, tone: "danger" };
  if (diffMs < 60 * 60 * 1000) return { label: `${compact} left`, tone: "warn" };
  return { label: `${compact} left`, tone: "ok" };
}

function getTicketValue(ticket: TicketRow, camelKey: string, snakeKey?: string): unknown {
  if (ticket[camelKey] != null) return ticket[camelKey];
  if (snakeKey && ticket[snakeKey] != null) return ticket[snakeKey];
  return null;
}

function getTicketString(ticket: TicketRow, camelKey: string, snakeKey?: string): string {
  const value = getTicketValue(ticket, camelKey, snakeKey);
  if (value == null) return "";
  return String(value);
}

function getTicketFields(ticket: TicketRow): Record<string, unknown> {
  const value = getTicketValue(ticket, "fields");
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function formatFieldValue(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function priorityPillStyle(priorityRaw: string): CSSProperties {
  const priority = priorityRaw.toLowerCase();
  if (priority === "urgent") {
    return {
      background: "rgba(239, 68, 68, 0.16)",
      color: "#fca5a5",
      border: "1px solid rgba(239, 68, 68, 0.35)",
    };
  }
  if (priority === "high") {
    return {
      background: "rgba(249, 115, 22, 0.14)",
      color: "#fdba74",
      border: "1px solid rgba(249, 115, 22, 0.3)",
    };
  }
  if (priority === "normal") {
    return {
      background: "rgba(56, 189, 248, 0.12)",
      color: "#7dd3fc",
      border: "1px solid rgba(56, 189, 248, 0.28)",
    };
  }
  return {
    background: "rgba(148, 163, 184, 0.12)",
    color: "#cbd5e1",
    border: "1px solid rgba(148, 163, 184, 0.28)",
  };
}

function normalizeTicketTypeLabel(typeKey: string, label: string): string {
  if (typeKey === "ordercreation") return "Orders";
  return label;
}

export default function TicketsPage() {
  const utils = trpc.useUtils();
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<"all" | TicketStatus>("all");
  const [ticketIdQuery, setTicketIdQuery] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updatingOutcomeId, setUpdatingOutcomeId] = useState<string | null>(null);
  const [pendingBotCustomerIds, setPendingBotCustomerIds] = useState<Record<string, boolean>>({});
  const [botPausedOverrides, setBotPausedOverrides] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(0);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const searchParams = useSearchParams();
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const ticketTypesQuery = trpc.tickets.listTypes.useQuery({ includeDisabled: true });
  const ticketListInput = useMemo(
    () => (statusFilter === "all" ? undefined : { status: statusFilter, limit: 400 }),
    [statusFilter],
  );
  const ticketsQuery = trpc.tickets.listTickets.useQuery(ticketListInput);
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
      utils.tickets.listTickets.invalidate(),
      utils.tickets.listTypes.invalidate(),
    ]);
  }, [utils]);

  useLivePortalEvents({
    ticketListInputs: [ticketListInput],
    onCatchup: invalidateTickets,
  });
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
  const ticketsData = useMemo(() => ticketsQuery.data ?? [], [ticketsQuery.data]);
  const ticketTypesData = useMemo(() => ticketTypesQuery.data ?? [], [ticketTypesQuery.data]);

  const groupedTickets = useMemo(() => {
    const ticketsByType = new Map<string, TicketRow[]>();
    for (const ticket of ticketsData as TicketRow[]) {
      const key = ticket.ticketTypeKey || "untyped";
      const current = ticketsByType.get(key) ?? [];
      current.push(ticket);
      ticketsByType.set(key, current);
    }

    const groups: Array<{
      typeKey: string;
      label: string;
      enabled: boolean;
      rows: TicketRow[];
    }> = [];

    for (const type of ticketTypesData) {
      groups.push({
        typeKey: type.key,
        label: normalizeTicketTypeLabel(type.key, type.label),
        enabled: type.enabled,
        rows: ticketsByType.get(type.key) ?? [],
      });
      ticketsByType.delete(type.key);
    }

    for (const [typeKey, rows] of ticketsByType.entries()) {
      groups.push({
        typeKey,
        label: typeKey,
        enabled: true,
        rows,
      });
    }

    return groups;
  }, [ticketTypesData, ticketsData]);

  const normalizedGroups = useMemo(() => groupedTickets.sort((a, b) => a.label.localeCompare(b.label)), [groupedTickets]);

  const queryTypeKey = (searchParams?.get("type") || "").toLowerCase();
  const effectiveTypeKey = useMemo(() => {
    if (!normalizedGroups.length) return null;
    if (queryTypeKey && normalizedGroups.some((g) => g.typeKey === queryTypeKey)) return queryTypeKey;
    return normalizedGroups[0]?.typeKey ?? null;
  }, [normalizedGroups, queryTypeKey]);
  const performanceQuery = trpc.tickets.getPerformance.useQuery(
    effectiveTypeKey ? { typeKey: effectiveTypeKey, windowDays: 30 } : { windowDays: 30 },
  );

  const activeGroup = useMemo(
    () => normalizedGroups.find((g) => g.typeKey === effectiveTypeKey) ?? null,
    [normalizedGroups, effectiveTypeKey],
  );
  const filteredRows = useMemo(() => {
    const rows = activeGroup?.rows ?? [];
    const q = ticketIdQuery.trim().toLowerCase().replace(/^#/, "");
    if (!q) return rows;
    return rows.filter((ticket) => {
      const full = ticket.id.toLowerCase();
      const short = shortId(ticket.id).toLowerCase();
      return full.includes(q) || short.includes(q);
    });
  }, [activeGroup?.rows, ticketIdQuery]);
  const fieldColumns = useMemo(() => {
    const frequency = new Map<string, number>();
    for (const row of filteredRows) {
      const fields = getTicketFields(row as TicketRow);
      for (const key of Object.keys(fields)) {
        if (key.toLowerCase() === "contact") continue;
        frequency.set(key, (frequency.get(key) ?? 0) + 1);
      }
    }
    return Array.from(frequency.entries())
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      })
      .slice(0, 4)
      .map(([key]) => key);
  }, [filteredRows]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = useMemo(
    () => filteredRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [filteredRows, safePage],
  );
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
  const selectedTicket = useMemo(() => {
    if (!selectedTicketId) return null;
    return (ticketsData as TicketRow[]).find((t) => t.id === selectedTicketId) ?? null;
  }, [selectedTicketId, ticketsData]);
  const getThreadHref = useCallback((ticket: TicketRow) => {
    const params = new URLSearchParams();
    if (ticket.threadId) params.set("threadId", ticket.threadId);
    else if (ticket.customerId) params.set("customerId", ticket.customerId);
    else if (ticket.customerPhone) params.set("phone", ticket.customerPhone);
    const query = params.toString();
    return query ? `/portal/messages?${query}` : "/portal/messages";
  }, []);

  return (
    <PortalDataTable
      search={{
        value: ticketIdQuery,
        onChange: (value) => {
          setTicketIdQuery(value);
          setPage(0);
        },
        placeholder: "Search ticket ID...",
        style: { width: "min(520px, 52vw)", minWidth: 220, flex: "0 1 520px" },
      }}
      countText={`${filteredRows.length} ticket${filteredRows.length !== 1 ? "s" : ""}`}
      endControls={(
        <>
          <label htmlFor="ticket-status-filter" style={{ color: "var(--muted)", fontSize: 12 }}>
            Status
          </label>
        <TableSelect
          id="ticket-status-filter"
          style={{ width: 120 }}
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as "all" | TicketStatus);
            setPage(0);
          }}
        >
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
        </TableSelect>
        </>
      )}
      footer={(
        <TablePagination
          page={safePage}
          totalPages={totalPages}
          shownCount={pageRows.length}
          totalCount={filteredRows.length}
          canPrev={safePage > 0}
          canNext={safePage < totalPages - 1}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
        />
      )}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <div className="card">
          <div className="card-body" style={{ padding: "10px 12px" }}>
            <div className="text-muted" style={{ fontSize: 11 }}>30d Conversion</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{performanceQuery.data?.conversionRate ?? 0}%</div>
            <div className="text-muted" style={{ fontSize: 11 }}>
              Won {performanceQuery.data?.wonCount ?? 0} / Lost {performanceQuery.data?.lostCount ?? 0}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body" style={{ padding: "10px 12px" }}>
            <div className="text-muted" style={{ fontSize: 11 }}>SLA On-Time</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{performanceQuery.data?.slaOnTimeRate ?? 0}%</div>
            <div className="text-muted" style={{ fontSize: 11 }}>
              {performanceQuery.data?.resolvedOnTime ?? 0} on-time / {performanceQuery.data?.resolvedTotal ?? 0} resolved
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body" style={{ padding: "10px 12px" }}>
            <div className="text-muted" style={{ fontSize: 11 }}>Overdue Open</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fca5a5" }}>{performanceQuery.data?.overdueOpen ?? 0}</div>
            <div className="text-muted" style={{ fontSize: 11 }}>Needs attention now</div>
          </div>
        </div>
        <div className="card">
          <div className="card-body" style={{ padding: "10px 12px" }}>
            <div className="text-muted" style={{ fontSize: 11 }}>Tickets (30d)</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{performanceQuery.data?.total ?? 0}</div>
            <div className="text-muted" style={{ fontSize: 11 }}>{activeGroup?.label ?? "All types"}</div>
          </div>
        </div>
      </div>

      {!normalizedGroups.length ? (
        <div className="empty-state" style={{ flex: 1 }}>
          <div className="empty-state-title">No tickets found</div>
        </div>
      ) : activeGroup ? (
        <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          <table className="table table-clickable portal-modern-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", width: 170 }}>Ticket</th>
                <th style={{ textAlign: "left", width: 180 }}>Customer</th>
                {fieldColumns.map((key) => (
                  <th key={key} style={{ textAlign: "left", minWidth: 130, maxWidth: 180 }}>
                    {key}
                  </th>
                ))}
                <th style={{ textAlign: "left", width: 100 }}>Priority</th>
                <th style={{ textAlign: "left", width: 170 }}>SLA</th>
                <th style={{ textAlign: "left", width: 150 }}>Updated</th>
                <th style={{ textAlign: "center", width: 108 }}>Bot</th>
                <th style={{ textAlign: "right", width: 132 }}>Status</th>
                <th style={{ textAlign: "right", width: 130 }}>Outcome</th>
                <th style={{ textAlign: "center", width: 64 }} />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((ticket) => (
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
                  <td>
                    <div style={{ display: "grid", gap: 3 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {ticket.title || normalizeTicketTypeLabel(getTicketString(ticket, "ticketTypeKey", "ticket_type_key"), "Ticket")}
                      </div>
                      <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--muted)" }}>
                        #{shortId(ticket.id)}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "grid", gap: 3 }}>
                      <div>{getTicketString(ticket, "customerName", "customer_name") || getTicketString(ticket, "customerPhone", "customer_phone") || "-"}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>
                        {getTicketString(ticket, "customerPhone", "customer_phone") || "No phone"}
                      </div>
                    </div>
                  </td>
                  {fieldColumns.map((key) => {
                    const fields = getTicketFields(ticket as TicketRow);
                    return (
                      <td key={`${ticket.id}-${key}`}>
                        <span
                          style={{
                            display: "inline-block",
                            maxWidth: 180,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            color: "var(--foreground)",
                            fontSize: 13,
                          }}
                          title={formatFieldValue(fields[key])}
                        >
                          {formatFieldValue(fields[key])}
                        </span>
                      </td>
                    );
                  })}
                  <td>
                    <span
                      style={{
                        ...priorityPillStyle(getTicketString(ticket, "priority") || "normal"),
                        padding: "4px 10px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.01em",
                        textTransform: "uppercase",
                        display: "inline-flex",
                      }}
                    >
                      {(getTicketString(ticket, "priority") || "normal")}
                    </span>
                  </td>
                  <td>
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
                  <td style={{ color: "var(--muted)", fontSize: 12 }}>
                    {formatDate((getTicketValue(ticket, "updatedAt", "updated_at") as Date | string | null | undefined) ?? ticket.createdAt)}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {getTicketString(ticket, "customerId", "customer_id") ? (
                      (() => {
                        const customerId = getTicketString(ticket, "customerId", "customer_id");
                        const paused = botPausedOverrides[customerId] ?? Boolean(customerBotPausedMapQuery.data?.[customerId]);
                        const isPending = Boolean(pendingBotCustomerIds[customerId]);
                        return (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isPending) return;
                              toggleBot.mutate({ customerId, botPaused: !paused });
                            }}
                            disabled={isPending}
                            style={{ width: 94, justifyContent: "center", opacity: isPending ? 0.6 : 1 }}
                          >
                            {paused ? "Resume" : "Pause"}
                          </button>
                        );
                      })()
                    ) : (
                      <span className="text-muted" style={{ fontSize: 12 }}>-</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <TableSelect
                      style={{ width: 116 }}
                      value={(ticket.status === "closed" ? "resolved" : ticket.status) as TicketStatus}
                      disabled={updatingId === ticket.id}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const nextStatus = e.target.value as TicketStatus;
                        setUpdatingId(ticket.id);
                        updateStatus.mutate({ id: ticket.id, status: nextStatus });
                      }}
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </TableSelect>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <TableSelect
                      style={{ width: 118 }}
                      value={(getTicketString(ticket, "outcome", "outcome") || "pending") as TicketOutcome}
                      disabled={updatingOutcomeId === ticket.id || ticket.status !== "resolved"}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const nextOutcome = e.target.value as TicketOutcome;
                        setUpdatingOutcomeId(ticket.id);
                        updateOutcome.mutate({
                          id: ticket.id,
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
                  <td
                    style={{ textAlign: "center" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RowActionsMenu
                      items={[
                        {
                          label: "Open Thread",
                          onSelect: () => router.push(getThreadHref(ticket as TicketRow)),
                        },
                        {
                          label: "Customer Details",
                          disabled: !getTicketString(ticket as TicketRow, "customerId", "customer_id"),
                          onSelect: () => {
                            const customerId = getTicketString(ticket as TicketRow, "customerId", "customer_id");
                            if (!customerId) return;
                            router.push(`/portal/customers?customerId=${encodeURIComponent(customerId)}`);
                          },
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={9 + fieldColumns.length} style={{ color: "var(--muted)", textAlign: "center", padding: "20px 10px" }}>
                    {ticketIdQuery ? (
                      "No ticket IDs match your search."
                    ) : (
                      <div style={{ display: "grid", placeItems: "center", gap: 10, padding: "8px 0" }}>
                        <div
                          aria-hidden
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 12,
                            display: "grid",
                            placeItems: "center",
                            color: "#D4A84B",
                            border: "1px solid rgba(212, 168, 75, 0.45)",
                            background: "linear-gradient(135deg, rgba(212,168,75,0.16), rgba(212,168,75,0.06))",
                          }}
                        >
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M8 21h8" />
                            <path d="M12 17v4" />
                            <path d="M7 4h10v6a5 5 0 0 1-10 0V4z" />
                            <path d="M17 6h3a2 2 0 0 1-2 2h-1" />
                            <path d="M7 6H4a2 2 0 0 0 2 2h1" />
                          </svg>
                        </div>
                        <div style={{ color: "var(--foreground, #e2e8f0)", fontWeight: 600 }}>
                          Congratulations!
                        </div>
                        <div style={{ color: "var(--muted)", fontSize: 13 }}>
                          Well done, no pending tickets in this type.
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
      <TicketDetailsDrawer
        key={selectedTicket?.id ?? "ticket-details"}
        ticket={selectedTicket}
        onClose={() => setSelectedTicketId(null)}
        threadHref={selectedTicket ? getThreadHref(selectedTicket) : "/portal/messages"}
        nowMs={nowMs}
      />
    </PortalDataTable>
  );
}

function TicketDetailsDrawer({
  ticket,
  onClose,
  threadHref,
  nowMs,
}: {
  ticket: TicketRow | null;
  onClose: () => void;
  threadHref: string;
  nowMs: number;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [updatingOutcome, setUpdatingOutcome] = useState(false);
  const [updatingSla, setUpdatingSla] = useState(false);
  const ticketId = ticket?.id ?? "";
  const updateOutcome = trpc.tickets.updateTicketOutcome.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.tickets.listTickets.invalidate(),
        utils.tickets.getPerformance.invalidate(),
      ]);
    },
    onSettled: () => setUpdatingOutcome(false),
  });
  const updateSlaDueAt = trpc.tickets.updateTicketSlaDueAt.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.tickets.listTickets.invalidate(),
        utils.tickets.listTicketEvents.invalidate(),
        utils.tickets.getPerformance.invalidate(),
      ]);
    },
    onSettled: () => setUpdatingSla(false),
  });
  const eventsQuery = trpc.tickets.listTicketEvents.useQuery(
    { ticketId, limit: 80 },
    { enabled: Boolean(ticketId) },
  );
  const slaDueAtRaw = ticket
    ? (getTicketValue(ticket, "slaDueAt", "sla_due_at") as Date | string | null | undefined)
    : null;
  const [slaInput, setSlaInput] = useState(() => toDateTimeLocalValue(slaDueAtRaw));
  if (!ticket) return null;
  const fields = getTicketFields(ticket);
  const fieldRows = Object.entries(fields);
  const status = getTicketString(ticket, "status");
  const outcome = (getTicketString(ticket, "outcome", "outcome") || "pending") as TicketOutcome;
  const lossReason = getTicketString(ticket, "lossReason", "loss_reason");
  const slaDueAt = slaDueAtRaw;
  const slaCountdown = formatSlaCountdown(slaDueAt, nowMs);
  const priority = getTicketString(ticket, "priority");
  const source = getTicketString(ticket, "source");
  const typeKey = getTicketString(ticket, "ticketTypeKey", "ticket_type_key");
  const createdBy = getTicketString(ticket, "createdBy", "created_by");
  const customerName = getTicketString(ticket, "customerName", "customer_name");
  const customerPhone = getTicketString(ticket, "customerPhone", "customer_phone");
  const customerId = getTicketString(ticket, "customerId", "customer_id");
  const customerHref = customerId ? `/portal/customers?customerId=${encodeURIComponent(customerId)}` : null;
  const createdAt = getTicketValue(ticket, "createdAt", "created_at") as Date | string | null | undefined;
  const updatedAt = getTicketValue(ticket, "updatedAt", "updated_at") as Date | string | null | undefined;
  const resolvedAt = getTicketValue(ticket, "resolvedAt", "resolved_at") as Date | string | null | undefined;
  const closedAt = getTicketValue(ticket, "closedAt", "closed_at") as Date | string | null | undefined;

  return (
    <>
      <div className="drawer-backdrop open" onClick={onClose} />
      <div className="drawer open">
        <div className="drawer-header">
          <h3 className="drawer-title">Ticket Details</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close details">
            x
          </button>
        </div>
        <div className="drawer-body">
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 12 }}>
                <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--muted)" }}>
                  #{shortId(ticket.id)} ({ticket.id})
                </div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{ticket.title || ticket.summary || "Untitled ticket"}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Status</div>
                    <div>{formatStatus(status || "open")}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Priority</div>
                    <div>{formatStatus(priority || "-")}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Outcome</div>
                    <div>{outcome}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>SLA Due</div>
                    <div>{formatDate(slaDueAt)}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>SLA Timer</div>
                    <div>{slaCountdown.label}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Type</div>
                    <div>{formatStatus(typeKey || "-")}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Source</div>
                    <div>{source || "-"}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Created</div>
                    <div>{formatDate(createdAt)}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Updated</div>
                    <div>{formatDate(updatedAt)}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Resolved</div>
                    <div>{formatDate(resolvedAt)}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Closed</div>
                    <div>{formatDate(closedAt)}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Created By</div>
                    <div>{createdBy || "-"}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 10 }}>
                <div>
                  <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>SLA due date</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="datetime-local"
                      value={slaInput}
                      onChange={(e) => setSlaInput(e.target.value)}
                      style={{
                        width: "100%",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        background: "var(--card)",
                        color: "var(--foreground)",
                        padding: "8px 10px",
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={updatingSla}
                      onClick={() => {
                        setUpdatingSla(true);
                        updateSlaDueAt.mutate({
                          id: ticket.id,
                          slaDueAt: slaInput ? new Date(slaInput) : null,
                        });
                      }}
                    >
                      Save SLA
                    </button>
                  </div>
                </div>
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Outcome</div>
                    <TableSelect
                      style={{ width: "100%" }}
                      value={outcome}
                      disabled={updatingOutcome || status !== "resolved"}
                      onChange={(e) => {
                        const nextOutcome = e.target.value as TicketOutcome;
                        setUpdatingOutcome(true);
                        updateOutcome.mutate({
                          id: ticket.id,
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
                  <div>
                    <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Loss reason</div>
                    <TableSelect
                      style={{ width: "100%" }}
                      value={lossReason || "Other"}
                      disabled={updatingOutcome || outcome !== "lost"}
                      onChange={(e) => {
                        setUpdatingOutcome(true);
                        updateOutcome.mutate({
                          id: ticket.id,
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
                <div>
                  <div className="text-muted" style={{ fontSize: 12 }}>Customer</div>
                  <div style={{ fontWeight: 500 }}>{customerName || customerPhone || "-"}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Customer ID</div>
                    <div style={{ fontFamily: "monospace", fontSize: 12 }}>{customerId || "-"}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Customer Phone</div>
                    <div style={{ fontFamily: "monospace", fontSize: 12 }}>{customerPhone || "-"}</div>
                  </div>
                </div>
                <div>
                  <div className="text-muted" style={{ fontSize: 12 }}>Summary</div>
                  <p style={{ margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {ticket.summary || ticket.title || "No summary available."}
                  </p>
                </div>
                {ticket.notes ? (
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Notes</div>
                    <p style={{ margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{ticket.notes}</p>
                  </div>
                ) : null}
                <div>
                  <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>Fields</div>
                  {fieldRows.length ? (
                    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                      {fieldRows.map(([key, value]) => (
                        <div
                          key={key}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "140px minmax(0, 1fr)",
                            gap: 10,
                            padding: "8px 10px",
                            borderBottom: "1px solid var(--border)",
                          }}
                        >
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>{key}</div>
                          <div style={{ fontSize: 13, wordBreak: "break-word" }}>
                            {typeof value === "string" ? value : JSON.stringify(value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted" style={{ margin: 0 }}>No structured fields provided.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 8 }}>
                <div className="text-muted" style={{ fontSize: 12 }}>Ticket Timeline</div>
                {!eventsQuery.data?.length ? (
                  <div className="text-muted" style={{ fontSize: 13 }}>No change history yet.</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
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
                        <div
                          key={evt.id}
                          style={{
                            border: "1px solid var(--border)",
                            borderRadius: 10,
                            padding: "8px 10px",
                            display: "grid",
                            gap: 4,
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{pretty}</div>
                          {(payload.lossReason as string | undefined) ? (
                            <div style={{ fontSize: 12, color: "var(--muted)" }}>
                              Loss reason: {String(payload.lossReason)}
                            </div>
                          ) : null}
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            {formatDate(evt.createdAt)} by {evt.actorLabel || evt.actorType || "system"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-primary"
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
                  className="btn btn-ghost"
                  onClick={() => {
                    onClose();
                    router.push(customerHref);
                  }}
                  style={{ marginLeft: 10 }}
                >
                  Customer Details
                </button>
              ) : (
                <button type="button" className="btn btn-ghost" disabled style={{ marginLeft: 10 }}>
                  Customer Details
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

