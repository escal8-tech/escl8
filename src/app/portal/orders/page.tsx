"use client";

import { useMemo, useState } from "react";
import { PortalDataTable } from "@/app/portal/components/PortalDataTable";
import { RowActionsMenu } from "@/app/portal/components/RowActionsMenu";
import { TablePagination } from "@/app/portal/components/TablePagination";
import { TableSelect } from "@/app/portal/components/TableToolbarControls";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { trpc } from "@/utils/trpc";

type OrderPaymentRow = {
  id: string;
  status: string;
  currency?: string | null;
  expectedAmount?: string | number | null;
  paidAmount?: string | number | null;
  referenceCode?: string | null;
  proofUrl?: string | null;
  aiCheckStatus?: string | null;
  aiCheckNotes?: string | null;
  createdAt?: Date | string | null;
};

type OrderRow = {
  id: string;
  status: string;
  currency?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  expectedAmount?: string | number | null;
  paidAmount?: string | number | null;
  ticketSnapshot?: Record<string, unknown> | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  latestPayment?: OrderPaymentRow | null;
};

type OrderEventRow = {
  id: string;
  eventType: string;
  actorType: string;
  actorLabel?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt?: Date | string | null;
};

const PAGE_SIZE = 20;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMoney(currency: string | null | undefined, value: string | number | null | undefined): string {
  if (value == null || value === "") return "-";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${currency || ""} ${value}`.trim();
  return `${currency || "LKR"} ${amount.toFixed(2)}`;
}

function formatOrderItems(snapshot: Record<string, unknown>): string {
  const fields = asRecord(snapshot.fields);
  const pricedLineItems = Array.isArray(fields.priced_line_items) ? fields.priced_line_items : [];
  const lineItems = Array.isArray(fields.line_items) ? fields.line_items : [];
  const source = pricedLineItems.length ? pricedLineItems : lineItems;
  const rows = source
    .map((entry) => {
      const row = asRecord(entry);
      const item = String(row.item ?? "").trim();
      const quantity = String(row.quantity ?? "").trim();
      if (!item) return "";
      return quantity ? `${item} x ${quantity}` : item;
    })
    .filter(Boolean);
  if (rows.length) return rows.join(", ");

  const items = Array.isArray(fields.items) ? fields.items : [];
  const quantities = Array.isArray(fields.quantity) ? fields.quantity : [];
  if (!items.length) return "No items listed";
  return items
    .map((item, index) => `${String(item ?? "").trim()} x ${String(quantities[index] ?? quantities[0] ?? 1).trim()}`)
    .join(", ");
}

function normalizeStatusLabel(value: string | null | undefined): string {
  return String(value || "-").replace(/_/g, " ");
}

function statusTone(status: string): { color: string; background: string; border: string } {
  const normalized = status.toLowerCase();
  if (normalized === "paid") {
    return {
      color: "#86efac",
      background: "rgba(34, 197, 94, 0.12)",
      border: "1px solid rgba(34, 197, 94, 0.28)",
    };
  }
  if (normalized === "payment_submitted") {
    return {
      color: "#fcd34d",
      background: "rgba(245, 158, 11, 0.12)",
      border: "1px solid rgba(245, 158, 11, 0.28)",
    };
  }
  if (normalized === "payment_rejected" || normalized === "denied") {
    return {
      color: "#fca5a5",
      background: "rgba(239, 68, 68, 0.12)",
      border: "1px solid rgba(239, 68, 68, 0.28)",
    };
  }
  return {
    color: "#cbd5e1",
    background: "rgba(148, 163, 184, 0.12)",
    border: "1px solid rgba(148, 163, 184, 0.24)",
  };
}

export default function OrdersPage() {
  const utils = trpc.useUtils();
  const [selectedOrder, setSelectedOrder] = useState<OrderRow | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const ordersQuery = trpc.orders.listOrders.useQuery(
    statusFilter === "all" ? undefined : { status: statusFilter, limit: 400 },
  );
  const statsQuery = trpc.orders.getStats.useQuery();
  const reviewPayment = trpc.orders.reviewPayment.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.listOrders.invalidate(),
        utils.orders.getStats.invalidate(),
      ]);
    },
  });

  useLivePortalEvents({
    onEvent: async (event) => {
      if (event.entity !== "order") return;
      await Promise.all([
        utils.orders.listOrders.invalidate(),
        utils.orders.getStats.invalidate(),
      ]);
    },
  });

  const orders = useMemo(() => (ordersQuery.data?.items ?? []) as OrderRow[], [ordersQuery.data?.items]);
  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((order) => {
      const id = order.id.toLowerCase();
      const ref = String(order.paymentReference || "").toLowerCase();
      const customer = String(order.customerName || order.customerPhone || "").toLowerCase();
      return id.includes(needle) || ref.includes(needle) || customer.includes(needle);
    });
  }, [orders, search]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filteredOrders.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const handleReview = async (paymentId: string, action: "approve" | "reject") => {
    await reviewPayment.mutateAsync({ paymentId, action });
  };

  if (ordersQuery.data && !ordersQuery.data.settings.ticketToOrderEnabled) {
    return (
      <div className="card" style={{ margin: 24 }}>
        <div className="card-body" style={{ padding: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Order flow is disabled</div>
          <div className="text-muted">
            Enable Ticket To Order in General settings to track approved orders and payment proof review here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <PortalDataTable
      search={{
        value: search,
        onChange: (value) => {
          setSearch(value);
          setPage(0);
        },
        placeholder: "Search orders, refs, or customers...",
        style: { width: "min(520px, 52vw)", minWidth: 220, flex: "0 1 520px" },
      }}
      countText={`${filteredOrders.length} order${filteredOrders.length !== 1 ? "s" : ""}`}
      endControls={(
        <>
          <label htmlFor="order-status-filter" style={{ color: "var(--muted)", fontSize: 12 }}>
            Status
          </label>
          <TableSelect
            id="order-status-filter"
            style={{ width: 180 }}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">All</option>
            <option value="approved">Approved</option>
            <option value="awaiting_payment">Awaiting Payment</option>
            <option value="payment_submitted">Payment Submitted</option>
            <option value="payment_rejected">Payment Rejected</option>
            <option value="paid">Paid</option>
            <option value="denied">Denied</option>
          </TableSelect>
        </>
      )}
      footer={(
        <TablePagination
          page={safePage}
          totalPages={totalPages}
          shownCount={pageRows.length}
          totalCount={filteredOrders.length}
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
        <SummaryCard label="Total Orders" value={String(statsQuery.data?.totalOrders ?? 0)} />
        <SummaryCard label="Awaiting Payment" value={String(statsQuery.data?.pendingPaymentCount ?? 0)} />
        <SummaryCard label="Payment Review" value={String(statsQuery.data?.paymentSubmittedCount ?? 0)} />
        <SummaryCard
          label="Approved Revenue"
          value={formatMoney(ordersQuery.data?.settings.currency, statsQuery.data?.approvedAmount ?? 0)}
        />
      </div>

      <div style={{ overflowX: "hidden", overflowY: "auto", flex: 1, minHeight: 0 }}>
        <table className="table table-clickable portal-modern-table" style={{ width: "100%", tableLayout: "fixed" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", width: "14%" }}>Order</th>
              <th style={{ textAlign: "left", width: "18%" }}>Customer</th>
              <th style={{ textAlign: "left", width: "24%" }}>Items</th>
              <th style={{ textAlign: "left", width: "11%" }}>Amount</th>
              <th style={{ textAlign: "left", width: "13%" }}>Payment</th>
              <th style={{ textAlign: "left", width: "12%" }}>Status</th>
              <th style={{ textAlign: "left", width: "5%" }}>Updated</th>
              <th style={{ textAlign: "center", width: "3%" }} />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((order) => {
              const snapshot = asRecord(order.ticketSnapshot);
              const latestPayment = order.latestPayment ?? null;
              return (
                <tr key={order.id} onClick={() => setSelectedOrder(order)} style={{ cursor: "pointer" }}>
                  <td>
                    <div style={{ display: "grid", gap: 3 }}>
                      <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700 }}>#{shortId(order.id)}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{order.paymentReference || "-"}</div>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "grid", gap: 3 }}>
                      <div>{order.customerName || order.customerPhone || "-"}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{order.customerPhone || "No phone"}</div>
                    </div>
                  </td>
                  <td>
                    <span style={{ display: "block", whiteSpace: "normal", wordBreak: "break-word", fontSize: 13 }}>
                      {formatOrderItems(snapshot)}
                    </span>
                  </td>
                  <td>{formatMoney(order.currency, order.paidAmount ?? order.expectedAmount)}</td>
                  <td>
                    <div style={{ display: "grid", gap: 3 }}>
                      <div>{normalizeStatusLabel(order.paymentMethod)}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>
                        {latestPayment?.aiCheckStatus ? `AI: ${normalizeStatusLabel(latestPayment.aiCheckStatus)}` : "No proof yet"}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span
                      style={{
                        ...statusTone(order.status),
                        padding: "4px 10px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        display: "inline-flex",
                      }}
                    >
                      {normalizeStatusLabel(order.status)}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>{formatDate(order.updatedAt)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <RowActionsMenu
                      items={[
                        {
                          label: "Open Details",
                          onSelect: () => setSelectedOrder(order),
                        },
                        {
                          label: "Approve Payment",
                          disabled: !latestPayment || latestPayment.status !== "submitted",
                          onSelect: () => latestPayment && void handleReview(latestPayment.id, "approve"),
                        },
                        {
                          label: "Reject Payment",
                          disabled: !latestPayment || latestPayment.status !== "submitted",
                          onSelect: () => latestPayment && void handleReview(latestPayment.id, "reject"),
                        },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", padding: "24px 10px", color: "var(--muted)" }}>
                  No orders found for this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <OrderDetailsDrawer
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onReviewPayment={handleReview}
        reviewPending={reviewPayment.isPending}
      />
    </PortalDataTable>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="card-body" style={{ padding: "10px 12px" }}>
        <div className="text-muted" style={{ fontSize: 11 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
      </div>
    </div>
  );
}

function OrderDetailsDrawer({
  order,
  onClose,
  onReviewPayment,
  reviewPending,
}: {
  order: OrderRow | null;
  onClose: () => void;
  onReviewPayment: (paymentId: string, action: "approve" | "reject") => Promise<void>;
  reviewPending: boolean;
}) {
  const paymentsQuery = trpc.orders.getOrderPayments.useQuery(
    { orderId: order?.id ?? "" },
    { enabled: Boolean(order?.id) },
  );
  const eventsQuery = trpc.orders.getOrderEvents.useQuery(
    { orderId: order?.id ?? "" },
    { enabled: Boolean(order?.id) },
  );

  if (!order) return null;
  const snapshot = asRecord(order.ticketSnapshot);
  const payments = (paymentsQuery.data ?? []) as OrderPaymentRow[];
  const latestPayment = payments[0] ?? order.latestPayment ?? null;

  return (
    <>
      <div className="drawer-backdrop open" onClick={onClose} />
      <div className="drawer open">
        <div className="drawer-header">
          <h3 className="drawer-title">Order Details</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close details">
            x
          </button>
        </div>
        <div className="drawer-body">
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 12 }}>
                <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--muted)" }}>
                  #{shortId(order.id)} ({order.id})
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <Detail label="Customer" value={order.customerName || order.customerPhone || "-"} />
                  <Detail label="Phone" value={order.customerPhone || "-"} />
                  <Detail label="Status" value={normalizeStatusLabel(order.status)} />
                  <Detail label="Payment Method" value={normalizeStatusLabel(order.paymentMethod)} />
                  <Detail label="Expected" value={formatMoney(order.currency, order.expectedAmount)} />
                  <Detail label="Paid" value={formatMoney(order.currency, order.paidAmount)} />
                  <Detail label="Reference" value={order.paymentReference || "-"} />
                  <Detail label="Updated" value={formatDate(order.updatedAt)} />
                </div>
                <div>
                  <div className="text-muted" style={{ fontSize: 12 }}>Items</div>
                  <div>{formatOrderItems(snapshot)}</div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Latest Payment</div>
                {!latestPayment ? (
                  <div className="text-muted" style={{ fontSize: 13 }}>No payment proof submitted yet.</div>
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                      <Detail label="Status" value={normalizeStatusLabel(latestPayment.status)} />
                      <Detail label="AI Check" value={normalizeStatusLabel(latestPayment.aiCheckStatus)} />
                      <Detail label="Expected" value={formatMoney(latestPayment.currency, latestPayment.expectedAmount)} />
                      <Detail label="Paid" value={formatMoney(latestPayment.currency, latestPayment.paidAmount)} />
                    </div>
                    <div>
                      <div className="text-muted" style={{ fontSize: 12 }}>AI Notes</div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{latestPayment.aiCheckNotes || "-"}</div>
                    </div>
                    {latestPayment.proofUrl ? (
                      <a
                        href={latestPayment.proofUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-ghost"
                        style={{ width: "fit-content" }}
                      >
                        Open Proof
                      </a>
                    ) : null}
                    {latestPayment.status === "submitted" ? (
                      <div style={{ display: "flex", gap: 10 }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={reviewPending}
                          onClick={() => void onReviewPayment(latestPayment.id, "approve")}
                        >
                          Approve Payment
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={reviewPending}
                          onClick={() => void onReviewPayment(latestPayment.id, "reject")}
                        >
                          Reject Payment
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Payment Attempts</div>
                {!payments.length ? (
                  <div className="text-muted" style={{ fontSize: 13 }}>No payment attempts recorded.</div>
                ) : (
                  payments.map((payment) => (
                    <div
                      key={payment.id}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: "10px 12px",
                        display: "grid",
                        gap: 4,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ fontWeight: 600 }}>{normalizeStatusLabel(payment.status)}</span>
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>{formatDate(payment.createdAt)}</span>
                      </div>
                      <div>{formatMoney(payment.currency, payment.paidAmount ?? payment.expectedAmount)}</div>
                      {payment.aiCheckNotes ? (
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>{payment.aiCheckNotes}</div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Timeline</div>
                {!eventsQuery.data?.length ? (
                  <div className="text-muted" style={{ fontSize: 13 }}>No order events yet.</div>
                ) : (
                  ((eventsQuery.data ?? []) as OrderEventRow[]).map((event) => (
                    <div
                      key={event.id}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: "10px 12px",
                        display: "grid",
                        gap: 4,
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{normalizeStatusLabel(event.eventType)}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>
                        {formatDate(event.createdAt)} by {event.actorLabel || event.actorType || "system"}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted" style={{ fontSize: 12 }}>{label}</div>
      <div>{value}</div>
    </div>
  );
}
