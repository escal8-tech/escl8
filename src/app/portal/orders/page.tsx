"use client";

import { useMemo, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";
import { PortalDataTable } from "@/app/portal/components/PortalDataTable";
import { RowActionsMenu } from "@/app/portal/components/RowActionsMenu";
import { TablePagination } from "@/app/portal/components/TablePagination";
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
  refundAmount?: string | number | null;
  refundReason?: string | null;
  refundRequestedAt?: Date | string | null;
  refundedAt?: Date | string | null;
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
const REVENUE_FILTERS = [
  { key: "all", label: "All" },
  { key: "approved", label: "Approved" },
  { key: "payment_pending", label: "Payment Pending" },
  { key: "payment_review", label: "Payment Review" },
  { key: "paid", label: "Paid" },
  { key: "refunds", label: "Refunds" },
  { key: "not_approved", label: "Not Approved" },
] as const;

type RevenueFilterKey = (typeof REVENUE_FILTERS)[number]["key"];

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

function getOrderStatus(order: OrderRow): string {
  return String(order.status || "").toLowerCase();
}

function resolveOrderAmount(order: OrderRow): string | number | null | undefined {
  return order.paidAmount ?? order.refundAmount ?? order.expectedAmount;
}

function describeFinanceState(order: OrderRow, latestPayment?: OrderPaymentRow | null): string {
  const status = String(order.status || "").toLowerCase();
  const method = String(order.paymentMethod || "").toLowerCase();
  if (status === "paid") return "Revenue recognized";
  if (status === "refund_pending") return "Refund pending";
  if (status === "refunded") return "Refunded";
  if (status === "payment_submitted") return "Payment review";
  if (status === "payment_rejected") return "Payment rejected";
  if (status === "awaiting_payment") return "Awaiting payment";
  if (status === "denied") return "No revenue";
  if (method === "manual") return "Manual collection";
  if (method === "cod") return "Cash on delivery";
  if (latestPayment?.aiCheckStatus) return `AI ${normalizeStatusLabel(latestPayment.aiCheckStatus)}`;
  return normalizeStatusLabel(status || method || "pending");
}

function describeFlowState(order: OrderRow): string {
  const status = String(order.status || "").toLowerCase();
  if (status === "awaiting_payment") return "Order approved, waiting for customer transfer";
  if (status === "payment_submitted") return "Slip received, staff review required";
  if (status === "payment_rejected") return "Customer must resend payment proof";
  if (status === "paid") return "Payment approved and transaction closed";
  if (status === "refund_pending") return "Manual bank refund is in progress";
  if (status === "refunded") return "Refund completed and revenue reversed";
  if (status === "denied") return "Order denied or cancelled";
  if (status === "approved") return "Approved and waiting manual fulfillment";
  return normalizeStatusLabel(status);
}

function describeNextAction(order: OrderRow, latestPayment?: OrderPaymentRow | null): string {
  const status = String(order.status || "").toLowerCase();
  if (status === "payment_submitted") return "Approve or reject the payment proof";
  if (status === "awaiting_payment") return "Wait for customer slip in WhatsApp";
  if (status === "payment_rejected") return "Customer must transfer again and resend proof";
  if (status === "paid") return "No action unless a refund is needed";
  if (status === "refund_pending") return "Refund via bank manually, then mark refunded";
  if (status === "refunded") return "Completed";
  if (status === "denied") return "Closed";
  if (String(order.paymentMethod || "").toLowerCase() === "manual") return "Collect and fulfil outside the app";
  if (String(order.paymentMethod || "").toLowerCase() === "cod") return "Collect on delivery";
  if (latestPayment?.status === "submitted") return "Review payment proof";
  return "Monitor order";
}

function formatEventSummary(event: OrderEventRow): string | null {
  const payload = asRecord(event.payload);
  const candidates = [
    payload.notes,
    payload.reason,
    payload.paymentStatus,
    payload.refundAmount,
  ];
  for (const value of candidates) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
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
  if (normalized === "refund_pending") {
    return {
      color: "#fdba74",
      background: "rgba(249, 115, 22, 0.12)",
      border: "1px solid rgba(249, 115, 22, 0.28)",
    };
  }
  if (normalized === "refunded") {
    return {
      color: "#c4b5fd",
      background: "rgba(139, 92, 246, 0.12)",
      border: "1px solid rgba(139, 92, 246, 0.28)",
    };
  }
  return {
    color: "#cbd5e1",
    background: "rgba(148, 163, 184, 0.12)",
    border: "1px solid rgba(148, 163, 184, 0.24)",
  };
}

function matchesRevenueFilter(order: OrderRow, filter: RevenueFilterKey): boolean {
  const status = getOrderStatus(order);
  if (filter === "all") return true;
  if (filter === "approved") return status === "approved";
  if (filter === "payment_pending") return status === "awaiting_payment" || status === "payment_rejected";
  if (filter === "payment_review") return status === "payment_submitted";
  if (filter === "paid") return status === "paid";
  if (filter === "refunds") return status === "refund_pending" || status === "refunded";
  if (filter === "not_approved") return status === "denied";
  return true;
}

export default function OrdersPage() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const [selectedOrder, setSelectedOrder] = useState<OrderRow | null>(null);
  const [activeFilter, setActiveFilter] = useState<RevenueFilterKey>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const ordersQuery = trpc.orders.listOrders.useQuery({ limit: 500 });
  const statsQuery = trpc.orders.getStats.useQuery();
  const reviewPayment = trpc.orders.reviewPayment.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.listOrders.invalidate(),
        utils.orders.getStats.invalidate(),
        utils.orders.getOrderPayments.invalidate(),
        utils.orders.getOrderEvents.invalidate(),
      ]);
    },
  });
  const updateRefundStatus = trpc.orders.updateRefundStatus.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.listOrders.invalidate(),
        utils.orders.getStats.invalidate(),
        utils.orders.getOrderPayments.invalidate(),
        utils.orders.getOrderEvents.invalidate(),
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
  const filterCounts = useMemo<Record<RevenueFilterKey, number>>(() => {
    const counts: Record<RevenueFilterKey, number> = {
      all: orders.length,
      approved: 0,
      payment_pending: 0,
      payment_review: 0,
      paid: 0,
      refunds: 0,
      not_approved: 0,
    };
    for (const order of orders) {
      for (const filter of REVENUE_FILTERS) {
        if (filter.key === "all") continue;
        if (matchesRevenueFilter(order, filter.key)) {
          counts[filter.key] += 1;
        }
      }
    }
    return counts;
  }, [orders]);
  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (!matchesRevenueFilter(order, activeFilter)) return false;
      if (!needle) return true;
      const id = order.id.toLowerCase();
      const ref = String(order.paymentReference || "").toLowerCase();
      const customer = String(order.customerName || order.customerPhone || "").toLowerCase();
      return id.includes(needle) || ref.includes(needle) || customer.includes(needle);
    });
  }, [activeFilter, orders, search]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filteredOrders.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const handleReview = async (paymentId: string, action: "approve" | "reject") => {
    try {
      await reviewPayment.mutateAsync({ paymentId, action });
      showSuccessToast(toast, {
        title: action === "approve" ? "Payment approved" : "Payment rejected",
        message:
          action === "approve"
            ? "The payment proof was approved successfully."
            : "The payment proof was rejected successfully.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Review failed",
        message: error instanceof Error ? error.message : "Payment review failed.",
      });
    }
  };

  const handleRefundAction = async (order: OrderRow, action: "mark_pending" | "mark_refunded" | "cancel") => {
    const amountDefault = String(resolveOrderAmount(order) ?? "").trim();
    const amountPrompt =
      action === "cancel" ? undefined : window.prompt("Refund amount", amountDefault || "");
    if (amountPrompt === null) return;
    const reasonDefault =
      action === "mark_pending"
        ? order.refundReason || "Manual bank refund requested"
        : action === "mark_refunded"
          ? order.refundReason || "Refund completed manually via bank"
          : "";
    const reasonPrompt =
      action === "cancel" ? undefined : window.prompt("Refund reason", reasonDefault || "");
    if (reasonPrompt === null) return;
    try {
      await updateRefundStatus.mutateAsync({
        orderId: order.id,
        action,
        amount: action === "cancel" ? undefined : amountPrompt || amountDefault || undefined,
        reason: action === "cancel" ? undefined : reasonPrompt || reasonDefault || undefined,
      });
      showSuccessToast(toast, {
        title: "Revenue updated",
        message:
          action === "mark_pending"
            ? "Refund was moved into the pending queue."
            : action === "mark_refunded"
              ? "Refund was marked as completed."
              : "Refund state was cleared.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Update failed",
        message: error instanceof Error ? error.message : "Refund update failed.",
      });
    }
  };

  if (ordersQuery.data && !ordersQuery.data.settings.ticketToOrderEnabled) {
    return (
      <div className="card" style={{ margin: 24 }}>
        <div className="card-body" style={{ padding: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Revenue is disabled</div>
          <div className="text-muted">
            Enable Ticket To Order in General settings to track revenue, payment proof review, and manual refunds here.
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
        placeholder: "Search revenue, refs, or customers...",
        style: { width: "min(520px, 52vw)", minWidth: 220, flex: "0 1 520px" },
      }}
      countText={`${filteredOrders.length} transaction${filteredOrders.length !== 1 ? "s" : ""}`}
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
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ padding: "14px 16px", display: "grid", gap: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Revenue</div>
          <div className="text-muted" style={{ fontSize: 13 }}>
            Track approval, payment progress, and recognized revenue in one place.
          </div>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <SummaryCard
          label="Net Revenue"
          value={formatMoney(ordersQuery.data?.settings.currency, statsQuery.data?.approvedAmount ?? 0)}
        />
        <SummaryCard
          label="Gross Collected"
          value={formatMoney(ordersQuery.data?.settings.currency, statsQuery.data?.grossCollectedAmount ?? 0)}
        />
        <SummaryCard label="Transactions" value={String(statsQuery.data?.totalOrders ?? 0)} />
        <SummaryCard label="Awaiting Payment" value={String(statsQuery.data?.pendingPaymentCount ?? 0)} />
        <SummaryCard label="Payment Review" value={String(statsQuery.data?.paymentSubmittedCount ?? 0)} />
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ padding: "12px 14px", display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 2 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Transaction Stages</div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              Filter by approval and payment state without opening another dropdown.
            </div>
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {REVENUE_FILTERS.map((filter) => {
              const active = activeFilter === filter.key;
              return (
                <button
                  key={filter.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setActiveFilter(filter.key);
                    setPage(0);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    borderRadius: 999,
                    border: active
                      ? "1px solid rgba(184, 134, 11, 0.45)"
                      : "1px solid rgba(148, 163, 184, 0.18)",
                    background: active
                      ? "linear-gradient(135deg, rgba(184, 134, 11, 0.22) 0%, rgba(15, 23, 42, 0.92) 100%)"
                      : "rgba(15, 23, 42, 0.72)",
                    color: active ? "#f8fafc" : "var(--muted)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    lineHeight: 1,
                    whiteSpace: "nowrap",
                    transition: "all 0.2s ease",
                  }}
                >
                  <span>{filter.label}</span>
                  <span
                    style={{
                      minWidth: 20,
                      height: 20,
                      padding: "0 6px",
                      borderRadius: 999,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: active ? "rgba(255, 255, 255, 0.14)" : "rgba(255, 255, 255, 0.06)",
                      color: active ? "#f8fafc" : "var(--foreground)",
                    }}
                  >
                    {filterCounts[filter.key]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ overflowX: "hidden", overflowY: "auto", flex: 1, minHeight: 0 }}>
        <table className="table table-clickable portal-modern-table" style={{ width: "100%", tableLayout: "fixed" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", width: "14%" }}>Transaction</th>
              <th style={{ textAlign: "left", width: "18%" }}>Customer</th>
              <th style={{ textAlign: "left", width: "24%" }}>Items</th>
              <th style={{ textAlign: "left", width: "11%" }}>Amount</th>
              <th style={{ textAlign: "left", width: "13%" }}>Finance</th>
              <th style={{ textAlign: "left", width: "12%" }}>Flow</th>
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
                  <td>{formatMoney(order.currency, resolveOrderAmount(order))}</td>
                  <td>
                    <div style={{ display: "grid", gap: 3 }}>
                      <div>{describeFinanceState(order, latestPayment)}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>
                        {latestPayment?.aiCheckStatus
                          ? `AI: ${normalizeStatusLabel(latestPayment.aiCheckStatus)}`
                          : normalizeStatusLabel(order.paymentMethod)}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "grid", gap: 4 }}>
                      <span
                        style={{
                          ...statusTone(order.status),
                          padding: "4px 10px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          display: "inline-flex",
                          width: "fit-content",
                        }}
                      >
                        {normalizeStatusLabel(order.status)}
                      </span>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>
                        {describeNextAction(order, latestPayment)}
                      </div>
                    </div>
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
                        {
                          label: "Start Refund",
                          disabled: String(order.status || "").toLowerCase() !== "paid",
                          onSelect: () => void handleRefundAction(order, "mark_pending"),
                        },
                        {
                          label: "Mark Refunded",
                          disabled: !["paid", "refund_pending"].includes(String(order.status || "").toLowerCase()),
                          onSelect: () => void handleRefundAction(order, "mark_refunded"),
                        },
                        {
                          label: "Cancel Refund",
                          disabled: String(order.status || "").toLowerCase() !== "refund_pending",
                          onSelect: () => void handleRefundAction(order, "cancel"),
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
                  No revenue transactions match this filter.
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
        onRefundAction={handleRefundAction}
        reviewPending={reviewPayment.isPending || updateRefundStatus.isPending}
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
  onRefundAction,
  reviewPending,
}: {
  order: OrderRow | null;
  onClose: () => void;
  onReviewPayment: (paymentId: string, action: "approve" | "reject") => Promise<void>;
  onRefundAction: (order: OrderRow, action: "mark_pending" | "mark_refunded" | "cancel") => Promise<void>;
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
          <h3 className="drawer-title">Revenue Transaction</h3>
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
                <div
                  style={{
                    ...statusTone(order.status),
                    padding: "6px 12px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    width: "fit-content",
                  }}
                >
                  {normalizeStatusLabel(order.status)}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <Detail label="Customer" value={order.customerName || order.customerPhone || "-"} />
                  <Detail label="Phone" value={order.customerPhone || "-"} />
                  <Detail label="Finance State" value={describeFinanceState(order, latestPayment)} />
                  <Detail label="Flow State" value={describeFlowState(order)} />
                  <Detail label="Next Action" value={describeNextAction(order, latestPayment)} />
                  <Detail label="Payment Method" value={normalizeStatusLabel(order.paymentMethod)} />
                  <Detail label="Expected" value={formatMoney(order.currency, order.expectedAmount)} />
                  <Detail label="Recognized Amount" value={formatMoney(order.currency, resolveOrderAmount(order))} />
                  <Detail label="Reference" value={order.paymentReference || "-"} />
                  <Detail label="Updated" value={formatDate(order.updatedAt)} />
                  <Detail label="Refund Amount" value={formatMoney(order.currency, order.refundAmount)} />
                  <Detail label="Refund Requested" value={formatDate(order.refundRequestedAt)} />
                  <Detail label="Refunded At" value={formatDate(order.refundedAt)} />
                  <Detail label="Refund Reason" value={order.refundReason || "-"} />
                </div>
                <div>
                  <div className="text-muted" style={{ fontSize: 12 }}>Items</div>
                  <div>{formatOrderItems(snapshot)}</div>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={reviewPending || String(order.status || "").toLowerCase() !== "paid"}
                    onClick={() => void onRefundAction(order, "mark_pending")}
                  >
                    Start Refund
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={reviewPending || !["paid", "refund_pending"].includes(String(order.status || "").toLowerCase())}
                    onClick={() => void onRefundAction(order, "mark_refunded")}
                  >
                    Mark Refunded
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={reviewPending || String(order.status || "").toLowerCase() !== "refund_pending"}
                    onClick={() => void onRefundAction(order, "cancel")}
                  >
                    Cancel Refund
                  </button>
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
                <div style={{ fontSize: 14, fontWeight: 600 }}>Transaction Ledger</div>
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
                        {formatEventSummary(event) ? (
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>{formatEventSummary(event)}</div>
                        ) : null}
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
