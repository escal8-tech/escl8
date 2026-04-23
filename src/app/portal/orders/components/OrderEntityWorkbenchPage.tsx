"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";
import { useToast } from "@/components/ToastProvider";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { InlineThreadPanel } from "@/app/portal/messages/components/InlineThreadPanel";
import { OrderWorkspaceDrawer } from "@/app/portal/orders/components/OperationsWorkspaceParts";
import {
  canReopenPaidOrderForPaymentReview,
  type OrderRow,
} from "@/app/portal/orders/lib/orderPageUtils";
import { type OperationsWorkspaceMode } from "@/app/portal/orders/components/OperationsWorkspace";
import { type OrderFulfillmentStatus } from "@/lib/order-operations";
import { trpc } from "@/utils/trpc";

function normalizeMode(value: string | null | undefined): OperationsWorkspaceMode {
  if (value === "status" || value === "revenue") return value;
  return "payments";
}

function modeTitle(mode: OperationsWorkspaceMode): string {
  if (mode === "payments") return "Payment Status";
  if (mode === "status") return "Order Status";
  return "Revenue";
}

export function OrderEntityWorkbenchPage({ forcedMode }: { forcedMode?: OperationsWorkspaceMode }) {
  const params = useParams<{ orderId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const utils = trpc.useUtils();
  const orderId = String(params?.orderId || "").trim();
  const mode = forcedMode ?? normalizeMode(searchParams?.get("mode"));
  const backHref = mode === "payments" ? "/payments" : mode === "status" ? "/status" : "/revenue";

  const orderQuery = trpc.orders.getOrderById.useQuery({ orderId }, { enabled: Boolean(orderId) });
  const order = (orderQuery.data ?? null) as OrderRow | null;

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
  const denyPendingPaymentOrder = trpc.orders.denyPendingPaymentOrder.useMutation({
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
  const reopenPaidOrderForPaymentReview = trpc.orders.reopenPaidOrderForPaymentReview.useMutation({
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

  useLivePortalEvents({
    activeOrderId: orderId || null,
    onCatchup: async () => {
      await Promise.all([
        utils.orders.getOrderById.invalidate({ orderId }),
        utils.orders.getOrderEvents.invalidate({ orderId }),
        utils.orders.getOrderPayments.invalidate({ orderId }),
      ]);
    },
  });

  const isBusy =
    updateDraftOrder.isPending
    || approveOrderTicket.isPending
    || updatePaymentSetup.isPending
    || sendPaymentDetails.isPending
    || reviewPayment.isPending
    || updateFulfillment.isPending
    || captureManualPayment.isPending
    || denyPendingPaymentOrder.isPending
    || updateRefundStatus.isPending
    || reopenPaidOrderForPaymentReview.isPending;

  const handleReview = async (row: OrderRow, paymentId: string | undefined, action: "approve" | "reject") => {
    const rejectReason = action === "reject" ? window.prompt("Reason for denying this payment", "Payment was not approved") : null;
    if (action === "reject" && rejectReason === null) return;
    const notes = rejectReason?.trim() || undefined;
    try {
      if (paymentId) await reviewPayment.mutateAsync({ paymentId, action, notes });
      else if (action === "approve") {
        await captureManualPayment.mutateAsync({
          orderId: row.id,
          amount: String(row.expectedAmount ?? row.paidAmount ?? "").trim() || undefined,
        });
      } else {
        await denyPendingPaymentOrder.mutateAsync({ orderId: row.id, reason: notes || "Payment was not approved" });
      }
      showSuccessToast(toast, {
        title: action === "approve" ? "Payment approved" : "Payment rejected",
        message: action === "approve" ? "The order moved into the order status queue." : "The payment was denied.",
      });
    } catch (error) {
      showErrorToast(toast, { title: "Review failed", message: error instanceof Error ? error.message : "Could not review this payment." });
    }
  };

  const handleRefundAction = async (row: OrderRow, action: "mark_pending" | "mark_refunded" | "cancel") => {
    const amountPrompt = action === "cancel" ? undefined : window.prompt("Refund amount", String(row.paidAmount ?? row.expectedAmount ?? ""));
    if (amountPrompt === null) return;
    try {
      await updateRefundStatus.mutateAsync({ orderId: row.id, action, amount: action === "cancel" ? undefined : amountPrompt || undefined });
      showSuccessToast(toast, { title: "Refund updated", message: "The refund state was updated." });
    } catch (error) {
      showErrorToast(toast, { title: "Could not update refund", message: error instanceof Error ? error.message : "Refund update failed." });
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
      showSuccessToast(toast, { title: "Order updated", message: "The order status was updated." });
    } catch (error) {
      showErrorToast(toast, { title: "Could not update order", message: error instanceof Error ? error.message : "Order update failed." });
    }
  };

  const handleApproveDraftOrder = async (row: OrderRow) => {
    const supportTicketId = String(row.supportTicketId || "").trim();
    if (!supportTicketId) {
      showErrorToast(toast, { title: "Could not approve order", message: "This draft order is missing its linked ticket." });
      return;
    }
    try {
      await approveOrderTicket.mutateAsync({ id: supportTicketId });
      showSuccessToast(toast, { title: "Order approved", message: "The draft order was promoted." });
    } catch (error) {
      showErrorToast(toast, { title: "Could not approve order", message: error instanceof Error ? error.message : "Draft approval failed." });
    }
  };

  const handleReopenPaidOrder = async (row: OrderRow) => {
    if (!canReopenPaidOrderForPaymentReview(row)) {
      showErrorToast(toast, {
        title: "Cannot reopen payment review",
        message: "Only paid orders that have not entered delivery can be moved back into payment review.",
      });
      return;
    }
    const reason = window.prompt("Reason for reopening this paid order", "Payment approval was added by mistake");
    if (reason === null) return;
    try {
      await reopenPaidOrderForPaymentReview.mutateAsync({ orderId: row.id, reason: reason.trim() || undefined });
      showSuccessToast(toast, { title: "Moved back to payment queue", message: "The order is back under payment review." });
    } catch (error) {
      showErrorToast(toast, { title: "Could not reopen payment review", message: error instanceof Error ? error.message : "Reopening failed." });
    }
  };

  return (
    <div className="portal-detail-page-shell">
      {orderQuery.isLoading ? (
        <div className="portal-detail-page-empty">Loading order details...</div>
      ) : !order ? (
        <div className="portal-detail-page-empty">This order could not be found.</div>
      ) : (
        <div className="portal-workbench-grid">
          <main className="portal-workbench-main">
            <OrderWorkspaceDrawer
              key={`${order.id}:${String(order.updatedAt || "")}`}
              variant="page"
              mode={mode}
              title={modeTitle(mode)}
              order={order}
              onClose={() => router.push(backHref)}
              onApprovePayment={(row, paymentId) => handleReview(row, paymentId, "approve")}
              onRejectPayment={(row, paymentId) => handleReview(row, paymentId, "reject")}
              onUpdateDraftOrder={async (input) => {
                await updateDraftOrder.mutateAsync(input);
                showSuccessToast(toast, { title: "Draft order saved", message: "The manual order draft was updated." });
              }}
              onApproveDraftOrder={handleApproveDraftOrder}
              onUpdateFulfillment={handleFulfillmentUpdate}
              onUpdatePaymentSetup={async (input) => {
                await updatePaymentSetup.mutateAsync(input);
                const result = await sendPaymentDetails.mutateAsync({ orderId: input.orderId });
                showSuccessToast(toast, {
                  title: "Payment details saved",
                  message: result.ok
                    ? `Customer payment instructions sent by ${result.deliveryChannel}.`
                    : (result.error || "Payment details were saved, but delivery failed."),
                });
              }}
              onReopenPaidOrderForPaymentReview={handleReopenPaidOrder}
              onUpdateRefundStatus={handleRefundAction}
              busy={isBusy}
            />
          </main>
          <aside className="portal-workbench-thread">
            <InlineThreadPanel
              threadId={order.threadId}
              customerName={order.customerName || order.recipientName}
              customerPhone={order.customerPhone || order.recipientPhone}
              customerHref={
                order.customerPhone || order.recipientPhone
                  ? `/customers?phone=${encodeURIComponent(order.customerPhone || order.recipientPhone || "")}`
                  : null
              }
            />
          </aside>
        </div>
      )}
    </div>
  );
}

export default function OrderEntityWorkbenchRoute() {
  return <OrderEntityWorkbenchPage />;
}
