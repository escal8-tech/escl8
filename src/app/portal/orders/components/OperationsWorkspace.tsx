"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";
import { TablePagination } from "@/app/portal/components/TablePagination";
import { TableSearchControl } from "@/app/portal/components/TableToolbarControls";
import { PortalHeaderCard, PortalMetricCard } from "@/app/portal/components/PortalSurfacePrimitives";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { trpc } from "@/utils/trpc";
import {
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
  type OrderDateField,
  type OrderEventRow,
  type OrderPaymentRow,
  type OrderRow,
  type OrderMethodFilter,
} from "@/app/portal/orders/lib/orderPageUtils";
import { asRecord } from "@/app/portal/orders/lib/orderPageUtils";
import { type OrderFulfillmentStatus } from "@/lib/order-operations";

export type OperationsWorkspaceMode = "payments" | "status" | "revenue";

const PAGE_SIZE = 20;
const RANGE_OPTIONS = [
  { value: 7, label: "7D" },
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
  { value: 365, label: "12M" },
] as const;
const METHOD_FILTER_OPTIONS = [
  { value: "all", label: "All Methods" },
  { value: "manual", label: "Manual" },
  { value: "bank_qr", label: "Bank QR" },
  { value: "cod", label: "Cash On Delivery" },
] as const;
const PAYMENT_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "denied", label: "Denied" },
] as const;
const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "out_for_delivery", label: "Out For Delivery" },
  { value: "completed", label: "Completed" },
] as const;
const REVENUE_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "realized", label: "Realized" },
  { value: "unrealized", label: "Unrealized" },
] as const;

type RangeDays = (typeof RANGE_OPTIONS)[number]["value"];
type QueueFilter =
  | (typeof PAYMENT_FILTER_OPTIONS)[number]["value"]
  | (typeof STATUS_FILTER_OPTIONS)[number]["value"]
  | (typeof REVENUE_FILTER_OPTIONS)[number]["value"];

function defaultQueueFilter(mode: OperationsWorkspaceMode): QueueFilter {
  if (mode === "status") return "pending";
  if (mode === "revenue") return "all";
  return "pending";
}

function queueFilterOptions(mode: OperationsWorkspaceMode) {
  if (mode === "status") return STATUS_FILTER_OPTIONS;
  if (mode === "revenue") return REVENUE_FILTER_OPTIONS;
  return PAYMENT_FILTER_OPTIONS;
}

function toMutationDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function simpleFulfillmentBucket(order: OrderRow): "pending" | "out_for_delivery" | "completed" {
  const status = getFulfillmentStatus(order);
  if (status === "delivered") return "completed";
  if (status === "dispatched" || status === "out_for_delivery") return "out_for_delivery";
  return "pending";
}

function simpleFulfillmentLabel(order: OrderRow): string {
  const bucket = simpleFulfillmentBucket(order);
  if (bucket === "out_for_delivery") return "Out For Delivery";
  if (bucket === "completed") return "Completed";
  return "Pending";
}

function simpleFulfillmentTone(order: OrderRow): string {
  const bucket = simpleFulfillmentBucket(order);
  if (bucket === "completed") return "portal-pill portal-pill--success";
  if (bucket === "out_for_delivery") return "portal-pill portal-pill--info";
  return "portal-pill portal-pill--warning";
}

function modeTitle(mode: OperationsWorkspaceMode): string {
  if (mode === "payments") return "Payment Status";
  if (mode === "status") return "Order Status";
  return "Revenue";
}

function modeDescription(mode: OperationsWorkspaceMode): string {
  if (mode === "payments") return "One clean queue for unpaid, submitted, approved, and rejected order payments.";
  if (mode === "status") return "Only paid orders appear here so staff can dispatch and complete them quickly.";
  return "Realized vs unrealized order revenue with proof and invoice links in one ledger.";
}

export function OrdersPageScreen({ mode }: { mode: OperationsWorkspaceMode }) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [dateField, setDateField] = useState<OrderDateField>("updatedAt");
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [methodFilter, setMethodFilter] = useState<OrderMethodFilter>("all");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>(() => defaultQueueFilter(mode));
  const [nowTs, setNowTs] = useState(() => Date.now());

  useEffect(() => {
    const timerId = window.setInterval(() => setNowTs(Date.now()), 30_000);
    return () => window.clearInterval(timerId);
  }, []);

  const orderLedgerInput = useMemo(
    () => ({
      mode,
      queueFilter,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      search: search.trim() || undefined,
      dateField,
      rangeDays,
      methodFilter,
    }),
    [dateField, methodFilter, mode, page, queueFilter, rangeDays, search],
  );
  const overviewInput = useMemo(
    () => ({
      mode,
      queueFilter,
      dateField,
      rangeDays,
      methodFilter,
    }),
    [dateField, methodFilter, mode, queueFilter, rangeDays],
  );

  const overviewQuery = trpc.orders.getOverview.useQuery(overviewInput);
  const ordersQuery = trpc.orders.listOrdersPage.useQuery(orderLedgerInput);
  const selectedOrderQuery = trpc.orders.getOrderById.useQuery(
    { orderId: selectedOrderId ?? "" },
    { enabled: Boolean(selectedOrderId) },
  );

  const updatePaymentSetup = trpc.orders.updatePaymentSetup.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.listOrdersPage.invalidate(),
        utils.orders.getOverview.invalidate(),
        utils.orders.getOrderById.invalidate(),
      ]);
    },
  });
  const reviewPayment = trpc.orders.reviewPayment.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.listOrdersPage.invalidate(),
        utils.orders.getOverview.invalidate(),
        utils.orders.getOrderById.invalidate(),
        utils.orders.getOrderPayments.invalidate(),
        utils.orders.getOrderEvents.invalidate(),
      ]);
    },
  });
  const updateFulfillment = trpc.orders.updateFulfillment.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.listOrdersPage.invalidate(),
        utils.orders.getOverview.invalidate(),
        utils.orders.getOrderById.invalidate(),
        utils.orders.getOrderEvents.invalidate(),
      ]);
    },
  });
  const captureManualPayment = trpc.orders.captureManualPayment.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.listOrdersPage.invalidate(),
        utils.orders.getOverview.invalidate(),
        utils.orders.getOrderById.invalidate(),
        utils.orders.getOrderEvents.invalidate(),
        utils.orders.getOrderPayments.invalidate(),
      ]);
    },
  });
  const sendPaymentDetails = trpc.orders.sendPaymentDetails.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.listOrdersPage.invalidate(),
        utils.orders.getOverview.invalidate(),
        utils.orders.getOrderById.invalidate(),
        utils.orders.getOrderEvents.invalidate(),
      ]);
    },
  });
  const updateRefundStatus = trpc.orders.updateRefundStatus.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.listOrdersPage.invalidate(),
        utils.orders.getOverview.invalidate(),
        utils.orders.getOrderById.invalidate(),
        utils.orders.getOrderEvents.invalidate(),
      ]);
    },
  });

  useLivePortalEvents({
    orderLedgerInput,
    orderOverviewInput: overviewInput,
    activeOrderId: selectedOrderId,
    onCatchup: async () => {
      await Promise.all([
        utils.orders.listOrdersPage.invalidate(),
        utils.orders.getOverview.invalidate(),
        utils.orders.getOrderById.invalidate(),
      ]);
    },
  });

  const rows = useMemo(() => (ordersQuery.data?.items ?? []) as OrderRow[], [ordersQuery.data?.items]);
  const selectedOrder = selectedOrderQuery.data
    ?? (selectedOrderId ? rows.find((row) => row.id === selectedOrderId) ?? null : null);
  const currency = overviewQuery.data?.settings.currency ?? "LKR";
  const totalCount = ordersQuery.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const metrics = useMemo(() => overviewQuery.data?.metrics ?? {
    paymentPending: 0,
    paymentApproved: 0,
    paymentDenied: 0,
    paymentReview: 0,
    orderPending: 0,
    orderOutForDelivery: 0,
    orderCompleted: 0,
  }, [overviewQuery.data?.metrics]);
  const financeTotals = useMemo(() => overviewQuery.data?.financeTotals ?? {
    booked: 0,
    collected: 0,
    pending: 0,
    refundExposure: 0,
  }, [overviewQuery.data?.financeTotals]);

  const isBusy =
    updatePaymentSetup.isPending
    || reviewPayment.isPending
    || updateFulfillment.isPending
    || captureManualPayment.isPending
    || sendPaymentDetails.isPending
    || updateRefundStatus.isPending;

  const summaryCards = useMemo(() => {
    if (mode === "payments") {
      return [
        { label: "Pending", value: String(metrics.paymentPending), hint: "Waiting for payment or staff approval" },
        { label: "For Review", value: String(metrics.paymentReview), hint: "Payment proof already submitted" },
        { label: "Approved", value: String(metrics.paymentApproved), hint: "Paid and moved to order status" },
        { label: "Denied", value: String(metrics.paymentDenied), hint: "Rejected proof or failed payment" },
      ];
    }
    if (mode === "status") {
      return [
        { label: "Pending", value: String(metrics.orderPending), hint: "Paid orders not dispatched yet" },
        { label: "Out For Delivery", value: String(metrics.orderOutForDelivery), hint: "Courier is handling them now" },
        { label: "Completed", value: String(metrics.orderCompleted), hint: "Finished deliveries" },
        { label: "Unrealized", value: formatMoney(currency, financeTotals.pending), hint: "Still not collected yet" },
      ];
    }
    return [
      { label: "Booked", value: formatMoney(currency, financeTotals.booked), hint: "Total order value in range" },
      { label: "Realized", value: formatMoney(currency, financeTotals.collected), hint: "Approved and paid orders" },
      { label: "Unrealized", value: formatMoney(currency, financeTotals.pending), hint: "Still waiting to be collected" },
      { label: "Refund Exposure", value: formatMoney(currency, financeTotals.refundExposure), hint: "Paid value tied to refunds" },
    ];
  }, [currency, financeTotals, metrics, mode]);

  const handleReview = async (paymentId: string, action: "approve" | "reject") => {
    try {
      await reviewPayment.mutateAsync({ paymentId, action });
      showSuccessToast(toast, {
        title: action === "approve" ? "Payment approved" : "Payment rejected",
        message: action === "approve"
          ? "The order moved into the order status queue."
          : "The payment was marked denied and the customer was updated.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Review failed",
        message: error instanceof Error ? error.message : "Could not review this payment.",
      });
    }
  };

  const handleSendPaymentDetails = async (order: OrderRow) => {
    try {
      const result = await sendPaymentDetails.mutateAsync({ orderId: order.id });
      showSuccessToast(toast, {
        title: "Payment details sent",
        message: result.deliveryChannel === "email"
          ? "The customer was emailed because the WhatsApp window is closed."
          : "The customer received the payment details in WhatsApp.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Could not send details",
        message: error instanceof Error ? error.message : "Could not send the payment details.",
      });
    }
  };

  const handleManualPayment = async (order: OrderRow) => {
    const amountDefault = String(order.expectedAmount ?? order.paidAmount ?? "").trim();
    const amountPrompt = window.prompt("Paid amount", amountDefault || "");
    if (amountPrompt === null) return;
    try {
      await captureManualPayment.mutateAsync({
        orderId: order.id,
        amount: amountPrompt || amountDefault || undefined,
      });
      showSuccessToast(toast, {
        title: "Payment recorded",
        message: "The order was marked paid and the invoice link was sent.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Could not record payment",
        message: error instanceof Error ? error.message : "Manual payment capture failed.",
      });
    }
  };

  const handleRefundAction = async (order: OrderRow, action: "mark_pending" | "mark_refunded" | "cancel") => {
    const amountDefault = String(resolveOrderAmount(order) ?? "").trim();
    const amountPrompt = action === "cancel" ? undefined : window.prompt("Refund amount", amountDefault || "");
    if (amountPrompt === null) return;
    try {
      await updateRefundStatus.mutateAsync({
        orderId: order.id,
        action,
        amount: action === "cancel" ? undefined : amountPrompt || amountDefault || undefined,
      });
      showSuccessToast(toast, {
        title: "Refund updated",
        message: action === "cancel" ? "The refund flow was cancelled." : "The refund state was updated.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Could not update refund",
        message: error instanceof Error ? error.message : "Refund update failed.",
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
        message: "The order status was updated successfully.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Could not update order",
        message: error instanceof Error ? error.message : "Order update failed.",
      });
    }
  };

  const handleSavePaymentSetup = async (input: {
    orderId: string;
    expectedUpdatedAt?: Date;
    expectedAmount?: string | null;
    paymentReference?: string | null;
    customerEmail?: string | null;
    notes?: string | null;
  }) => {
    try {
      await updatePaymentSetup.mutateAsync(input);
      showSuccessToast(toast, {
        title: "Payment details saved",
        message: "The payment queue row was updated.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Could not save payment details",
        message: error instanceof Error ? error.message : "Payment setup update failed.",
      });
    }
  };

  if (overviewQuery.data && !overviewQuery.data.settings.ticketToOrderEnabled) {
    return (
      <div className="card" style={{ margin: 24 }}>
        <div className="card-body" style={{ padding: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Order operations are disabled</div>
          <div className="text-muted">Enable Ticket To Order in Settings before using these workspaces.</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="portal-page-shell">
        <div className="portal-page-stack">
          <PortalHeaderCard
            title={modeTitle(mode)}
            description={modeDescription(mode)}
            controls={
              <>
                <select
                  value={dateField}
                  onChange={(event) => {
                    setDateField(event.target.value as OrderDateField);
                    setPage(0);
                  }}
                  className="portal-res-select"
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
                  className="portal-res-select"
                >
                  {METHOD_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <div className="portal-res-range" role="group" aria-label="Range">
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

          <div className="portal-table-surface portal-table-surface--fill">
            <div className="portal-table-toolbar portal-ledger-toolbar">
              <div className="portal-ledger-toolbar__title-group">
                <h2 className="portal-ledger-toolbar__title">{mode === "revenue" ? "Transaction Ledger" : modeTitle(mode)}</h2>
                <span className="portal-ledger-toolbar__badge">{totalCount} {totalCount === 1 ? "Entry" : "Entries"}</span>
              </div>
              <div className="portal-ledger-toolbar__controls">
                <select
                  value={queueFilter}
                  onChange={(event) => {
                    setQueueFilter(event.target.value as QueueFilter);
                    setPage(0);
                  }}
                  className="portal-res-select portal-res-select--compact"
                >
                  {queueFilterOptions(mode).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <div className="portal-ledger-search">
                  <TableSearchControl
                    value={search}
                    onChange={(value) => {
                      setSearch(value);
                      setPage(0);
                    }}
                    placeholder={mode === "revenue" ? "Search reference, invoice, customer..." : "Search orders..."}
                    style={{ width: "min(320px, 100%)" }}
                  />
                </div>
              </div>
            </div>

            <div className="portal-ledger-table-wrap">
              <div className="portal-table-scroll">
                {mode === "payments" ? (
                  <PaymentsTable
                    rows={rows}
                    nowTs={nowTs}
                    onOpen={setSelectedOrderId}
                    onApprove={handleReview}
                    onReject={handleReview}
                    onSendPaymentDetails={handleSendPaymentDetails}
                    onRecordManualPayment={handleManualPayment}
                    busy={isBusy}
                  />
                ) : mode === "status" ? (
                  <StatusTable
                    rows={rows}
                    onOpen={setSelectedOrderId}
                    onDispatch={(order) => {
                      void handleFulfillmentUpdate({
                        orderId: order.id,
                        expectedUpdatedAt: toMutationDate(order.updatedAt),
                        fulfillmentStatus: "out_for_delivery",
                        recipientName: order.recipientName ?? order.customerName ?? null,
                        recipientPhone: order.recipientPhone ?? order.customerPhone ?? null,
                        shippingAddress: order.shippingAddress ?? null,
                        deliveryArea: order.deliveryArea ?? null,
                        deliveryNotes: order.deliveryNotes ?? null,
                        courierName: order.courierName ?? null,
                        trackingNumber: order.trackingNumber ?? null,
                        trackingUrl: order.trackingUrl ?? null,
                        dispatchReference: order.dispatchReference ?? null,
                        scheduledDeliveryAt: toIsoFromDateTimeLocal(toDateTimeLocalValue(order.scheduledDeliveryAt)),
                        fulfillmentNotes: order.fulfillmentNotes ?? null,
                        notifyCustomer: true,
                      });
                    }}
                    onComplete={(order) => {
                      void handleFulfillmentUpdate({
                        orderId: order.id,
                        expectedUpdatedAt: toMutationDate(order.updatedAt),
                        fulfillmentStatus: "delivered",
                        recipientName: order.recipientName ?? order.customerName ?? null,
                        recipientPhone: order.recipientPhone ?? order.customerPhone ?? null,
                        shippingAddress: order.shippingAddress ?? null,
                        deliveryArea: order.deliveryArea ?? null,
                        deliveryNotes: order.deliveryNotes ?? null,
                        courierName: order.courierName ?? null,
                        trackingNumber: order.trackingNumber ?? null,
                        trackingUrl: order.trackingUrl ?? null,
                        dispatchReference: order.dispatchReference ?? null,
                        scheduledDeliveryAt: toIsoFromDateTimeLocal(toDateTimeLocalValue(order.scheduledDeliveryAt)),
                        fulfillmentNotes: order.fulfillmentNotes ?? null,
                        notifyCustomer: true,
                      });
                    }}
                    busy={isBusy}
                  />
                ) : (
                  <RevenueTable rows={rows} onOpen={setSelectedOrderId} />
                )}
              </div>
            </div>

            <TablePagination
              page={safePage}
              totalPages={totalPages}
              shownCount={rows.length}
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

      <OrderWorkspaceDrawer
        key={selectedOrder ? `${selectedOrder.id}:${String(selectedOrder.updatedAt || "")}` : "order-workspace-drawer"}
        mode={mode}
        order={selectedOrder}
        onClose={() => setSelectedOrderId(null)}
        onApprovePayment={handleReview}
        onRejectPayment={handleReview}
        onSendPaymentDetails={handleSendPaymentDetails}
        onRecordManualPayment={handleManualPayment}
        onUpdateFulfillment={handleFulfillmentUpdate}
        onUpdatePaymentSetup={handleSavePaymentSetup}
        onUpdateRefundStatus={handleRefundAction}
        busy={isBusy}
        nowTs={nowTs}
      />
    </>
  );
}

function PaymentsTable({
  rows,
  nowTs,
  onOpen,
  onApprove,
  onReject,
  onSendPaymentDetails,
  onRecordManualPayment,
  busy,
}: {
  rows: OrderRow[];
  nowTs: number;
  onOpen: (orderId: string) => void;
  onApprove: (paymentId: string, action: "approve" | "reject") => Promise<void>;
  onReject: (paymentId: string, action: "approve" | "reject") => Promise<void>;
  onSendPaymentDetails: (order: OrderRow) => Promise<void>;
  onRecordManualPayment: (order: OrderRow) => Promise<void>;
  busy: boolean;
}) {
  return (
    <table className="table table-clickable portal-modern-table portal-ledger-table portal-mobile-cards" style={{ width: "100%", tableLayout: "fixed" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", width: "12%" }}>Order</th>
          <th style={{ textAlign: "left", width: "18%" }}>Customer</th>
          <th style={{ textAlign: "left", width: "14%" }}>Amount</th>
          <th style={{ textAlign: "left", width: "16%" }}>Payment Status</th>
          <th style={{ textAlign: "left", width: "14%" }}>Proof</th>
          <th style={{ textAlign: "left", width: "14%" }}>Invoice</th>
          <th style={{ textAlign: "left", width: "12%" }}>Updated</th>
          <th style={{ textAlign: "right", width: "12%" }}>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((order) => {
          const latestPayment = order.latestPayment ?? null;
          const canApprove = Boolean(latestPayment && latestPayment.status === "submitted");
          const canReject = canApprove;
          const sendDetails = needsPaymentDetailsWorkflow(order);
          const manualPayment = canRecordManualPayment(order);
          return (
            <tr key={order.id} onClick={() => onOpen(order.id)} style={{ cursor: "pointer" }}>
              <td data-label="Order">
                <div className="portal-entity-stack">
                  <div className="portal-id">#{shortId(order.id)}</div>
                  <div className="portal-meta-text">{order.paymentReference || "-"}</div>
                </div>
              </td>
              <td data-label="Customer">
                <div className="portal-entity-stack">
                  <div className="portal-body-text">{order.customerName || order.recipientName || "-"}</div>
                  <div className="portal-meta-text">{order.customerPhone || order.recipientPhone || "No phone"}</div>
                </div>
              </td>
              <td data-label="Amount">
                <div className="portal-entity-stack">
                  <div className="portal-body-text">{formatMoney(order.currency, resolveOrderAmount(order))}</div>
                  <div className="portal-meta-text">{formatOrderItems(asRecord(order.ticketSnapshot))}</div>
                </div>
              </td>
              <td data-label="Payment Status">
                <div className="portal-entity-stack">
                  <span className={financeToneClass(order)}>{describeFinanceState(order, latestPayment)}</span>
                  <div className="portal-meta-text">
                    {sendDetails ? describeWhatsAppWindow(order, nowTs) : latestPayment?.aiCheckNotes || "No payment note yet"}
                  </div>
                </div>
              </td>
              <td data-label="Proof">
                {latestPayment?.proofUrl ? (
                  <a href={latestPayment.proofUrl} target="_blank" rel="noreferrer" className="btn btn-ghost" onClick={(event) => event.stopPropagation()}>
                    Open Proof
                  </a>
                ) : (
                  <span className="portal-meta-text">Waiting</span>
                )}
              </td>
              <td data-label="Invoice">
                {order.invoiceUrl ? (
                  <a href={order.invoiceUrl} target="_blank" rel="noreferrer" className="btn btn-ghost" onClick={(event) => event.stopPropagation()}>
                    {order.invoiceNumber || "Open Invoice"}
                  </a>
                ) : (
                  <span className="portal-meta-text">Not sent</span>
                )}
              </td>
              <td data-label="Updated" className="portal-meta-text">{formatDate(order.updatedAt)}</td>
              <td data-label="Action" style={{ textAlign: "right" }} onClick={(event) => event.stopPropagation()}>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  {canApprove ? (
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => latestPayment && void onApprove(latestPayment.id, "approve")}>
                      Approve
                    </button>
                  ) : null}
                  {canReject ? (
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => latestPayment && void onReject(latestPayment.id, "reject")}>
                      Deny
                    </button>
                  ) : null}
                  {!canApprove && sendDetails ? (
                    <button type="button" className="btn btn-ghost" disabled={busy || !isWhatsAppWindowOpen(order, nowTs)} onClick={() => void onSendPaymentDetails(order)}>
                      Send Details
                    </button>
                  ) : null}
                  {!canApprove && manualPayment ? (
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void onRecordManualPayment(order)}>
                      Mark Paid
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-ghost" onClick={() => onOpen(order.id)}>Open</button>
                </div>
              </td>
            </tr>
          );
        })}
        {!rows.length ? (
          <tr>
            <td colSpan={8} style={{ textAlign: "center", padding: "24px 10px", color: "var(--muted)" }}>No payment rows match this filter.</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function StatusTable({
  rows,
  onOpen,
  onDispatch,
  onComplete,
  busy,
}: {
  rows: OrderRow[];
  onOpen: (orderId: string) => void;
  onDispatch: (order: OrderRow) => void;
  onComplete: (order: OrderRow) => void;
  busy: boolean;
}) {
  return (
    <table className="table table-clickable portal-modern-table portal-ledger-table portal-mobile-cards" style={{ width: "100%", tableLayout: "fixed" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", width: "12%" }}>Order</th>
          <th style={{ textAlign: "left", width: "18%" }}>Customer</th>
          <th style={{ textAlign: "left", width: "20%" }}>Items</th>
          <th style={{ textAlign: "left", width: "14%" }}>Status</th>
          <th style={{ textAlign: "left", width: "18%" }}>Delivery</th>
          <th style={{ textAlign: "left", width: "10%" }}>Updated</th>
          <th style={{ textAlign: "right", width: "8%" }}>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((order) => {
          const bucket = simpleFulfillmentBucket(order);
          return (
            <tr key={order.id} onClick={() => onOpen(order.id)} style={{ cursor: "pointer" }}>
              <td data-label="Order">
                <div className="portal-entity-stack">
                  <div className="portal-id">#{shortId(order.id)}</div>
                  <div className="portal-meta-text">{order.paymentReference || "-"}</div>
                </div>
              </td>
              <td data-label="Customer">
                <div className="portal-entity-stack">
                  <div className="portal-body-text">{order.customerName || order.recipientName || "-"}</div>
                  <div className="portal-meta-text">{order.customerPhone || order.recipientPhone || "No phone"}</div>
                </div>
              </td>
              <td data-label="Items">
                <div className="portal-entity-stack">
                  <div className="portal-body-text">{formatOrderItems(asRecord(order.ticketSnapshot))}</div>
                  <div className="portal-meta-text">{formatMoney(order.currency, resolveOrderAmount(order))}</div>
                </div>
              </td>
              <td data-label="Status">
                <div className="portal-entity-stack">
                  <span className={simpleFulfillmentTone(order)}>{simpleFulfillmentLabel(order)}</span>
                  <div className="portal-meta-text">{bucket === "pending" ? "Needs dispatch" : bucket === "out_for_delivery" ? "Delivery in progress" : "Order completed"}</div>
                </div>
              </td>
              <td data-label="Delivery">
                <div className="portal-entity-stack">
                  <div className="portal-body-text">{getDeliverySummary(order)}</div>
                  <div className="portal-meta-text">{getDeliveryHint(order)}</div>
                </div>
              </td>
              <td data-label="Updated" className="portal-meta-text">{formatDate(order.updatedAt)}</td>
              <td data-label="Action" style={{ textAlign: "right" }} onClick={(event) => event.stopPropagation()}>
                {bucket === "pending" ? (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onDispatch(order)}>Dispatch</button>
                ) : bucket === "out_for_delivery" ? (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onComplete(order)}>Complete</button>
                ) : (
                  <button type="button" className="btn btn-ghost" onClick={() => onOpen(order.id)}>Open</button>
                )}
              </td>
            </tr>
          );
        })}
        {!rows.length ? (
          <tr>
            <td colSpan={7} style={{ textAlign: "center", padding: "24px 10px", color: "var(--muted)" }}>No paid orders match this filter.</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function RevenueTable({
  rows,
  onOpen,
}: {
  rows: OrderRow[];
  onOpen: (orderId: string) => void;
}) {
  return (
    <table className="table table-clickable portal-modern-table portal-ledger-table portal-mobile-cards" style={{ width: "100%", tableLayout: "fixed" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", width: "12%" }}>Order</th>
          <th style={{ textAlign: "left", width: "18%" }}>Customer</th>
          <th style={{ textAlign: "left", width: "12%" }}>Realized</th>
          <th style={{ textAlign: "left", width: "12%" }}>Unrealized</th>
          <th style={{ textAlign: "left", width: "15%" }}>Proof</th>
          <th style={{ textAlign: "left", width: "17%" }}>Invoice</th>
          <th style={{ textAlign: "left", width: "14%" }}>Updated</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((order) => {
          const realized = getOrderStatus(order) === "paid" || getOrderStatus(order) === "refunded" || getOrderStatus(order) === "refund_pending"
            ? numericAmount(order.paidAmount ?? resolveOrderAmount(order))
            : 0;
          const unrealized = Math.max(0, numericAmount(resolveOrderAmount(order)) - realized);
          return (
            <tr key={order.id} onClick={() => onOpen(order.id)} style={{ cursor: "pointer" }}>
              <td data-label="Order">
                <div className="portal-entity-stack">
                  <div className="portal-id">#{shortId(order.id)}</div>
                  <div className="portal-meta-text">{order.paymentReference || "-"}</div>
                </div>
              </td>
              <td data-label="Customer">
                <div className="portal-entity-stack">
                  <div className="portal-body-text">{order.customerName || order.recipientName || "-"}</div>
                  <div className="portal-meta-text">{formatOrderItems(asRecord(order.ticketSnapshot))}</div>
                </div>
              </td>
              <td data-label="Realized">{formatMoney(order.currency, realized)}</td>
              <td data-label="Unrealized">{formatMoney(order.currency, unrealized)}</td>
              <td data-label="Proof">
                {order.latestPayment?.proofUrl ? (
                  <a href={order.latestPayment.proofUrl} target="_blank" rel="noreferrer" className="btn btn-ghost" onClick={(event) => event.stopPropagation()}>
                    Open Proof
                  </a>
                ) : (
                  <span className="portal-meta-text">No proof</span>
                )}
              </td>
              <td data-label="Invoice">
                {order.invoiceUrl ? (
                  <a href={order.invoiceUrl} target="_blank" rel="noreferrer" className="btn btn-ghost" onClick={(event) => event.stopPropagation()}>
                    {order.invoiceNumber || "Open Invoice"}
                  </a>
                ) : (
                  <span className="portal-meta-text">Not sent</span>
                )}
              </td>
              <td data-label="Updated" className="portal-meta-text">{formatDate(order.updatedAt)}</td>
            </tr>
          );
        })}
        {!rows.length ? (
          <tr>
            <td colSpan={7} style={{ textAlign: "center", padding: "24px 10px", color: "var(--muted)" }}>No revenue rows match this filter.</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function OrderWorkspaceDrawer({
  mode,
  order,
  onClose,
  onApprovePayment,
  onRejectPayment,
  onSendPaymentDetails,
  onRecordManualPayment,
  onUpdateFulfillment,
  onUpdatePaymentSetup,
  onUpdateRefundStatus,
  busy,
  nowTs,
}: {
  mode: OperationsWorkspaceMode;
  order: OrderRow | null;
  onClose: () => void;
  onApprovePayment: (paymentId: string, action: "approve" | "reject") => Promise<void>;
  onRejectPayment: (paymentId: string, action: "approve" | "reject") => Promise<void>;
  onSendPaymentDetails: (order: OrderRow) => Promise<void>;
  onRecordManualPayment: (order: OrderRow) => Promise<void>;
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
  onUpdatePaymentSetup: (input: {
    orderId: string;
    expectedUpdatedAt?: Date;
    expectedAmount?: string | null;
    paymentReference?: string | null;
    customerEmail?: string | null;
    notes?: string | null;
  }) => Promise<void>;
  onUpdateRefundStatus: (order: OrderRow, action: "mark_pending" | "mark_refunded" | "cancel") => Promise<void>;
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

  const [expectedAmount, setExpectedAmount] = useState(() => String(order?.expectedAmount || "").trim());
  const [paymentReference, setPaymentReference] = useState(() => String(order?.paymentReference || "").trim());
  const [customerEmail, setCustomerEmail] = useState(() => String(order?.customerEmail || "").trim());
  const [orderNotes, setOrderNotes] = useState(() => String(order?.notes || "").trim());
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
  const payments = (paymentsQuery.data ?? []) as OrderPaymentRow[];
  const latestPayment = payments[0] ?? order.latestPayment ?? null;
  const snapshot = asRecord(order.ticketSnapshot);
  const paymentWindowOpen = isWhatsAppWindowOpen(order, nowTs);
  const manualInstructions = needsPaymentDetailsWorkflow(order) ? buildManualPaymentInstructions(order) : "";

  const copyManualInstructions = async () => {
    try {
      await navigator.clipboard.writeText(manualInstructions);
      showSuccessToast(toast, { title: "Copied", message: "Manual payment instructions were copied." });
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
              <div className="portal-drawer-eyebrow">{modeTitle(mode)}</div>
              <div className="portal-drawer-title">Order #{shortId(order.id)}</div>
              <div className="portal-drawer-copy">{order.customerName || order.recipientName || "Unknown customer"} · {formatOrderItems(snapshot)}</div>
            </div>
            <button className="portal-drawer-close" onClick={onClose} aria-label="Close details">
              ×
            </button>
          </div>
          <div className="portal-drawer-tags">
            <span className={financeToneClass(order)}>{describeFinanceState(order, latestPayment)}</span>
            <span className={mode === "status" ? simpleFulfillmentTone(order) : fulfillmentToneClass(getFulfillmentStatus(order))}>
              {mode === "status" ? simpleFulfillmentLabel(order) : normalizeStatusLabel(order.fulfillmentStatus)}
            </span>
          </div>
        </div>

        <div className="drawer-body">
          <div className="portal-rows">
            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Payment Setup</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <Field label="Amount Due" value={expectedAmount} onChange={setExpectedAmount} placeholder="0.00" />
                  <Field label="Payment Reference" value={paymentReference} onChange={setPaymentReference} placeholder="Reference shown to customer" />
                  <Field label="Customer Email" value={customerEmail} onChange={setCustomerEmail} placeholder="Email for closed-window fallback" />
                  <Field label="Invoice Status" value={normalizeStatusLabel(order.invoiceStatus)} onChange={() => {}} placeholder="" disabled />
                </div>
                <TextAreaField label="Internal Notes" value={orderNotes} onChange={setOrderNotes} placeholder="Order notes visible to staff only" />
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void onUpdatePaymentSetup({
                      orderId: order.id,
                      expectedUpdatedAt,
                      expectedAmount,
                      paymentReference,
                      customerEmail,
                      notes: orderNotes,
                    })}
                  >
                    Save Payment Details
                  </button>
                  {needsPaymentDetailsWorkflow(order) ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy || !paymentWindowOpen}
                      onClick={() => void onSendPaymentDetails(order)}
                    >
                      Send Payment Details
                    </button>
                  ) : null}
                  {needsPaymentDetailsWorkflow(order) && !paymentWindowOpen ? (
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void copyManualInstructions()}>
                      Copy Manual Instructions
                    </button>
                  ) : null}
                </div>
                {needsPaymentDetailsWorkflow(order) ? (
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    {describeWhatsAppWindow(order, nowTs)}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Delivery Details</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <Field label="Recipient Name" value={recipientName} onChange={setRecipientName} placeholder="Receiver name" />
                  <Field label="Recipient Phone" value={recipientPhone} onChange={setRecipientPhone} placeholder="Receiver phone" />
                  <Field label="Delivery Area" value={deliveryArea} onChange={setDeliveryArea} placeholder="Area" />
                  <Field label="Scheduled Delivery" value={scheduledDeliveryAt} onChange={setScheduledDeliveryAt} placeholder="" type="datetime-local" />
                  <Field label="Courier Name" value={courierName} onChange={setCourierName} placeholder="Courier" />
                  <Field label="Tracking Number" value={trackingNumber} onChange={setTrackingNumber} placeholder="Tracking number" />
                  <Field label="Dispatch Reference" value={dispatchReference} onChange={setDispatchReference} placeholder="Dispatch reference" />
                  <Field label="Tracking URL" value={trackingUrl} onChange={setTrackingUrl} placeholder="https://..." />
                </div>
                <TextAreaField label="Shipping Address" value={shippingAddress} onChange={setShippingAddress} placeholder="Delivery address" />
                <TextAreaField label="Delivery Notes" value={deliveryNotes} onChange={setDeliveryNotes} placeholder="Landmarks or instructions" />
                <TextAreaField label="Fulfilment Notes" value={fulfillmentNotes} onChange={setFulfillmentNotes} placeholder="Internal notes for dispatch" />
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
                  {simpleFulfillmentBucket(order) === "pending" ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void onUpdateFulfillment({
                        orderId: order.id,
                        expectedUpdatedAt,
                        fulfillmentStatus: "out_for_delivery",
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
                      Dispatch
                    </button>
                  ) : null}
                  {simpleFulfillmentBucket(order) === "out_for_delivery" ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void onUpdateFulfillment({
                        orderId: order.id,
                        expectedUpdatedAt,
                        fulfillmentStatus: "delivered",
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
                      Complete
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Payment Actions</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {latestPayment?.status === "submitted" ? (
                    <>
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onApprovePayment(latestPayment.id, "approve")}>Approve Payment</button>
                      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void onRejectPayment(latestPayment.id, "reject")}>Deny Payment</button>
                    </>
                  ) : null}
                  {canRecordManualPayment(order) ? (
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void onRecordManualPayment(order)}>Mark Paid Manually</button>
                  ) : null}
                  {getOrderStatus(order) === "paid" ? (
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void onUpdateRefundStatus(order, "mark_pending")}>Start Refund</button>
                  ) : null}
                  {getOrderStatus(order) === "refund_pending" ? (
                    <>
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onUpdateRefundStatus(order, "mark_refunded")}>Mark Refunded</button>
                      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void onUpdateRefundStatus(order, "cancel")}>Cancel Refund</button>
                    </>
                  ) : null}
                </div>
                {latestPayment?.proofUrl ? (
                  <a href={latestPayment.proofUrl} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ width: "fit-content" }}>
                    Open Latest Proof
                  </a>
                ) : (
                  <div className="text-muted" style={{ fontSize: 12 }}>No payment proof uploaded yet.</div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Invoice</div>
                <Detail label="Invoice Number" value={order.invoiceNumber || "Not generated"} />
                <Detail label="Sent Via" value={normalizeStatusLabel(order.invoiceDeliveryMethod) || "-"} />
                <Detail label="Generated" value={formatDate(order.invoiceGeneratedAt)} />
                <Detail label="Sent" value={formatDate(order.invoiceSentAt)} />
                {order.invoiceUrl ? (
                  <a href={order.invoiceUrl} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ width: "fit-content" }}>
                    Open Invoice
                  </a>
                ) : (
                  <div className="text-muted" style={{ fontSize: 12 }}>The invoice will appear here after payment approval.</div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Payment History</div>
                {!payments.length ? (
                  <div className="text-muted" style={{ fontSize: 13 }}>No payment attempts recorded.</div>
                ) : (
                  payments.map((payment) => (
                    <div key={payment.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", display: "grid", gap: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ fontWeight: 600 }}>{normalizeStatusLabel(payment.status)}</span>
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>{formatDate(payment.createdAt)}</span>
                      </div>
                      <div>{formatMoney(payment.currency, payment.paidAmount ?? payment.expectedAmount)}</div>
                      {payment.aiCheckNotes ? <div style={{ color: "var(--muted)", fontSize: 12 }}>{payment.aiCheckNotes}</div> : null}
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
                    <div key={event.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", display: "grid", gap: 4 }}>
                      <div style={{ fontWeight: 600 }}>{normalizeStatusLabel(event.eventType)}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{formatDate(event.createdAt)} by {event.actorLabel || event.actorType || "system"}</div>
                      {formatEventSummary(event) ? <div style={{ color: "var(--muted)", fontSize: 12 }}>{formatEventSummary(event)}</div> : null}
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
    <div className="portal-detail-item">
      <div className="portal-detail-label">{label}</div>
      <div className="portal-detail-value">{value}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label className="portal-field">
      <span className="portal-field-label">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
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
