"use client";

import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/utils/trpc";
import { usePhoneFilter } from "@/components/PhoneFilterContext";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { TableSelect } from "@/app/portal/components/TableToolbarControls";
import { PortalDataTable } from "@/app/portal/components/PortalDataTable";
import { TablePagination } from "@/app/portal/components/TablePagination";
import { PortalBotToggleButton } from "@/app/portal/components/PortalBotToggleButton";
import { useRouter } from "next/navigation";
import { RowActionsMenu } from "@/app/portal/components/RowActionsMenu";

type RequestSortKey = "customer" | "status" | "type" | "sentiment" | "created" | "bot";
const PAGE_SIZE = 20;
const REQUEST_STATUS_OPTIONS = [
  "ongoing",
  "completed",
  "failed",
  "assistance_required",
  "resolved",
  "pending",
  "escalated",
  "in_progress",
  "needs_followup",
] as const;

type RequestRow = {
  id: string;
  customerId?: string | null;
  customerNumber: string;
  sentiment: string | null;
  status?: string | null;
  type?: string | null;
  source?: string | null;
  paid: boolean;
  botPaused?: boolean;
  createdAt: string;
  updatedAt?: string | null;
  summary?: unknown;
  text?: string | null;
  price?: number | null;
  needsFollowup?: boolean;
  paymentDetails?: string | null;
};

function normalizeRequests(requests: Record<string, unknown>[]): RequestRow[] {
  return requests.map((r) => ({
    id: String(r.id ?? ""),
    customerId: typeof r.customerId === "string" ? r.customerId : null,
    customerNumber: String(r.customerNumber ?? "Unknown"),
    sentiment: r.sentiment ? String(r.sentiment) : null,
    status: r.status ? String(r.status) : "ongoing",
    type: r.type ? String(r.type) : "browsing",
    source: r.source ? String(r.source) : "whatsapp",
    paid: Boolean(r.paid),
    botPaused: Boolean(r.botPaused),
    createdAt: r.createdAt instanceof Date ? (r.createdAt as Date).toISOString() : String(r.createdAt || new Date().toISOString()),
    updatedAt:
      r.updatedAt instanceof Date
        ? (r.updatedAt as Date).toISOString()
        : r.updatedAt
        ? String(r.updatedAt)
        : null,
    summary: r.summary,
    text: typeof r.text === "string" ? r.text : null,
    price: r.price == null ? null : Number(r.price),
    needsFollowup: Boolean(r.needsFollowup),
    paymentDetails: typeof r.paymentDetails === "string" ? r.paymentDetails : null,
  }));
}

export default function RequestsPage() {
  const router = useRouter();
  const { selectedPhoneNumberId } = usePhoneFilter();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<RequestSortKey>("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const pageInput = useMemo(
    () => ({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      search: searchQuery.trim() || undefined,
      status: statusFilter !== "all" ? statusFilter : undefined,
      sortKey,
      sortDir,
      ...(selectedPhoneNumberId ? { whatsappIdentityId: selectedPhoneNumberId } : {}),
    }),
    [page, searchQuery, selectedPhoneNumberId, sortDir, sortKey, statusFilter],
  );

  useLivePortalEvents({ requestPageInput: pageInput });
  const pageQ = trpc.requests.listPage.useQuery(pageInput);
  const togglePause = trpc.customers.setBotPaused.useMutation({
    onMutate: async (vars) => {
      setPendingIds((prev) => ({ ...prev, [vars.customerId]: true }));
      await Promise.all([
        utils.requests.listPage.cancel(pageInput),
        utils.customers.list.cancel(),
        utils.customers.listPage.cancel(),
      ]);
      const prevRows = utils.requests.listPage.getData(pageInput);
      utils.requests.listPage.setData(pageInput, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((row) =>
            row.customerId === vars.customerId ? { ...row, botPaused: vars.botPaused } : row,
          ),
        };
      });
      return { prevRows };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prevRows) utils.requests.listPage.setData(pageInput, ctx.prevRows);
      setPendingIds((prev) => {
        const next = { ...prev };
        delete next[vars.customerId];
        return next;
      });
    },
    onSettled: (_data, _err, vars) => {
      if (vars?.customerId) {
        setPendingIds((prev) => {
          const next = { ...prev };
          delete next[vars.customerId];
          return next;
        });
      }
      utils.requests.listPage.invalidate(pageInput);
      utils.customers.list.invalidate();
      utils.customers.listPage.invalidate();
    },
  });

  const rows = useMemo(
    () => normalizeRequests((pageQ.data?.items ?? []) as Record<string, unknown>[]),
    [pageQ.data?.items],
  );
  const totalCount = pageQ.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = rows;
  const statusOptions = useMemo(() => {
    const values = new Set<string>(REQUEST_STATUS_OPTIONS);
    if (statusFilter !== "all") values.add(statusFilter);
    return Array.from(values);
  }, [statusFilter]);
  useEffect(() => {
    if (safePage !== page) {
      queueMicrotask(() => setPage(safePage));
    }
  }, [page, safePage]);
  const selectedRequest = useMemo(() => {
    if (!selectedId) return null;
    return rows.find((r) => r.id === selectedId) ?? null;
  }, [rows, selectedId]);
  const toggleSort = (key: RequestSortKey, initialDir: "asc" | "desc" = "asc") => {
    setPage(0);
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(initialDir);
  };
  const getThreadHref = (row: RequestRow) => {
    const params = new URLSearchParams();
    if (row.customerId) params.set("customerId", row.customerId);
    else if (row.customerNumber) params.set("phone", row.customerNumber.replace(/[^\d]/g, ""));
    const query = params.toString();
    return query ? `/messages?${query}` : "/messages";
  };

  return (
    <PortalDataTable
      search={{
        value: searchQuery,
        onChange: (value) => {
          setSearchQuery(value);
          setPage(0);
        },
        placeholder: "Search requests...",
        style: { width: "min(520px, 52vw)", minWidth: 220, flex: "0 1 520px" },
      }}
      countText={`${totalCount} request${totalCount !== 1 ? "s" : ""}`}
      endControls={(
        <TableSelect
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
          }}
          style={{ width: 132 }}
        >
          <option value="all">All statuses</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status.replace(/_/g, " ").toUpperCase()}
            </option>
          ))}
        </TableSelect>
      )}
      footer={(
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
      )}
    >
      <table className="table table-clickable portal-modern-table portal-mobile-cards">
        <thead>
          <tr>
            <th
              style={{ cursor: "pointer", userSelect: "none" }}
              onClick={() => toggleSort("customer")}
            >
              Customer
            </th>
            <th
              style={{ cursor: "pointer", userSelect: "none", textAlign: "center", width: 72 }}
              onClick={() => toggleSort("bot")}
            >
              Bot
            </th>
            <th
              style={{ cursor: "pointer", userSelect: "none" }}
              onClick={() => toggleSort("sentiment")}
            >
              Sentiment
            </th>
            <th
              style={{ cursor: "pointer", userSelect: "none" }}
              onClick={() => toggleSort("status")}
            >
              Status
            </th>
            <th
              style={{ cursor: "pointer", userSelect: "none" }}
              onClick={() => toggleSort("type")}
            >
              Type
            </th>
            <th>Paid</th>
            <th
              style={{ cursor: "pointer", userSelect: "none" }}
              onClick={() => toggleSort("created", "desc")}
            >
              Created
            </th>
            <th style={{ width: 56 }} />
          </tr>
        </thead>
        <tbody>
          {pageRows.length === 0 ? (
            <tr>
              <td colSpan={8} className="text-muted" style={{ padding: 18, textAlign: "center" }}>
                No requests found.
              </td>
            </tr>
          ) : (
            pageRows.map((r) => (
              <tr key={r.id} onClick={() => setSelectedId(r.id)} style={{ cursor: "pointer" }}>
                <td data-label="Customer">
                  <div style={{ fontWeight: 500 }}>{r.customerNumber}</div>
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    {(r.source || "whatsapp").toUpperCase()} - #{r.id.slice(0, 8)}
                  </div>
                </td>
                <td data-label="Bot" style={{ textAlign: "center" }}>
                  {(() => {
                    const createdAt = new Date(r.createdAt);
                    const today = new Date();
                    const isToday =
                      createdAt.getDate() === today.getDate() &&
                      createdAt.getMonth() === today.getMonth() &&
                      createdAt.getFullYear() === today.getFullYear();
                    const status = String(r.status || "").toLowerCase();
                    const isCompleted = status === "completed" || status === "resolved";
                    const canToggle = Boolean(r.customerId) && isToday && !isCompleted;
                    const isPending = r.customerId ? Boolean(pendingIds[r.customerId]) : false;
                    const title = !r.customerId
                      ? "No customer linked"
                      : !isToday
                      ? "Only today's conversation can be paused"
                      : isCompleted
                      ? "Completed conversations cannot be paused"
                      : r.botPaused
                      ? "Resume bot"
                      : "Pause bot";

                    return (
                      <PortalBotToggleButton
                        available={Boolean(r.customerId)}
                        paused={Boolean(r.botPaused)}
                        pending={isPending}
                        disabled={!canToggle}
                        title={title}
                        onToggle={() => {
                          if (!r.customerId) return;
                          togglePause.mutate({ customerId: r.customerId, botPaused: !Boolean(r.botPaused) });
                        }}
                      />
                    );
                  })()}
                </td>
                <td data-label="Sentiment">
                  <span className={`badge badge-${r.sentiment === "positive" ? "success" : r.sentiment === "negative" ? "error" : "default"}`}>
                    {(r.sentiment || "neutral").toUpperCase()}
                  </span>
                </td>
                <td data-label="Status">
                  <span className="badge badge-default">{(r.status || "ongoing").replace(/_/g, " ").toUpperCase()}</span>
                </td>
                <td data-label="Type">
                  <span className="badge badge-default">{(r.type || "browsing").replace(/_/g, " ").toUpperCase()}</span>
                </td>
                <td data-label="Paid">{r.paid ? "Yes" : "No"}</td>
                <td data-label="Created" className="text-muted" style={{ fontSize: 12 }}>
                  {new Date(r.createdAt).toLocaleDateString()}
                </td>
                <td
                  data-label="Actions"
                  style={{ textAlign: "center" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <RowActionsMenu
                    items={[
                      {
                        label: "Open Thread",
                        onSelect: () => {
                          router.push(getThreadHref(r));
                        },
                      },
                      {
                        label: "Customer Details",
                        disabled: !r.customerId,
                        onSelect: () => {
                          if (!r.customerId) return;
                          router.push(`/customers?customerId=${encodeURIComponent(r.customerId)}`);
                        },
                      },
                    ]}
                  />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <RequestDrawer request={selectedRequest} onClose={() => setSelectedId(null)} />
    </PortalDataTable>
  );
}

function RequestDrawer({
  request,
  onClose,
}: {
  request: RequestRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  if (!request) return null;

  const rawSummary = typeof request.summary === "string" ? request.summary : request.text || "";
  const threadHref = (() => {
    const params = new URLSearchParams();
    if (request.customerId) params.set("customerId", request.customerId);
    else if (request.customerNumber) params.set("phone", request.customerNumber.replace(/[^\d]/g, ""));
    const query = params.toString();
    return query ? `/messages?${query}` : "/messages";
  })();
  const customerHref = request.customerId
    ? `/customers?customerId=${encodeURIComponent(request.customerId)}`
    : null;

  return (
    <>
      <div className="drawer-backdrop open" onClick={onClose} />
      <div className="drawer open">
        <div className="drawer-header">
          <h3 className="drawer-title">Request Details</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close details">
            x
          </button>
        </div>
        <div className="drawer-body">
          <div style={{ display: "grid", gap: "var(--space-6)" }}>
            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: "var(--space-3)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                  <div className="avatar avatar-lg">{request.customerNumber?.slice(-2).toUpperCase() || "?"}</div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{request.customerNumber || "Unknown"}</div>
                    <div className="text-muted">#{request.id.slice(0, 8)}</div>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Status</div>
                    <div>{(request.status || "ongoing").replace(/_/g, " ")}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Type</div>
                    <div>{(request.type || "browsing").replace(/_/g, " ")}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Sentiment</div>
                    <div>{request.sentiment || "neutral"}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Paid</div>
                    <div>{request.paid ? "Yes" : "No"}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Created</div>
                    <div>{new Date(request.createdAt).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Updated</div>
                    <div>{request.updatedAt ? new Date(request.updatedAt).toLocaleString() : "-"}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-body">
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>Summary</div>
                {rawSummary ? (
                  <p style={{ margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{rawSummary}</p>
                ) : (
                  <p className="text-muted" style={{ margin: 0 }}>No summary available.</p>
                )}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
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
                >
                  Customer Details
                </button>
              ) : (
                <button type="button" className="btn btn-ghost" disabled>
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
