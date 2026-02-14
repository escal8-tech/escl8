"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/utils/trpc";
import { usePhoneFilter } from "@/components/PhoneFilterContext";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { TableSelect } from "@/app/portal/components/TableToolbarControls";
import { PortalDataTable } from "@/app/portal/components/PortalDataTable";
import { TablePagination } from "@/app/portal/components/TablePagination";

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
  }));
}

export default function RequestsPage() {
  const { selectedPhoneNumberId } = usePhoneFilter();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<RequestSortKey>("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
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
          </tr>
        </thead>
        <tbody>
          {pageRows.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-muted" style={{ padding: 18, textAlign: "center" }}>
                No requests found.
              </td>
            </tr>
          ) : (
            pageRows.map((r) => (
              <tr key={r.id}>
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
                  {r.customerId ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={Boolean(pendingIds[r.customerId])}
                      onClick={() => togglePause.mutate({ customerId: r.customerId!, botPaused: !Boolean(r.botPaused) })}
                      style={{ width: 104, justifyContent: "center", opacity: pendingIds[r.customerId] ? 0.6 : 1 }}
                    >
                      {r.botPaused ? "Resume" : "Pause"}
                    </button>
                  ) : (
                    <span className="text-muted" style={{ fontSize: 12 }}>-</span>
                  )}
                </td>
                <td className="text-muted" style={{ fontSize: 12 }}>
                  {new Date(r.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </PortalDataTable>
  );
}
