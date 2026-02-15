"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/utils/trpc";
import { usePhoneFilter } from "@/components/PhoneFilterContext";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { TableSelect } from "@/app/portal/components/TableToolbarControls";
import { PortalDataTable } from "@/app/portal/components/PortalDataTable";
import { TablePagination } from "@/app/portal/components/TablePagination";
import { useRouter } from "next/navigation";

type RequestSortKey = "customer" | "status" | "type" | "sentiment" | "created" | "bot";
const PAGE_SIZE = 20;

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
  const [openMenuRequestId, setOpenMenuRequestId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const utils = trpc.useUtils();

  const listInput = useMemo(
    () => ({ limit: 200, ...(selectedPhoneNumberId ? { whatsappIdentityId: selectedPhoneNumberId } : {}) }),
    [selectedPhoneNumberId],
  );

  useLivePortalEvents({ requestListInput: listInput });
  const listQ = trpc.requests.list.useQuery(listInput);
  const togglePause = trpc.customers.setBotPaused.useMutation({
    onMutate: async (vars) => {
      setPendingIds((prev) => ({ ...prev, [vars.customerId]: true }));
      await Promise.all([
        utils.requests.list.cancel(listInput),
        utils.customers.list.cancel(),
      ]);
      const prevRows = utils.requests.list.getData(listInput);
      utils.requests.list.setData(listInput, (old) =>
        old?.map((row) =>
          row.customerId === vars.customerId ? { ...row, botPaused: vars.botPaused } : row,
        ),
      );
      return { prevRows };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prevRows) utils.requests.list.setData(listInput, ctx.prevRows);
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
      utils.requests.list.invalidate(listInput);
      utils.customers.list.invalidate();
    },
  });

  const rows = useMemo(() => normalizeRequests(listQ.data || []), [listQ.data]);
  const statusOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => (r.status || "ongoing").toLowerCase()))).sort(),
    [rows],
  );

  const filtered = useMemo(
    () =>
      statusFilter === "all"
        ? rows
        : rows.filter((r) => (r.status || "ongoing").toLowerCase() === statusFilter.toLowerCase()),
    [rows, statusFilter],
  );
  const searched = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter((r) =>
      r.id.toLowerCase().includes(q) ||
      r.customerNumber.toLowerCase().includes(q) ||
      (r.status || "").toLowerCase().includes(q) ||
      (r.type || "").toLowerCase().includes(q) ||
      (r.sentiment || "").toLowerCase().includes(q) ||
      (r.source || "").toLowerCase().includes(q),
    );
  }, [filtered, searchQuery]);

  const sorted = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;
    return [...searched].sort((a, b) => {
      if (sortKey === "customer") return a.customerNumber.localeCompare(b.customerNumber) * direction;
      if (sortKey === "status") return (a.status || "").localeCompare(b.status || "") * direction;
      if (sortKey === "type") return (a.type || "").localeCompare(b.type || "") * direction;
      if (sortKey === "sentiment") return (a.sentiment || "").localeCompare(b.sentiment || "") * direction;
      if (sortKey === "created") return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * direction;
      if (sortKey === "bot") return ((a.botPaused ? 1 : 0) - (b.botPaused ? 1 : 0)) * direction;
      return 0;
    });
  }, [searched, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = useMemo(() => sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE), [sorted, safePage]);
  const selectedRequest = useMemo(() => {
    if (!selectedId) return null;
    return rows.find((r) => r.id === selectedId) ?? null;
  }, [rows, selectedId]);
  const openMenuRequest = useMemo(() => {
    if (!openMenuRequestId) return null;
    return rows.find((r) => r.id === openMenuRequestId) ?? null;
  }, [rows, openMenuRequestId]);

  const getThreadHref = (row: RequestRow) => {
    const params = new URLSearchParams();
    if (row.customerId) params.set("customerId", row.customerId);
    else if (row.customerNumber) params.set("phone", row.customerNumber.replace(/[^\d]/g, ""));
    const query = params.toString();
    return query ? `/portal/messages?${query}` : "/portal/messages";
  };

  useEffect(() => {
    if (!openMenuRequestId) return;
    const onMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuRequestId(null);
        setMenuAnchor(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenuRequestId(null);
        setMenuAnchor(null);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenuRequestId]);

  return (
    <PortalDataTable
      search={{
        value: searchQuery,
        onChange: setSearchQuery,
        placeholder: "Search requests...",
        style: { width: "min(520px, 52vw)", minWidth: 220, flex: "0 1 520px" },
      }}
      countText={`${sorted.length} request${sorted.length !== 1 ? "s" : ""}`}
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
          totalCount={sorted.length}
          canPrev={safePage > 0}
          canNext={safePage < totalPages - 1}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
        />
      )}
    >
      <table className="table table-clickable portal-modern-table">
        <thead>
          <tr>
            <th
              style={{ cursor: "pointer", userSelect: "none" }}
              onClick={() => {
                if (sortKey === "customer") setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                else {
                  setSortKey("customer");
                  setSortDir("asc");
                }
              }}
            >
              Customer
            </th>
            <th
              style={{ cursor: "pointer", userSelect: "none" }}
              onClick={() => {
                if (sortKey === "sentiment") setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                else {
                  setSortKey("sentiment");
                  setSortDir("asc");
                }
              }}
            >
              Sentiment
            </th>
            <th
              style={{ cursor: "pointer", userSelect: "none" }}
              onClick={() => {
                if (sortKey === "status") setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                else {
                  setSortKey("status");
                  setSortDir("asc");
                }
              }}
            >
              Status
            </th>
            <th
              style={{ cursor: "pointer", userSelect: "none" }}
              onClick={() => {
                if (sortKey === "type") setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                else {
                  setSortKey("type");
                  setSortDir("asc");
                }
              }}
            >
              Type
            </th>
            <th>Paid</th>
            <th
              style={{ cursor: "pointer", userSelect: "none" }}
              onClick={() => {
                if (sortKey === "bot") setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                else {
                  setSortKey("bot");
                  setSortDir("asc");
                }
              }}
            >
              Bot
            </th>
            <th
              style={{ cursor: "pointer", userSelect: "none" }}
              onClick={() => {
                if (sortKey === "created") setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                else {
                  setSortKey("created");
                  setSortDir("desc");
                }
              }}
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
                <td>
                  <div style={{ fontWeight: 500 }}>{r.customerNumber}</div>
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    {(r.source || "whatsapp").toUpperCase()} • #{r.id.slice(0, 8)}
                  </div>
                </td>
                <td>
                  <span className={`badge badge-${r.sentiment === "positive" ? "success" : r.sentiment === "negative" ? "error" : "default"}`}>
                    {(r.sentiment || "neutral").toUpperCase()}
                  </span>
                </td>
                <td>
                  <span className="badge badge-default">{(r.status || "ongoing").replace(/_/g, " ").toUpperCase()}</span>
                </td>
                <td>
                  <span className="badge badge-default">{(r.type || "browsing").replace(/_/g, " ").toUpperCase()}</span>
                </td>
                <td>{r.paid ? "Yes" : "No"}</td>
                <td>
                  {(() => {
                    if (!r.customerId) return <span className="text-muted" style={{ fontSize: 12 }}>-</span>;
                    const createdAt = new Date(r.createdAt);
                    const today = new Date();
                    const isToday =
                      createdAt.getDate() === today.getDate() &&
                      createdAt.getMonth() === today.getMonth() &&
                      createdAt.getFullYear() === today.getFullYear();
                    const status = String(r.status || "").toLowerCase();
                    const isCompleted = status === "completed" || status === "resolved";
                    const canToggle = isToday && !isCompleted;
                    const isPending = Boolean(pendingIds[r.customerId]);

                    return (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={!canToggle || isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!canToggle || isPending) return;
                          togglePause.mutate({ customerId: r.customerId!, botPaused: !Boolean(r.botPaused) });
                        }}
                        title={
                          !isToday
                            ? "Only today's conversation can be paused"
                            : isCompleted
                            ? "Completed conversations cannot be paused"
                            : r.botPaused
                            ? "Resume bot"
                            : "Pause bot"
                        }
                        style={{ width: 104, justifyContent: "center", opacity: !canToggle || isPending ? 0.5 : 1 }}
                      >
                        {r.botPaused ? "Resume" : "Pause"}
                      </button>
                    );
                  })()}
                </td>
                <td className="text-muted" style={{ fontSize: 12 }}>
                  {new Date(r.createdAt).toLocaleDateString()}
                </td>
                <td
                  style={{ textAlign: "center" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    aria-label="Row actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                      const nextTop = rect.bottom + 8;
                      const nextLeft = Math.max(12, rect.right - 168);
                      setMenuAnchor({ top: nextTop, left: nextLeft });
                      setOpenMenuRequestId((prev) => (prev === r.id ? null : r.id));
                    }}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      border: "1px solid rgba(212,168,75,0.45)",
                      background: "linear-gradient(135deg, rgba(0,51,160,0.28), rgba(212,168,75,0.16))",
                      color: "#f8e7be",
                      display: "grid",
                      placeItems: "center",
                      cursor: "pointer",
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <circle cx="12" cy="5" r="1.8" />
                      <circle cx="12" cy="12" r="1.8" />
                      <circle cx="12" cy="19" r="1.8" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {openMenuRequest && menuAnchor && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            top: menuAnchor.top,
            left: menuAnchor.left,
            width: 168,
            background: "rgba(8, 10, 16, 0.98)",
            border: "1px solid rgba(212,168,75,0.45)",
            borderRadius: 10,
            boxShadow: "0 20px 38px rgba(0,0,0,0.45)",
            overflow: "hidden",
            zIndex: 3000,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              const href = getThreadHref(openMenuRequest);
              setOpenMenuRequestId(null);
              setMenuAnchor(null);
              router.push(href);
            }}
            style={{
              width: "100%",
              textAlign: "left",
              display: "block",
              padding: "10px 12px",
              fontSize: 14,
              color: "#e8edf9",
              borderBottom: "1px solid rgba(212,168,75,0.2)",
              background: "linear-gradient(135deg, rgba(0,51,160,0.16), rgba(212,168,75,0.08))",
              border: 0,
              cursor: "pointer",
            }}
          >
            Open Thread
          </button>
          {openMenuRequest.customerId ? (
            <button
              type="button"
              onClick={() => {
                const href = `/portal/customers?customerId=${encodeURIComponent(openMenuRequest.customerId!)}`;
                setOpenMenuRequestId(null);
                setMenuAnchor(null);
                router.push(href);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                display: "block",
                padding: "10px 12px",
                fontSize: 14,
                color: "#e8edf9",
                background: "transparent",
                border: 0,
                cursor: "pointer",
              }}
            >
              Customer Details
            </button>
          ) : (
            <button
              type="button"
              disabled
              style={{
                width: "100%",
                textAlign: "left",
                display: "block",
                padding: "10px 12px",
                fontSize: 14,
                color: "rgba(232,237,249,0.45)",
                background: "transparent",
                border: 0,
              }}
            >
              Customer Details
            </button>
          )}
        </div>
      )}
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
    return query ? `/portal/messages?${query}` : "/portal/messages";
  })();
  const customerHref = request.customerId
    ? `/portal/customers?customerId=${encodeURIComponent(request.customerId)}`
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
                  Open Customer Details
                </button>
              ) : (
                <button type="button" className="btn btn-ghost" disabled>
                  Open Customer Details
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
