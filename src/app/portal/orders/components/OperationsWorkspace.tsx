"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";
import { TablePagination } from "@/app/portal/components/TablePagination";
import { TableSearchControl } from "@/app/portal/components/TableToolbarControls";
import { PortalHeaderCard, PortalMetricCard } from "@/app/portal/components/PortalSurfacePrimitives";
import {
  OrderWorkspaceDrawer,
  PaymentsTable,
  RevenueTable,
  StatusTable,
} from "@/app/portal/orders/components/OperationsWorkspaceParts";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { trpc } from "@/utils/trpc";
import {
  formatMoney,
  resolveOrderAmount,
  toDateTimeLocalValue,
  toIsoFromDateTimeLocal,
  type OrderDateField,
  type OrderRow,
  type OrderMethodFilter,
} from "@/app/portal/orders/lib/orderPageUtils";
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

  const updateDraftOrder = trpc.orders.updateDraftOrder.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.listOrdersPage.invalidate(),
        utils.orders.getOverview.invalidate(),
        utils.orders.getOrderById.invalidate(),
        utils.orders.getOrderEvents.invalidate(),
      ]);
    },
  });
  const approveOrderTicket = trpc.tickets.approveOrderTicket.useMutation({
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
    updateDraftOrder.isPending
    || approveOrderTicket.isPending
    || updatePaymentSetup.isPending
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

  const handleSaveDraftOrder = async (input: {
    orderId: string;
    expectedUpdatedAt?: Date;
    title?: string | null;
    summary?: string | null;
    notes?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    customerEmail?: string | null;
    fields?: Record<string, unknown>;
  }) => {
    try {
      await updateDraftOrder.mutateAsync(input);
      showSuccessToast(toast, {
        title: "Draft order saved",
        message: "The manual order draft and linked ticket were updated.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Could not save draft",
        message: error instanceof Error ? error.message : "Draft order update failed.",
      });
    }
  };

  const handleApproveDraftOrder = async (order: OrderRow) => {
    const supportTicketId = String(order.supportTicketId || "").trim();
    if (!supportTicketId) {
      showErrorToast(toast, {
        title: "Could not approve order",
        message: "This draft order is missing its linked ticket.",
      });
      return;
    }
    try {
      await approveOrderTicket.mutateAsync({ id: supportTicketId });
      showSuccessToast(toast, {
        title: "Order approved",
        message: "The draft order was promoted and the customer received the payment instructions.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Could not approve order",
        message: error instanceof Error ? error.message : "Draft approval failed.",
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

          <div className="portal-table-surface">
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
        title={modeTitle(mode)}
        order={selectedOrder}
        onClose={() => setSelectedOrderId(null)}
        onApprovePayment={handleReview}
        onRejectPayment={handleReview}
        onSendPaymentDetails={handleSendPaymentDetails}
        onRecordManualPayment={handleManualPayment}
        onUpdateDraftOrder={handleSaveDraftOrder}
        onApproveDraftOrder={handleApproveDraftOrder}
        onUpdateFulfillment={handleFulfillmentUpdate}
        onUpdatePaymentSetup={handleSavePaymentSetup}
        onUpdateRefundStatus={handleRefundAction}
        busy={isBusy}
        nowTs={nowTs}
      />
    </>
  );
}
