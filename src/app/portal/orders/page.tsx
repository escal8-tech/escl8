"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";
import { RowActionsMenu } from "@/app/portal/components/RowActionsMenu";
import { TablePagination } from "@/app/portal/components/TablePagination";
import { TableSearchControl } from "@/app/portal/components/TableToolbarControls";
import { PortalHeaderCard, PortalMetricCard } from "@/app/portal/components/PortalSurfacePrimitives";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import {
  describeOrderFulfillmentNextAction,
  describeOrderFulfillmentState,
  formatOrderFulfillmentStatus,
  getFulfillmentProgress,
  type OrderFulfillmentStatus,
} from "@/lib/order-operations";
import {
  METHOD_FILTER_OPTIONS,
  OPERATIONS_FILTERS,
  PAGE_SIZE,
  PROGRESS_FLOW,
  RANGE_OPTIONS,
  asRecord,
  buildFulfillmentActions,
  buildManualPaymentInstructions,
  canRecordManualPayment,
  describeFinanceState,
  describeWhatsAppWindow,
  financeToneClass,
  formatDate,
  formatEventSummary,
  formatMoney,
  formatOrderItems,
  fulfillmentToneClass,
  getDeliveryHint,
  getDeliverySummary,
  getFulfillmentStatus,
  getOrderStatus,
  isWhatsAppWindowOpen,
  needsPaymentDetailsWorkflow,
  normalizeStatusLabel,
  numericAmount,
  resolveOrderAmount,
  shortId,
  toDateTimeLocalValue,
  toIsoFromDateTimeLocal,
  type OperationsFilterKey,
  type OrderDateField,
  type OrderEventRow,
  type OrderMethodFilter,
  type OrderPaymentRow,
  type OrderRow,
  type RangeDays,
} from "@/app/portal/orders/lib/orderPageUtils";
import { trpc } from "@/utils/trpc";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type OperationsPageMode = "orders" | "revenue";
const EMPTY_ORDER_METRICS = {
  needsAction: 0,
  inFulfilment: 0,
  inTransit: 0,
  delivered: 0,
  exceptions: 0,
};
const EMPTY_ORDER_FINANCE_TOTALS = {
  booked: 0,
  collected: 0,
  pending: 0,
  refundExposure: 0,
};
const EMPTY_ORDER_FILTER_COUNTS: Record<OperationsFilterKey, number> = {
  all: 0,
  needs_action: 0,
  on_hold: 0,
  active: 0,
  in_transit: 0,
  delivered: 0,
  exceptions: 0,
  refunds: 0,
};

function toMutationDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const normalized = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(normalized.getTime()) ? undefined : normalized;
}

export function OrdersPageScreen({ mode }: { mode: OperationsPageMode }) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<OperationsFilterKey>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [dateField, setDateField] = useState<OrderDateField>("updatedAt");
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [methodFilter, setMethodFilter] = useState<OrderMethodFilter>("all");
  const [nowTs, setNowTs] = useState(() => Date.now());
  const isRevenueRoute = mode === "revenue";
  const overviewMode: OperationsPageMode = isRevenueRoute ? "revenue" : "orders";
  const overviewInput = useMemo(
    () => ({
      dateField,
      rangeDays,
      methodFilter,
      mode: overviewMode,
    }),
    [dateField, methodFilter, overviewMode, rangeDays],
  );
  const orderLedgerInput = useMemo(
    () => ({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      search: search.trim() || undefined,
      activeFilter,
      dateField,
      rangeDays,
      methodFilter,
    }),
    [activeFilter, dateField, methodFilter, page, rangeDays, search],
  );
  const overviewQuery = trpc.orders.getOverview.useQuery(overviewInput);
  const ordersQuery = trpc.orders.listOrdersPage.useQuery(orderLedgerInput);
  const reviewPayment = trpc.orders.reviewPayment.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.listOrders.invalidate(),
        utils.orders.listOrdersPage.invalidate(),
        utils.orders.getOverview.invalidate(),
        utils.orders.getOrderById.invalidate(),
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
        utils.orders.listOrdersPage.invalidate(),
        utils.orders.getOverview.invalidate(),
        utils.orders.getOrderById.invalidate(),
        utils.orders.getStats.invalidate(),
        utils.orders.getOrderPayments.invalidate(),
        utils.orders.getOrderEvents.invalidate(),
      ]);
    },
  });
  const updateFulfillment = trpc.orders.updateFulfillment.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.listOrders.invalidate(),
        utils.orders.listOrdersPage.invalidate(),
        utils.orders.getOverview.invalidate(),
        utils.orders.getOrderById.invalidate(),
        utils.orders.getStats.invalidate(),
        utils.orders.getOrderEvents.invalidate(),
      ]);
    },
  });
  const captureManualPayment = trpc.orders.captureManualPayment.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.listOrders.invalidate(),
        utils.orders.listOrdersPage.invalidate(),
        utils.orders.getOverview.invalidate(),
        utils.orders.getOrderById.invalidate(),
        utils.orders.getStats.invalidate(),
        utils.orders.getOrderEvents.invalidate(),
      ]);
    },
  });
  const sendPaymentDetails = trpc.orders.sendPaymentDetails.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.listOrders.invalidate(),
        utils.orders.listOrdersPage.invalidate(),
        utils.orders.getOverview.invalidate(),
        utils.orders.getOrderById.invalidate(),
        utils.orders.getOrderEvents.invalidate(),
      ]);
    },
  });

  useEffect(() => {
    const timerId = window.setInterval(() => setNowTs(Date.now()), 30_000);
    return () => window.clearInterval(timerId);
  }, []);

  const invalidateOrdersView = async () => {
    await Promise.all([
      utils.orders.listOrdersPage.invalidate(),
      utils.orders.getOverview.invalidate(),
      utils.orders.getOrderById.invalidate(),
    ]);
  };

  useLivePortalEvents({
    orderLedgerInput,
    orderOverviewInput: overviewInput,
    activeOrderId: selectedOrderId,
    onCatchup: invalidateOrdersView,
  });

  const orders = useMemo(() => (ordersQuery.data?.items ?? []) as OrderRow[], [ordersQuery.data?.items]);
  const pageTitle = isRevenueRoute ? "Revenue" : "Orders";
  const pageDescription = isRevenueRoute
    ? "Tracks order-driven revenue across manual, bot, and other channels."
    : "Manage approvals, payments, fulfilment, and delivery follow-up from one workspace.";
  const currency = overviewQuery.data?.settings.currency ?? "LKR";
  const selectedOrderQuery = trpc.orders.getOrderById.useQuery(
    { orderId: selectedOrderId ?? "" },
    { enabled: Boolean(selectedOrderId) },
  );
  const selectedOrder = selectedOrderQuery.data
    ?? (selectedOrderId ? orders.find((entry) => entry.id === selectedOrderId) ?? null : null);
  const scopedCount = overviewQuery.data?.scopedCount ?? 0;
  const metrics = overviewQuery.data?.metrics ?? EMPTY_ORDER_METRICS;
  const financeTotals = overviewQuery.data?.financeTotals ?? EMPTY_ORDER_FINANCE_TOTALS;
  const filterCounts = overviewQuery.data?.filterCounts ?? EMPTY_ORDER_FILTER_COUNTS;
  const trendData = overviewQuery.data?.trendData ?? [];
  const mixData = overviewQuery.data?.mixData ?? [];
  const summaryCards = useMemo(() => {
    if (isRevenueRoute) {
      return [
        {
          label: "Booked",
          value: formatMoney(currency, financeTotals.booked),
          hint: `${scopedCount} monetized order${scopedCount === 1 ? "" : "s"}`,
        },
        {
          label: "Realized Profit",
          value: formatMoney(currency, financeTotals.collected),
          hint: `Approved total: ${formatMoney(currency, financeTotals.collected)}`,
        },
        {
          label: "Unrealized",
          value: formatMoney(currency, financeTotals.pending),
          hint: "Awaiting approval/review",
        },
        {
          label: "Refund Exposure",
          value: formatMoney(currency, financeTotals.refundExposure),
          hint: `Forfeited deposits: ${formatMoney(currency, 0)}`,
        },
      ];
    }

    return [
      {
        label: "Needs Action",
        value: String(metrics.needsAction),
        hint: "Orders blocked on payment or fulfilment decisions",
      },
      {
        label: "In Fulfilment",
        value: String(metrics.inFulfilment),
        hint: "Active work moving through packing and dispatch",
      },
      {
        label: "In Transit",
        value: String(metrics.inTransit),
        hint: "Already handed off to delivery",
      },
      {
        label: "Delivered",
        value: String(metrics.delivered),
        hint: `${metrics.exceptions} exception${metrics.exceptions === 1 ? "" : "s"} in the same range`,
      },
    ];
  }, [currency, financeTotals, isRevenueRoute, metrics, scopedCount]);

  const chartMoneyFormatter = (value: number | string | readonly (string | number)[] | undefined) =>
    formatMoney(currency, Array.isArray(value) ? Number(value[0] || 0) : Number(value || 0));

  const chartCountFormatter = (value: number | string | readonly (string | number)[] | undefined) =>
    Number(Array.isArray(value) ? value[0] || 0 : value || 0);

  const totalCount = ordersQuery.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = orders;

  const isBusy =
    reviewPayment.isPending ||
    updateRefundStatus.isPending ||
    updateFulfillment.isPending ||
    captureManualPayment.isPending ||
    sendPaymentDetails.isPending;

  const handleReview = async (paymentId: string, action: "approve" | "reject") => {
    try {
      await reviewPayment.mutateAsync({ paymentId, action });
      showSuccessToast(toast, {
        title: action === "approve" ? "Payment approved" : "Payment rejected",
        message:
          action === "approve"
            ? "The payment proof was approved and the order finance state was updated."
            : "The payment proof was rejected and the customer was notified.",
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
    const amountPrompt = action === "cancel" ? undefined : window.prompt("Refund amount", amountDefault || "");
    if (amountPrompt === null) return;
    const reasonDefault =
      action === "mark_pending"
        ? order.refundReason || "Manual refund requested"
        : action === "mark_refunded"
          ? order.refundReason || "Refund completed manually"
          : "";
    const reasonPrompt = action === "cancel" ? undefined : window.prompt("Refund reason", reasonDefault || "");
    if (reasonPrompt === null) return;
    try {
      await updateRefundStatus.mutateAsync({
        orderId: order.id,
        action,
        amount: action === "cancel" ? undefined : amountPrompt || amountDefault || undefined,
        reason: action === "cancel" ? undefined : reasonPrompt || reasonDefault || undefined,
      });
      showSuccessToast(toast, {
        title: "Refund state updated",
        message:
          action === "mark_pending"
            ? "The refund queue was updated."
            : action === "mark_refunded"
              ? "The order was marked as refunded."
              : "The refund flow was cancelled.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Update failed",
        message: error instanceof Error ? error.message : "Refund update failed.",
      });
    }
  };

  const handleManualPayment = async (order: OrderRow) => {
    const amountDefault = String(order.expectedAmount ?? order.paidAmount ?? "").trim();
    const amountPrompt = window.prompt("Collected amount", amountDefault || "");
    if (amountPrompt === null) return;
    const notePrompt = window.prompt("Optional note", "Payment collected manually");
    if (notePrompt === null) return;
    try {
      await captureManualPayment.mutateAsync({
        orderId: order.id,
        amount: amountPrompt || amountDefault || undefined,
        note: notePrompt || undefined,
      });
      showSuccessToast(toast, {
        title: "Payment recorded",
        message: "The order finance state was updated and the customer was notified.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Could not record payment",
        message: error instanceof Error ? error.message : "Manual collection update failed.",
      });
    }
  };

  const handleSendPaymentDetails = async (order: OrderRow) => {
    try {
      await sendPaymentDetails.mutateAsync({ orderId: order.id });
      showSuccessToast(toast, {
        title: "Payment details sent",
        message: "The bot sent the payment instructions in the active WhatsApp thread.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Could not send payment details",
        message: error instanceof Error ? error.message : "Payment details could not be sent.",
      });
    }
  };

  const handleFulfillmentUpdate = async (input: {
    orderId: string;
    expectedUpdatedAt?: Date;
    fulfillmentStatus?: OrderFulfillmentStatus;
    recipientName?: string | null;
    recipientPhone?: string | null;
    shippingAddress?: string | null;
    deliveryArea?: string | null;
    deliveryNotes?: string | null;
    courierName?: string | null;
    trackingNumber?: string | null;
    trackingUrl?: string | null;
    dispatchReference?: string | null;
    scheduledDeliveryAt?: string;
    fulfillmentNotes?: string | null;
    notifyCustomer?: boolean;
  }) => {
    try {
      await updateFulfillment.mutateAsync(input);
      showSuccessToast(toast, {
        title: "Order updated",
        message: input.fulfillmentStatus
          ? "The fulfilment stage was updated successfully."
          : "Delivery details were saved successfully.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Could not update order",
        message: error instanceof Error ? error.message : "Order fulfilment update failed.",
      });
    }
  };

  if (overviewQuery.data && !overviewQuery.data.settings.ticketToOrderEnabled) {
    return (
      <div className="card" style={{ margin: 24 }}>
        <div className="card-body" style={{ padding: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Order operations are disabled</div>
          <div className="text-muted">
            Enable Ticket To Order in General settings to manage approvals, payments, fulfilment, and courier updates here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="portal-page-shell">
        <div className={`portal-page-stack${isRevenueRoute ? " portal-revenue-page" : ""}`}>
          <PortalHeaderCard
            title={pageTitle}
            description={pageDescription}
            controls={
              <>
                <select
                  value={dateField}
                  onChange={(event) => {
                    setDateField(event.target.value as OrderDateField);
                    setPage(0);
                  }}
                  className="portal-res-select"
                  style={{ minWidth: 0 }}
                >
                  <option value="updatedAt">By Updated Date</option>
                  <option value="createdAt">By Created Date</option>
                </select>
                <select
                  value={methodFilter}
                  onChange={(event) => {
                    setMethodFilter(event.target.value as OrderMethodFilter);
                    setPage(0);
                  }}
                  className={isRevenueRoute ? "portal-res-select" : "portal-res-select portal-res-select--compact"}
                  style={{ minWidth: 0 }}
                >
                  {METHOD_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="portal-res-range" role="group" aria-label="Time range">
                  {RANGE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`portal-res-range__button${rangeDays === option.value ? " is-active" : ""}`}
                      onClick={() => {
                        setRangeDays(option.value);
                        setPage(0);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
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

          <div className="portal-chart-grid">
            <div className="portal-chart-card">
              <div className="portal-chart-title">{isRevenueRoute ? "Revenue Trend" : "Order Trend"}</div>
              <div className="portal-chart-copy">
                {isRevenueRoute
                  ? "Booked vs collected revenue over time."
                  : "Approved and operational order value over time."}
              </div>
              <div className="portal-chart-canvas">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="ordersExpectedGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#083774" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#083774" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="ordersCollectedGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#b59a5a" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#b59a5a" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.22)" />
                    <XAxis dataKey="label" stroke="var(--portal-text-soft)" fontSize={12} />
                    <YAxis stroke="var(--portal-text-soft)" fontSize={12} />
                    <Tooltip
                      formatter={chartMoneyFormatter}
                      contentStyle={{
                        backgroundColor: "var(--portal-card-plain)",
                        border: "1px solid var(--portal-border)",
                        borderRadius: "10px",
                        color: "var(--portal-text)",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="expected"
                      stroke="#083774"
                      fillOpacity={1}
                      fill="url(#ordersExpectedGradient)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="collected"
                      stroke="#b59a5a"
                      fillOpacity={1}
                      fill="url(#ordersCollectedGradient)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="portal-chart-card">
              <div className="portal-chart-title">Status Mix</div>
              <div className="portal-chart-copy">
                {isRevenueRoute
                  ? "Revenue-weighted order states."
                  : "Distribution of active order workload across the operations pipeline."}
              </div>
              <div className="portal-chart-canvas">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={mixData} layout="vertical" margin={{ left: 12, right: 12, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.22)" />
                    <XAxis type="number" stroke="var(--portal-text-soft)" fontSize={12} />
                    <YAxis dataKey="name" type="category" stroke="var(--portal-text-soft)" fontSize={12} width={92} />
                    <Tooltip
                      formatter={chartCountFormatter}
                      contentStyle={{
                        backgroundColor: "var(--portal-card-plain)",
                        border: "1px solid var(--portal-border)",
                        borderRadius: "10px",
                        color: "var(--portal-text)",
                      }}
                    />
                    <Bar dataKey="value" fill="#b59a5a" radius={[6, 6, 6, 6]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="portal-table-surface portal-table-surface--fill">
            <div className="portal-table-toolbar portal-ledger-toolbar">
              <div className="portal-ledger-toolbar__title-group">
                <h2 className="portal-ledger-toolbar__title">{isRevenueRoute ? "Transaction Ledger" : "Order Ledger"}</h2>
                <span className="portal-ledger-toolbar__badge">
                  {totalCount} {totalCount === 1 ? "Entry" : "Entries"}
                </span>
              </div>
              <div className="portal-ledger-toolbar__controls">
                <select
                  value={activeFilter}
                  onChange={(event) => {
                    setActiveFilter(event.target.value as OperationsFilterKey);
                    setPage(0);
                  }}
                  className="portal-res-select portal-res-select--compact"
                >
                  {OPERATIONS_FILTERS.map((filter) => (
                    <option key={filter.key} value={filter.key}>
                      {filter.label} ({filterCounts[filter.key]})
                    </option>
                  ))}
                </select>
                {!isRevenueRoute ? (
                  <div className="portal-ledger-search">
                    <TableSearchControl
                      value={search}
                      onChange={(value) => {
                        setSearch(value);
                        setPage(0);
                      }}
                      placeholder="Search orders..."
                      style={{ width: "min(320px, 100%)" }}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <div className="portal-ledger-table-wrap">
              <div className="portal-table-scroll">
                <table className="table table-clickable portal-modern-table portal-ledger-table" style={{ width: "100%", tableLayout: "fixed" }}>
                  <thead>
                    {isRevenueRoute ? (
                      <tr>
                        <th style={{ textAlign: "left", width: "8%" }}>Ref</th>
                        <th style={{ textAlign: "left", width: "21%" }}>Guest</th>
                        <th style={{ textAlign: "left", width: "16%" }}>Status</th>
                        <th style={{ textAlign: "left", width: "16%" }}>Timing</th>
                        <th style={{ textAlign: "left", width: "11%" }}>Booked</th>
                        <th style={{ textAlign: "left", width: "11%" }}>Net Realized</th>
                        <th style={{ textAlign: "left", width: "7%" }}>Pending</th>
                        <th style={{ textAlign: "right", width: "10%" }}>Action</th>
                      </tr>
                    ) : (
                      <tr>
                        <th style={{ textAlign: "left", width: "13%" }}>Order</th>
                        <th style={{ textAlign: "left", width: "18%" }}>Customer</th>
                        <th style={{ textAlign: "left", width: "20%" }}>Items</th>
                        <th style={{ textAlign: "left", width: "13%" }}>Finance</th>
                        <th style={{ textAlign: "left", width: "14%" }}>Fulfilment</th>
                        <th style={{ textAlign: "left", width: "14%" }}>Delivery</th>
                        <th style={{ textAlign: "left", width: "8%" }}>Updated</th>
                        <th style={{ textAlign: "right", width: "8%" }}>Action</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {pageRows.map((order) => {
                      const snapshot = asRecord(order.ticketSnapshot);
                      const latestPayment = order.latestPayment ?? null;
                      const fulfillment = getFulfillmentStatus(order);
                      const expectedAmount = numericAmount(resolveOrderAmount(order));
                      const collectedAmount = getOrderStatus(order) === "paid"
                        ? numericAmount(order.paidAmount ?? resolveOrderAmount(order))
                        : 0;
                      const pendingAmount = Math.max(0, expectedAmount - collectedAmount);
                      const canApprovePayment = Boolean(latestPayment && latestPayment.status === "submitted");
                      const canRejectPayment = canApprovePayment;
                      return (
                        <tr key={order.id} onClick={() => setSelectedOrderId(order.id)} style={{ cursor: "pointer" }}>
                          {isRevenueRoute ? (
                            <>
                              <td className="portal-ledger-table__ref">
                                {order.id.startsWith("ord_") ? shortId(order.id) : `#${shortId(order.id)}`}
                              </td>
                              <td>
                                <div className="portal-entity-stack">
                                  <div className="portal-body-text">{order.customerName || order.recipientName || order.customerPhone || "-"}</div>
                                  <div className="portal-meta-text">
                                    {(order.recipientPhone || order.customerPhone || "No phone")}
                                    {order.paymentReference ? ` | ${order.paymentReference}` : ""}
                                  </div>
                                  <div className="portal-meta-text">{formatOrderItems(snapshot)}</div>
                                </div>
                              </td>
                              <td>
                                <div className="portal-entity-stack">
                                  <span className={financeToneClass(order)}>{describeFinanceState(order, latestPayment)}</span>
                                  <div className="portal-ledger-status-note">Fulfilment · {formatOrderFulfillmentStatus(fulfillment)}</div>
                                </div>
                              </td>
                              <td>
                                <div className="portal-entity-stack">
                                  <div className="portal-body-text">
                                    {formatDate(dateField === "createdAt" ? order.createdAt : order.updatedAt)}
                                  </div>
                                  <div className="portal-meta-text">Booked {formatDate(order.createdAt)}</div>
                                </div>
                              </td>
                              <td className="portal-ledger-table__money">{formatMoney(order.currency, expectedAmount)}</td>
                              <td className="portal-ledger-table__money">{formatMoney(order.currency, collectedAmount)}</td>
                              <td className="portal-meta-text">{formatMoney(order.currency, pendingAmount)}</td>
                            </>
                          ) : (
                            <>
                              <td>
                                <div className="portal-entity-stack">
                                  <div className="portal-id">#{shortId(order.id)}</div>
                                  <div className="portal-meta-text">{order.paymentReference || "-"}</div>
                                </div>
                              </td>
                              <td>
                                <div className="portal-entity-stack">
                                  <div className="portal-body-text">{order.customerName || order.recipientName || order.customerPhone || "-"}</div>
                                  <div className="portal-meta-text">{order.recipientPhone || order.customerPhone || "No phone"}</div>
                                </div>
                              </td>
                              <td>
                                <span className="portal-body-text">{formatOrderItems(snapshot)}</span>
                              </td>
                              <td>
                                <div className="portal-entity-stack">
                                  <span className="portal-ledger-table__money">{formatMoney(order.currency, expectedAmount)}</span>
                                  <span className={financeToneClass(order)}>{describeFinanceState(order, latestPayment)}</span>
                                </div>
                              </td>
                              <td>
                                <div className="portal-entity-stack">
                                  <span className={fulfillmentToneClass(fulfillment)}>{formatOrderFulfillmentStatus(fulfillment)}</span>
                                  <div className="portal-meta-text">{describeOrderFulfillmentNextAction(fulfillment)}</div>
                                </div>
                              </td>
                              <td>
                                <div className="portal-entity-stack">
                                  <div className="portal-body-text">{getDeliverySummary(order)}</div>
                                  <div className="portal-meta-text">{getDeliveryHint(order)}</div>
                                </div>
                              </td>
                              <td className="portal-meta-text">{formatDate(order.updatedAt)}</td>
                            </>
                          )}
                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="portal-ledger-actions">
                              <button
                                type="button"
                                className={`portal-ledger-action portal-ledger-action--approve${canApprovePayment ? "" : " is-hidden"}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (latestPayment) void handleReview(latestPayment.id, "approve");
                                }}
                                disabled={!canApprovePayment}
                                aria-label={canApprovePayment ? "Approve payment" : undefined}
                              >
                                <CheckIcon />
                              </button>
                              <button
                                type="button"
                                className={`portal-ledger-action portal-ledger-action--reject${canRejectPayment ? "" : " is-hidden"}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (latestPayment) void handleReview(latestPayment.id, "reject");
                                }}
                                disabled={!canRejectPayment}
                                aria-label={canRejectPayment ? "Reject payment" : undefined}
                              >
                                <CloseIcon />
                              </button>
                              <RowActionsMenu
                                items={[
                                  { label: "Open Details", onSelect: () => setSelectedOrderId(order.id) },
                                  {
                                    label: "Approve Payment",
                                    disabled: !canApprovePayment,
                                    onSelect: () => latestPayment && void handleReview(latestPayment.id, "approve"),
                                  },
                                  {
                                    label: "Reject Payment",
                                    disabled: !canRejectPayment,
                                    onSelect: () => latestPayment && void handleReview(latestPayment.id, "reject"),
                                  },
                                  {
                                    label: "Send Payment Details",
                                    disabled: !needsPaymentDetailsWorkflow(order) || !isWhatsAppWindowOpen(order, nowTs),
                                    onSelect: () => void handleSendPaymentDetails(order),
                                  },
                                  {
                                    label: "Record Manual Payment",
                                    disabled: !canRecordManualPayment(order),
                                    onSelect: () => void handleManualPayment(order),
                                  },
                                  {
                                    label: "Start Refund",
                                    disabled: getOrderStatus(order) !== "paid",
                                    onSelect: () => void handleRefundAction(order, "mark_pending"),
                                  },
                                ]}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {pageRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: "center", padding: "24px 10px", color: "var(--muted)" }}>
                          No orders match this view in the selected range.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <TablePagination
              page={safePage}
              totalPages={totalPages}
              shownCount={pageRows.length}
              totalCount={totalCount}
              canPrev={safePage > 0}
              canNext={safePage < totalPages - 1}
              onPrev={() => setPage((current) => Math.max(0, current - 1))}
              onNext={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
              onPageChange={setPage}
            />
          </div>
        </div>
      </div>

      <OrderDetailsDrawer
        key={selectedOrder ? `${selectedOrder.id}:${String(selectedOrder.updatedAt ?? "")}` : "order-drawer"}
        order={selectedOrder}
        onClose={() => setSelectedOrderId(null)}
        onReviewPayment={handleReview}
        onRefundAction={handleRefundAction}
        onRecordManualPayment={handleManualPayment}
        onSendPaymentDetails={handleSendPaymentDetails}
        onUpdateFulfillment={handleFulfillmentUpdate}
        busy={isBusy}
        nowTs={nowTs}
      />
    </>
  );
}

export default function OrdersPage() {
  return <OrdersPageScreen mode="orders" />;
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function OrderDetailsDrawer({
  order,
  onClose,
  onReviewPayment,
  onRefundAction,
  onRecordManualPayment,
  onSendPaymentDetails,
  onUpdateFulfillment,
  busy,
  nowTs,
}: {
  order: OrderRow | null;
  onClose: () => void;
  onReviewPayment: (paymentId: string, action: "approve" | "reject") => Promise<void>;
  onRefundAction: (order: OrderRow, action: "mark_pending" | "mark_refunded" | "cancel") => Promise<void>;
  onRecordManualPayment: (order: OrderRow) => Promise<void>;
  onSendPaymentDetails: (order: OrderRow) => Promise<void>;
  onUpdateFulfillment: (input: {
    orderId: string;
    expectedUpdatedAt?: Date;
    fulfillmentStatus?: OrderFulfillmentStatus;
    recipientName?: string | null;
    recipientPhone?: string | null;
    shippingAddress?: string | null;
    deliveryArea?: string | null;
    deliveryNotes?: string | null;
    courierName?: string | null;
    trackingNumber?: string | null;
    trackingUrl?: string | null;
    dispatchReference?: string | null;
    scheduledDeliveryAt?: string;
    fulfillmentNotes?: string | null;
    notifyCustomer?: boolean;
  }) => Promise<void>;
  busy: boolean;
  nowTs: number;
}) {
  const toast = useToast();
  const paymentsQuery = trpc.orders.getOrderPayments.useQuery(
    { orderId: order?.id ?? "" },
    { enabled: Boolean(order?.id) },
  );
  const eventsQuery = trpc.orders.getOrderEvents.useQuery(
    { orderId: order?.id ?? "" },
    { enabled: Boolean(order?.id) },
  );

  const [recipientName, setRecipientName] = useState(() => String(order?.recipientName || order?.customerName || "").trim());
  const [recipientPhone, setRecipientPhone] = useState(() => String(order?.recipientPhone || order?.customerPhone || "").trim());
  const [shippingAddress, setShippingAddress] = useState(() => String(order?.shippingAddress || "").trim());
  const [deliveryArea, setDeliveryArea] = useState(() => String(order?.deliveryArea || "").trim());
  const [deliveryNotes, setDeliveryNotes] = useState(() => String(order?.deliveryNotes || "").trim());
  const [courierName, setCourierName] = useState(() => String(order?.courierName || "").trim());
  const [trackingNumber, setTrackingNumber] = useState(() => String(order?.trackingNumber || "").trim());
  const [trackingUrl, setTrackingUrl] = useState(() => String(order?.trackingUrl || "").trim());
  const [dispatchReference, setDispatchReference] = useState(() => String(order?.dispatchReference || "").trim());
  const [scheduledDeliveryAt, setScheduledDeliveryAt] = useState(() => toDateTimeLocalValue(order?.scheduledDeliveryAt));
  const [fulfillmentNotes, setFulfillmentNotes] = useState(() => String(order?.fulfillmentNotes || "").trim());

  if (!order) return null;
  const expectedUpdatedAt = toMutationDate(order.updatedAt);
  const snapshot = asRecord(order.ticketSnapshot);
  const payments = (paymentsQuery.data ?? []) as OrderPaymentRow[];
  const latestPayment = payments[0] ?? order.latestPayment ?? null;
  const fulfillment = getFulfillmentStatus(order);
  const quickActions = buildFulfillmentActions(order);
  const missingDeliveryBits = [
    recipientName ? null : "recipient name",
    recipientPhone ? null : "recipient phone",
    shippingAddress ? null : "shipping address",
  ].filter(Boolean) as string[];
  const readyForDispatch = Boolean(courierName || trackingNumber || dispatchReference);
  const paymentWindowOpen = isWhatsAppWindowOpen(order, nowTs);
  const showPaymentWorkflowCard = needsPaymentDetailsWorkflow(order);
  const manualPaymentInstructions = showPaymentWorkflowCard ? buildManualPaymentInstructions(order) : "";
  const paymentWindowTone = paymentWindowOpen
    ? {
        color: "#86efac",
        background: "rgba(34, 197, 94, 0.1)",
        border: "1px solid rgba(34, 197, 94, 0.24)",
      }
    : {
        color: "#fcd34d",
        background: "rgba(245, 158, 11, 0.12)",
        border: "1px solid rgba(245, 158, 11, 0.22)",
      };
  const paymentWindowToneClass = paymentWindowOpen
    ? "portal-pill portal-pill--success"
    : "portal-pill portal-pill--warning";
  const bookedTotal = numericAmount(resolveOrderAmount(order));
  const paidTotal = numericAmount(order.paidAmount ?? latestPayment?.paidAmount ?? 0);
  const pendingTotal = Math.max(0, bookedTotal - paidTotal);

  const copyManualInstructions = async () => {
    try {
      await navigator.clipboard.writeText(manualPaymentInstructions);
      showSuccessToast(toast, {
        title: "Instructions copied",
        message: "The manual payment instructions are ready to paste into staff WhatsApp.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Copy failed",
        message: error instanceof Error ? error.message : "Could not copy the payment instructions.",
      });
    }
  };

  return (
    <>
      <div className="drawer-backdrop open" onClick={onClose} />
      <div className="drawer open portal-drawer-shell">
        <div className="drawer-header">
          <div className="portal-drawer-heading">
            <div>
              <div className="portal-drawer-eyebrow">Order Details</div>
              <div className="portal-drawer-title">Order #{shortId(order.id)}</div>
              <div className="portal-drawer-copy">
                {(order.customerName || order.recipientName || "Unassigned customer")}
                {formatOrderItems(snapshot) ? ` · ${formatOrderItems(snapshot)}` : ""}
              </div>
            </div>
            <button className="portal-drawer-close" onClick={onClose} aria-label="Close details">
              <CloseIcon />
            </button>
          </div>
          <div className="portal-drawer-tags">
            <StatusPill
              label={describeFinanceState(order, latestPayment)}
              toneClass={financeToneClass(order)}
            />
            <StatusPill
              label={formatOrderFulfillmentStatus(fulfillment)}
              toneClass={fulfillmentToneClass(fulfillment)}
            />
          </div>
          <div className="portal-drawer-metrics">
            <div className="portal-drawer-metric">
              <div className="portal-drawer-metric__label">Booked</div>
              <div className="portal-drawer-metric__value">{formatMoney(order.currency, bookedTotal)}</div>
            </div>
            <div className="portal-drawer-metric">
              <div className="portal-drawer-metric__label">Paid</div>
              <div className="portal-drawer-metric__value">{formatMoney(order.currency, paidTotal)}</div>
            </div>
            <div className="portal-drawer-metric">
              <div className="portal-drawer-metric__label">Outstanding</div>
              <div className="portal-drawer-metric__value">{formatMoney(order.currency, pendingTotal)}</div>
            </div>
          </div>
        </div>
        <div className="drawer-body">
          <div className="portal-rows">
            <div className="portal-detail-panel">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div className="portal-section-head">
                  <div className="portal-section-kicker">Order #{shortId(order.id)}</div>
                  <div className="portal-section-title">{order.customerName || order.recipientName || "Unassigned customer"}</div>
                  <div className="portal-section-caption">{formatOrderItems(snapshot)}</div>
                </div>
                <div className="portal-inline-actions" style={{ justifyContent: "flex-start" }}>
                  <StatusPill
                    label={describeFinanceState(order, latestPayment)}
                    toneClass={financeToneClass(order)}
                  />
                  <StatusPill
                    label={formatOrderFulfillmentStatus(fulfillment)}
                    toneClass={fulfillmentToneClass(fulfillment)}
                  />
                </div>
              </div>

              <div className="portal-detail-grid">
                <Detail label="Order Reference" value={order.paymentReference || "-"} />
                <Detail label="Payment Method" value={normalizeStatusLabel(order.paymentMethod)} />
                <Detail label="Amount" value={formatMoney(order.currency, resolveOrderAmount(order))} />
                <Detail label="Updated" value={formatDate(order.updatedAt)} />
                <Detail label="Delivery" value={getDeliverySummary(order)} />
                <Detail label="Next Action" value={describeOrderFulfillmentNextAction(fulfillment)} />
              </div>
            </div>

            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Fulfilment Progress</div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))",
                    gap: 8,
                  }}
                >
                  {PROGRESS_FLOW.map((stage) => {
                    const active = fulfillment === stage;
                    const complete = getFulfillmentProgress(fulfillment) > getFulfillmentProgress(stage);
                    return (
                      <div
                        key={stage}
                        style={{
                          borderRadius: 14,
                          padding: "10px 12px",
                          border: active
                            ? "1px solid rgba(184, 134, 11, 0.5)"
                            : complete
                              ? "1px solid rgba(34, 197, 94, 0.28)"
                              : "1px solid rgba(148, 163, 184, 0.18)",
                          background: active
                            ? "linear-gradient(135deg, rgba(184, 134, 11, 0.18), rgba(15, 23, 42, 0.94))"
                            : complete
                              ? "rgba(34, 197, 94, 0.08)"
                              : "rgba(15, 23, 42, 0.55)",
                          display: "grid",
                          gap: 4,
                        }}
                      >
                        <div style={{ fontSize: 11, color: complete ? "#86efac" : active ? "#f8fafc" : "var(--muted)" }}>
                          {complete ? "Done" : active ? "Current" : "Stage"}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{formatOrderFulfillmentStatus(stage)}</div>
                      </div>
                    );
                  })}
                </div>
                {(fulfillment === "failed_delivery" || fulfillment === "returned") ? (
                  <div
                    style={{
                      border: "1px solid rgba(239, 68, 68, 0.25)",
                      borderRadius: 12,
                      background: "rgba(239, 68, 68, 0.08)",
                      padding: "10px 12px",
                      color: "#fecaca",
                      fontSize: 13,
                    }}
                  >
                    {describeOrderFulfillmentState(fulfillment)}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>Quick Actions</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      Use the guided actions below so staff only sees the correct next steps.
                    </div>
                  </div>
                  {missingDeliveryBits.length ? (
                    <div
                      style={{
                        padding: "8px 10px",
                        borderRadius: 12,
                        background: "rgba(245, 158, 11, 0.12)",
                        border: "1px solid rgba(245, 158, 11, 0.22)",
                        color: "#fcd34d",
                        fontSize: 12,
                      }}
                    >
                      Missing: {missingDeliveryBits.join(", ")}
                    </div>
                  ) : null}
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {quickActions.length ? quickActions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      className={action.tone === "primary" ? "btn btn-primary" : "btn btn-ghost"}
                      disabled={busy || (action.nextStatus === "dispatched" && !readyForDispatch)}
                      onClick={() => void onUpdateFulfillment({
                        orderId: order.id,
                        expectedUpdatedAt,
                        fulfillmentStatus: action.nextStatus,
                        recipientName,
                        recipientPhone,
                        shippingAddress,
                        deliveryArea,
                        deliveryNotes,
                        courierName,
                        trackingNumber,
                        trackingUrl,
                        dispatchReference,
                        scheduledDeliveryAt: toIsoFromDateTimeLocal(scheduledDeliveryAt),
                        fulfillmentNotes,
                        notifyCustomer: true,
                      })}
                    >
                      {action.label}
                    </button>
                  )) : (
                    <div className="text-muted" style={{ fontSize: 13 }}>No guided action available at this stage.</div>
                  )}
                  {canRecordManualPayment(order) ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => void onRecordManualPayment(order)}
                    >
                      Record Manual Payment
                    </button>
                  ) : null}
                  {getOrderStatus(order) === "paid" ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => void onRefundAction(order, "mark_pending")}
                    >
                      Start Refund
                    </button>
                  ) : null}
                </div>
                {fulfillment === "packed" && !readyForDispatch ? (
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    Add courier, tracking, or a dispatch reference before dispatching this order.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Recipient & Delivery Details</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <Field label="Recipient Name" value={recipientName} onChange={setRecipientName} placeholder="Customer or receiver" />
                  <Field label="Recipient Phone" value={recipientPhone} onChange={setRecipientPhone} placeholder="Phone number" />
                  <Field label="Delivery Area" value={deliveryArea} onChange={setDeliveryArea} placeholder="City / area / zone" />
                  <Field
                    label="Scheduled Delivery"
                    value={scheduledDeliveryAt}
                    onChange={setScheduledDeliveryAt}
                    placeholder=""
                    type="datetime-local"
                  />
                </div>
                <TextAreaField label="Shipping Address" value={shippingAddress} onChange={setShippingAddress} placeholder="Full delivery address" />
                <TextAreaField label="Delivery Notes" value={deliveryNotes} onChange={setDeliveryNotes} placeholder="Landmark, instructions, gate notes, timing notes" />
                <TextAreaField label="Internal Fulfilment Notes" value={fulfillmentNotes} onChange={setFulfillmentNotes} placeholder="Packing notes, stock issues, customer coordination notes" />
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void onUpdateFulfillment({
                      orderId: order.id,
                      expectedUpdatedAt,
                      recipientName,
                      recipientPhone,
                      shippingAddress,
                      deliveryArea,
                      deliveryNotes,
                      courierName,
                      trackingNumber,
                      trackingUrl,
                      dispatchReference,
                      scheduledDeliveryAt: toIsoFromDateTimeLocal(scheduledDeliveryAt),
                      fulfillmentNotes,
                      notifyCustomer: false,
                    })}
                  >
                    Save Delivery Details
                  </button>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Courier & Tracking</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <Field label="Courier Name" value={courierName} onChange={setCourierName} placeholder="PickMe Flash, Lalamove, etc." />
                  <Field label="Tracking Number" value={trackingNumber} onChange={setTrackingNumber} placeholder="Waybill or consignment number" />
                  <Field label="Dispatch Reference" value={dispatchReference} onChange={setDispatchReference} placeholder="Internal handoff reference" />
                  <Field label="Tracking URL" value={trackingUrl} onChange={setTrackingUrl} placeholder="https://..." />
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void onUpdateFulfillment({
                      orderId: order.id,
                      expectedUpdatedAt,
                      recipientName,
                      recipientPhone,
                      shippingAddress,
                      deliveryArea,
                      deliveryNotes,
                      courierName,
                      trackingNumber,
                      trackingUrl,
                      dispatchReference,
                      scheduledDeliveryAt: toIsoFromDateTimeLocal(scheduledDeliveryAt),
                      fulfillmentNotes,
                      notifyCustomer: false,
                    })}
                  >
                    Save Courier Data
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy || !readyForDispatch}
                    onClick={() => void onUpdateFulfillment({
                      orderId: order.id,
                      expectedUpdatedAt,
                      fulfillmentStatus: "dispatched",
                      recipientName,
                      recipientPhone,
                      shippingAddress,
                      deliveryArea,
                      deliveryNotes,
                      courierName,
                      trackingNumber,
                      trackingUrl,
                      dispatchReference,
                      scheduledDeliveryAt: toIsoFromDateTimeLocal(scheduledDeliveryAt),
                      fulfillmentNotes,
                      notifyCustomer: true,
                    })}
                  >
                    Save And Dispatch
                  </button>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Finance & Payment</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <Detail label="Finance State" value={describeFinanceState(order, latestPayment)} />
                  <Detail label="Payment Method" value={normalizeStatusLabel(order.paymentMethod)} />
                  <Detail label="Expected" value={formatMoney(order.currency, order.expectedAmount)} />
                  <Detail label="Captured" value={formatMoney(order.currency, order.paidAmount)} />
                </div>
                {showPaymentWorkflowCard ? (
                  <div
                    style={{
                      borderRadius: 14,
                      padding: "14px 16px",
                      display: "grid",
                      gap: 10,
                      ...paymentWindowTone,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ display: "grid", gap: 4 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>Bot Payment Thread</div>
                        <div style={{ fontSize: 12, color: paymentWindowTone.color }}>
                          {describeWhatsAppWindow(order, nowTs)}
                        </div>
                      </div>
                      <StatusPill
                        label={paymentWindowOpen ? "Window Open" : "Window Closed"}
                        toneClass={paymentWindowToneClass}
                      />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                      <Detail label="Bot Number" value={String(order.botDisplayPhoneNumber || "Not available")} />
                      <Detail label="Window Expires" value={formatDate(order.whatsappWindowExpiresAt)} />
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy || !paymentWindowOpen}
                        onClick={() => void onSendPaymentDetails(order)}
                      >
                        Send Payment Details
                      </button>
                      {!paymentWindowOpen ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={busy}
                          onClick={() => void copyManualInstructions()}
                        >
                          Copy Manual Instructions
                        </button>
                      ) : null}
                    </div>
                    {!paymentWindowOpen ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <div className="text-muted" style={{ fontSize: 12 }}>
                          The bot window is closed. Staff can send these details from another WhatsApp number and ask the customer to send the slip back to the bot thread.
                        </div>
                        <pre
                          style={{
                            margin: 0,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            borderRadius: 12,
                            border: "1px solid rgba(148, 163, 184, 0.18)",
                            background: "rgba(15, 23, 42, 0.68)",
                            padding: "12px 14px",
                            fontSize: 12,
                            lineHeight: 1.6,
                            color: "var(--foreground)",
                          }}
                        >
                          {manualPaymentInstructions}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {!latestPayment ? (
                  <div className="text-muted" style={{ fontSize: 13 }}>No payment proof submitted yet.</div>
                ) : (
                  <div
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      padding: "12px 14px",
                      display: "grid",
                      gap: 6,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{normalizeStatusLabel(latestPayment.status)}</div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>
                      AI check: {normalizeStatusLabel(latestPayment.aiCheckStatus)} | {formatMoney(latestPayment.currency, latestPayment.paidAmount ?? latestPayment.expectedAmount)}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>{latestPayment.aiCheckNotes || "No AI notes."}</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {latestPayment.proofUrl ? (
                        <a href={latestPayment.proofUrl} target="_blank" rel="noreferrer" className="btn btn-ghost">
                          Open Payment Proof
                        </a>
                      ) : null}
                      {latestPayment.status === "submitted" ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={busy}
                            onClick={() => void onReviewPayment(latestPayment.id, "approve")}
                          >
                            Approve Payment
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={busy}
                            onClick={() => void onReviewPayment(latestPayment.id, "reject")}
                          >
                            Reject Payment
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {canRecordManualPayment(order) ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void onRecordManualPayment(order)}
                    >
                      Record Manual Payment
                    </button>
                  ) : null}
                  {getOrderStatus(order) === "paid" ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => void onRefundAction(order, "mark_pending")}
                    >
                      Start Refund
                    </button>
                  ) : null}
                  {getOrderStatus(order) === "refund_pending" ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() => void onRefundAction(order, "mark_refunded")}
                      >
                        Mark Refunded
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => void onRefundAction(order, "cancel")}
                      >
                        Cancel Refund
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Payment Ledger</div>
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
        <div className="portal-drawer-footer">
          <div className="portal-drawer-footer__label">Order Actions</div>
          <div className="portal-drawer-footer__actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !canRecordManualPayment(order)}
              onClick={() => void onRecordManualPayment(order)}
            >
              Record Payment
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || !needsPaymentDetailsWorkflow(order)}
              onClick={() => void onSendPaymentDetails(order)}
            >
              Send Details
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="portal-detail-item">
      <div className="portal-detail-label">{label}</div>
      <div className="portal-detail-value">{value}</div>
    </div>
  );
}

function StatusPill({
  label,
  toneClass,
}: {
  label: string;
  toneClass: string;
}) {
  return <span className={toneClass}>{label}</span>;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <label className="portal-field">
      <span className="portal-field-label">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="portal-field">
      <span className="portal-field-label">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        style={{ resize: "vertical" }}
      />
    </label>
  );
}
