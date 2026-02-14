"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { trpc } from "@/utils/trpc";
import { useSearchParams } from "next/navigation";
import { TableSelect } from "@/app/portal/components/TableToolbarControls";
import { PortalDataTable } from "@/app/portal/components/PortalDataTable";
import { TablePagination } from "@/app/portal/components/TablePagination";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";

type TicketStatus = "open" | "in_progress" | "resolved";

const STATUS_OPTIONS: TicketStatus[] = ["open", "in_progress", "resolved"];
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

function normalizeTicketTypeLabel(typeKey: string, label: string): string {
  if (typeKey === "ordercreation") return "Orders";
  return label;
}

export default function TicketsPage() {
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState<"all" | TicketStatus>("all");
  const [ticketIdQuery, setTicketIdQuery] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const searchParams = useSearchParams();

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

  const groupedTickets = useMemo(() => {
    const ticketsByType = new Map<string, NonNullable<typeof ticketsQuery.data>>();
    for (const ticket of ticketsQuery.data ?? []) {
      const key = ticket.ticketTypeKey || "untyped";
      const current = ticketsByType.get(key) ?? [];
      current.push(ticket);
      ticketsByType.set(key, current);
    }

    const groups: Array<{
      typeKey: string;
      label: string;
      enabled: boolean;
      rows: NonNullable<typeof ticketsQuery.data>;
    }> = [];

    for (const type of ticketTypesQuery.data ?? []) {
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
  }, [ticketTypesQuery.data, ticketsQuery.data]);

  const normalizedGroups = useMemo(() => groupedTickets.sort((a, b) => a.label.localeCompare(b.label)), [groupedTickets]);

  const queryTypeKey = (searchParams?.get("type") || "").toLowerCase();
  const effectiveTypeKey = useMemo(() => {
    if (!normalizedGroups.length) return null;
    if (queryTypeKey && normalizedGroups.some((g) => g.typeKey === queryTypeKey)) return queryTypeKey;
    return normalizedGroups[0]?.typeKey ?? null;
  }, [normalizedGroups, queryTypeKey]);

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
  useEffect(() => {
    setPage(0);
  }, [ticketIdQuery, statusFilter, effectiveTypeKey]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = useMemo(
    () => filteredRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [filteredRows, safePage],
  );

  return (
    <PortalDataTable
      search={{
        value: ticketIdQuery,
        onChange: setTicketIdQuery,
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
          onChange={(e) => setStatusFilter(e.target.value as "all" | TicketStatus)}
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

      {!normalizedGroups.length ? (
        <div className="empty-state" style={{ flex: 1 }}>
          <div className="empty-state-title">No tickets found</div>
        </div>
      ) : activeGroup ? (
        <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          <table className="table table-clickable portal-modern-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Ticket</th>
                <th style={{ textAlign: "left" }}>Created</th>
                <th style={{ textAlign: "left" }}>Customer</th>
                <th style={{ textAlign: "left" }}>Summary</th>
                <th style={{ textAlign: "right", width: 152 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((ticket) => (
                <tr key={ticket.id}>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>#{shortId(ticket.id)}</td>
                  <td>{formatDate(ticket.createdAt)}</td>
                  <td>{ticket.customerName || ticket.customerPhone || "-"}</td>
                  <td style={{ maxWidth: 520 }}>{ticket.summary || ticket.title || "-"}</td>
                  <td style={{ textAlign: "right" }}>
                    <TableSelect
                      style={{ width: 116 }}
                      value={(ticket.status === "closed" ? "resolved" : ticket.status) as TicketStatus}
                      disabled={updatingId === ticket.id}
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
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: "var(--muted)", textAlign: "center", padding: "20px 10px" }}>
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
    </PortalDataTable>
  );
}
