"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";
import { PortalDataTable } from "@/app/portal/components/PortalDataTable";
import { RowActionsMenu } from "@/app/portal/components/RowActionsMenu";
import { TablePagination } from "@/app/portal/components/TablePagination";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { normalizeOrderFlowSettings } from "@/lib/order-settings";
import {
  describeOrderFulfillmentNextAction,
  describeOrderFulfillmentState,
  formatOrderFulfillmentStatus,
  getFulfillmentProgress,
  normalizeOrderFulfillmentStatus,
  orderFulfillmentTone,
  type OrderFulfillmentStatus,
} from "@/lib/order-operations";
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
  fulfillmentStatus?: string | null;
  currency?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  shippingAddress?: string | null;
  deliveryArea?: string | null;
  deliveryNotes?: string | null;
  courierName?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  dispatchReference?: string | null;
  scheduledDeliveryAt?: Date | string | null;
  fulfillmentNotes?: string | null;
  packedAt?: Date | string | null;
  dispatchedAt?: Date | string | null;
  outForDeliveryAt?: Date | string | null;
  deliveredAt?: Date | string | null;
  failedDeliveryAt?: Date | string | null;
  returnedAt?: Date | string | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  paymentConfigSnapshot?: Record<string, unknown> | null;
  expectedAmount?: string | number | null;
  paidAmount?: string | number | null;
  refundAmount?: string | number | null;
  refundReason?: string | null;
  refundRequestedAt?: Date | string | null;
  refundedAt?: Date | string | null;
  ticketSnapshot?: Record<string, unknown> | null;
  botDisplayPhoneNumber?: string | null;
  lastInboundAt?: Date | string | null;
  whatsappWindowExpiresAt?: Date | string | null;
  whatsappWindowOpen?: boolean;
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
const PROGRESS_FLOW: OrderFulfillmentStatus[] = [
  "on_hold",
  "queued",
  "preparing",
  "packed",
  "dispatched",
  "out_for_delivery",
  "delivered",
];

const OPERATIONS_FILTERS = [
  { key: "all", label: "All Orders" },
  { key: "needs_action", label: "Needs Action" },
  { key: "on_hold", label: "On Hold" },
  { key: "active", label: "In Fulfilment" },
  { key: "in_transit", label: "In Transit" },
  { key: "delivered", label: "Delivered" },
  { key: "exceptions", label: "Exceptions" },
  { key: "refunds", label: "Refunds" },
] as const;

type OperationsFilterKey = (typeof OPERATIONS_FILTERS)[number]["key"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDateTimeLocalValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hour = String(parsed.getHours()).padStart(2, "0");
  const minute = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toIsoFromDateTimeLocal(value: string): string | undefined {
  const normalized = String(value || "").trim();
  if (!normalized) return undefined;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
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

function getFulfillmentStatus(order: OrderRow): OrderFulfillmentStatus {
  return normalizeOrderFulfillmentStatus(order.fulfillmentStatus);
}

function resolveOrderAmount(order: OrderRow): string | number | null | undefined {
  return order.paidAmount ?? order.refundAmount ?? order.expectedAmount;
}

function isManualCollectionOrder(order: OrderRow): boolean {
  const method = String(order.paymentMethod || "").toLowerCase();
  return method === "manual" || method === "cod";
}

function canRecordManualPayment(order: OrderRow): boolean {
  return isManualCollectionOrder(order) && getOrderStatus(order) === "approved";
}

function needsPaymentDetailsWorkflow(order: OrderRow): boolean {
  const method = String(order.paymentMethod || "").trim().toLowerCase();
  const status = getOrderStatus(order);
  return method === "bank_qr" && ["awaiting_payment", "payment_rejected"].includes(status);
}

function resolveWhatsAppWindowExpiresAt(order: OrderRow): Date | null {
  const parsed = order.whatsappWindowExpiresAt ? new Date(order.whatsappWindowExpiresAt) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function isWhatsAppWindowOpen(order: OrderRow, nowTs: number): boolean {
  const expiresAt = resolveWhatsAppWindowExpiresAt(order);
  if (expiresAt) return expiresAt.getTime() > nowTs;
  return Boolean(order.whatsappWindowOpen);
}

function formatCountdownParts(totalSeconds: number): string {
  const remaining = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${remaining % 60}s`;
}

function describeWhatsAppWindow(order: OrderRow, nowTs: number): string {
  const expiresAt = resolveWhatsAppWindowExpiresAt(order);
  if (!expiresAt) {
    return "No inbound customer reply recorded for this bot thread yet.";
  }
  const deltaSeconds = Math.round((expiresAt.getTime() - nowTs) / 1000);
  if (deltaSeconds > 0) {
    return `Window open for ${formatCountdownParts(deltaSeconds)} more.`;
  }
  return `Window closed ${formatCountdownParts(Math.abs(deltaSeconds))} ago.`;
}

function getStoredOrderSettings(order: OrderRow) {
  const snapshot = asRecord(order.paymentConfigSnapshot);
  return normalizeOrderFlowSettings({
    orderFlow: {
      ticketToOrderEnabled: true,
      paymentMethod: snapshot.paymentMethod ?? order.paymentMethod ?? "manual",
      currency: snapshot.currency ?? order.currency ?? "LKR",
      bankQr: asRecord(snapshot.bankQr),
    },
  });
}

function buildManualPaymentInstructions(order: OrderRow): string {
  const settings = getStoredOrderSettings(order);
  const bankQr = settings.bankQr;
  const botNumber = String(order.botDisplayPhoneNumber || "").trim();
  const orderReference = String(order.paymentReference || order.id.slice(0, 8).toUpperCase()).trim();
  const lines = [
    order.customerName ? `Hi ${order.customerName}, your order has been approved.` : "Your order has been approved.",
    `Order reference: ${orderReference}`,
    `Total due: ${formatMoney(settings.currency, order.expectedAmount)}`,
  ];
  if (bankQr.showBankDetails) {
    if (bankQr.bankName) lines.push(`Bank: ${bankQr.bankName}`);
    if (bankQr.accountName) lines.push(`Account name: ${bankQr.accountName}`);
    if (bankQr.accountNumber) lines.push(`Account number: ${bankQr.accountNumber}`);
    if (bankQr.accountInstructions) lines.push(bankQr.accountInstructions);
  }
  if (bankQr.showQr && bankQr.qrImageUrl) {
    lines.push(`QR: ${bankQr.qrImageUrl}`);
  }
  lines.push(
    botNumber
      ? `After payment, send the slip image or PDF to this bot number: ${botNumber}`
      : "After payment, send the slip image or PDF back to the same bot chat.",
  );
  lines.push(`Please include order reference ${orderReference} with the slip.`);
  return lines.join("\n");
}

function describeFinanceState(order: OrderRow, latestPayment?: OrderPaymentRow | null): string {
  const status = getOrderStatus(order);
  const method = String(order.paymentMethod || "").toLowerCase();
  if (status === "paid") return "Payment captured";
  if (status === "refund_pending") return "Refund pending";
  if (status === "refunded") return "Refunded";
  if (status === "payment_submitted") return "Payment review";
  if (status === "payment_rejected") return "Payment rejected";
  if (status === "awaiting_payment") return "Awaiting payment";
  if (status === "denied") return "Not approved";
  if (method === "manual") return "Manual collection";
  if (method === "cod") return "Cash on delivery";
  if (latestPayment?.aiCheckStatus) return `AI ${normalizeStatusLabel(latestPayment.aiCheckStatus)}`;
  return normalizeStatusLabel(status || method || "pending");
}

function financeTone(order: OrderRow): { color: string; background: string; border: string } {
  const status = getOrderStatus(order);
  if (status === "paid") {
    return {
      color: "#86efac",
      background: "rgba(34, 197, 94, 0.12)",
      border: "1px solid rgba(34, 197, 94, 0.28)",
    };
  }
  if (status === "payment_submitted") {
    return {
      color: "#fcd34d",
      background: "rgba(245, 158, 11, 0.12)",
      border: "1px solid rgba(245, 158, 11, 0.28)",
    };
  }
  if (status === "awaiting_payment" || status === "approved") {
    return {
      color: "#cbd5e1",
      background: "rgba(148, 163, 184, 0.12)",
      border: "1px solid rgba(148, 163, 184, 0.24)",
    };
  }
  if (status === "payment_rejected" || status === "denied" || status === "refunded") {
    return {
      color: "#fca5a5",
      background: "rgba(239, 68, 68, 0.12)",
      border: "1px solid rgba(239, 68, 68, 0.28)",
    };
  }
  return {
    color: "#fdba74",
    background: "rgba(249, 115, 22, 0.12)",
    border: "1px solid rgba(249, 115, 22, 0.28)",
  };
}

function getDeliverySummary(order: OrderRow): string {
  const area = String(order.deliveryArea || "").trim();
  const address = String(order.shippingAddress || "").trim();
  const courier = String(order.courierName || "").trim();
  const tracking = String(order.trackingNumber || order.dispatchReference || "").trim();
  if (courier && tracking) return `${courier} • ${tracking}`;
  if (courier) return courier;
  if (area && address) return `${area} • ${address}`;
  if (area) return area;
  if (address) return address;
  return "Missing delivery details";
}

function getDeliveryHint(order: OrderRow): string {
  if (order.trackingUrl) return "Tracking link available";
  if (order.scheduledDeliveryAt) return `Scheduled ${formatDate(order.scheduledDeliveryAt)}`;
  if (order.recipientName || order.recipientPhone) {
    return [order.recipientName, order.recipientPhone].filter(Boolean).join(" • ");
  }
  return "Add recipient, address, and courier details";
}

function orderNeedsAttention(order: OrderRow, latestPayment?: OrderPaymentRow | null): boolean {
  const status = getOrderStatus(order);
  const fulfillment = getFulfillmentStatus(order);
  if (status === "payment_submitted" || status === "payment_rejected") return true;
  if (fulfillment === "failed_delivery" || fulfillment === "returned") return true;
  if (fulfillment === "packed" && !order.courierName && !order.trackingNumber && !order.dispatchReference) return true;
  if (latestPayment?.status === "submitted") return true;
  return false;
}

function matchesOperationsFilter(order: OrderRow, latestPayment: OrderPaymentRow | null, filter: OperationsFilterKey): boolean {
  const status = getOrderStatus(order);
  const fulfillment = getFulfillmentStatus(order);
  if (filter === "all") return true;
  if (filter === "needs_action") return orderNeedsAttention(order, latestPayment);
  if (filter === "on_hold") return fulfillment === "on_hold";
  if (filter === "active") return ["queued", "preparing", "packed", "dispatched", "out_for_delivery"].includes(fulfillment);
  if (filter === "in_transit") return fulfillment === "dispatched" || fulfillment === "out_for_delivery";
  if (filter === "delivered") return fulfillment === "delivered";
  if (filter === "exceptions") return fulfillment === "failed_delivery" || fulfillment === "returned";
  if (filter === "refunds") return status === "refund_pending" || status === "refunded";
  return true;
}

function formatEventSummary(event: OrderEventRow): string | null {
  const payload = asRecord(event.payload);
  const candidates = [
    payload.notes,
    payload.note,
    payload.reason,
    payload.paymentStatus,
    payload.refundAmount,
    payload.trackingNumber,
  ];
  for (const value of candidates) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
}

function buildFulfillmentActions(order: OrderRow): Array<{ label: string; nextStatus: OrderFulfillmentStatus; tone?: "primary" | "ghost" }> {
  const fulfillment = getFulfillmentStatus(order);
  if (fulfillment === "on_hold" && getOrderStatus(order) === "paid") {
    return [{ label: "Release To Queue", nextStatus: "queued", tone: "primary" }];
  }
  if (fulfillment === "queued") {
    return [{ label: "Start Preparing", nextStatus: "preparing", tone: "primary" }];
  }
  if (fulfillment === "preparing") {
    return [{ label: "Mark Packed", nextStatus: "packed", tone: "primary" }];
  }
  if (fulfillment === "packed") {
    return [{ label: "Dispatch Order", nextStatus: "dispatched", tone: "primary" }];
  }
  if (fulfillment === "dispatched") {
    return [
      { label: "Out For Delivery", nextStatus: "out_for_delivery", tone: "primary" },
      { label: "Failed Delivery", nextStatus: "failed_delivery", tone: "ghost" },
    ];
  }
  if (fulfillment === "out_for_delivery") {
    return [
      { label: "Mark Delivered", nextStatus: "delivered", tone: "primary" },
      { label: "Failed Delivery", nextStatus: "failed_delivery", tone: "ghost" },
    ];
  }
  if (fulfillment === "failed_delivery") {
    return [
      { label: "Re-Queue", nextStatus: "queued", tone: "primary" },
      { label: "Mark Returned", nextStatus: "returned", tone: "ghost" },
    ];
  }
  if (fulfillment === "delivered") {
    return [{ label: "Mark Returned", nextStatus: "returned", tone: "ghost" }];
  }
  return [];
}

export default function OrdersPage() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<OperationsFilterKey>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [nowTs, setNowTs] = useState(() => Date.now());
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
  const updateFulfillment = trpc.orders.updateFulfillment.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.listOrders.invalidate(),
        utils.orders.getStats.invalidate(),
        utils.orders.getOrderEvents.invalidate(),
      ]);
    },
  });
  const captureManualPayment = trpc.orders.captureManualPayment.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.listOrders.invalidate(),
        utils.orders.getStats.invalidate(),
        utils.orders.getOrderEvents.invalidate(),
      ]);
    },
  });
  const sendPaymentDetails = trpc.orders.sendPaymentDetails.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.listOrders.invalidate(),
        utils.orders.getOrderEvents.invalidate(),
      ]);
    },
  });

  useEffect(() => {
    const timerId = window.setInterval(() => setNowTs(Date.now()), 30_000);
    return () => window.clearInterval(timerId);
  }, []);

  useLivePortalEvents({
    orderListInput: { limit: 500 },
    refreshOrderStats: true,
    activeOrderId: selectedOrderId,
  });

  const orders = useMemo(() => (ordersQuery.data?.items ?? []) as OrderRow[], [ordersQuery.data?.items]);
  const selectedOrder = useMemo(
    () => (selectedOrderId ? orders.find((entry) => entry.id === selectedOrderId) ?? null : null),
    [orders, selectedOrderId],
  );

  const metrics = useMemo(() => {
    let needsAction = 0;
    let inFulfilment = 0;
    let inTransit = 0;
    let delivered = 0;
    let exceptions = 0;

    for (const order of orders) {
      const latestPayment = order.latestPayment ?? null;
      const fulfillment = getFulfillmentStatus(order);
      if (orderNeedsAttention(order, latestPayment)) needsAction += 1;
      if (["queued", "preparing", "packed", "dispatched", "out_for_delivery"].includes(fulfillment)) inFulfilment += 1;
      if (fulfillment === "dispatched" || fulfillment === "out_for_delivery") inTransit += 1;
      if (fulfillment === "delivered") delivered += 1;
      if (fulfillment === "failed_delivery" || fulfillment === "returned") exceptions += 1;
    }

    return {
      needsAction,
      inFulfilment,
      inTransit,
      delivered,
      exceptions,
    };
  }, [orders]);

  const filterCounts = useMemo<Record<OperationsFilterKey, number>>(() => {
    const counts: Record<OperationsFilterKey, number> = {
      all: orders.length,
      needs_action: 0,
      on_hold: 0,
      active: 0,
      in_transit: 0,
      delivered: 0,
      exceptions: 0,
      refunds: 0,
    };
    for (const order of orders) {
      const latestPayment = order.latestPayment ?? null;
      for (const filter of OPERATIONS_FILTERS) {
        if (filter.key === "all") continue;
        if (matchesOperationsFilter(order, latestPayment, filter.key)) counts[filter.key] += 1;
      }
    }
    return counts;
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return orders.filter((order) => {
      const latestPayment = order.latestPayment ?? null;
      if (!matchesOperationsFilter(order, latestPayment, activeFilter)) return false;
      if (!needle) return true;
      return [
        order.id,
        order.paymentReference,
        order.customerName,
        order.customerPhone,
        order.recipientName,
        order.recipientPhone,
        order.shippingAddress,
        order.deliveryArea,
        order.courierName,
        order.trackingNumber,
        order.dispatchReference,
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .some((value) => value.includes(needle));
    });
  }, [activeFilter, orders, search]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filteredOrders.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

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

  if (ordersQuery.data && !ordersQuery.data.settings.ticketToOrderEnabled) {
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
    <PortalDataTable
      search={{
        value: search,
        onChange: (value) => {
          setSearch(value);
          setPage(0);
        },
        placeholder: "Search by order, customer, courier, tracking, or address...",
        style: { width: "min(620px, 58vw)", minWidth: 240, flex: "0 1 620px" },
      }}
      countText={`${filteredOrders.length} order${filteredOrders.length !== 1 ? "s" : ""}`}
      footer={(
        <TablePagination
          page={safePage}
          totalPages={totalPages}
          shownCount={pageRows.length}
          totalCount={filteredOrders.length}
          canPrev={safePage > 0}
          canNext={safePage < totalPages - 1}
          onPrev={() => setPage((current) => Math.max(0, current - 1))}
          onNext={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
        />
      )}
    >
      <div className="card" style={{ marginBottom: 12, overflow: "hidden" }}>
        <div
          className="card-body"
          style={{
            padding: "18px 18px 20px",
            display: "grid",
            gap: 14,
            background:
              "radial-gradient(circle at top right, rgba(184, 134, 11, 0.18), transparent 38%), linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(11, 18, 32, 0.92))",
          }}
        >
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>Order Operations</div>
            <div className="text-muted" style={{ fontSize: 13, maxWidth: 760 }}>
              Approve payment, capture manual collections, control fulfilment, and keep customers updated from one workflow.
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))",
              gap: 10,
            }}
          >
            <SummaryCard label="Needs Action" value={String(metrics.needsAction)} />
            <SummaryCard label="In Fulfilment" value={String(metrics.inFulfilment)} />
            <SummaryCard label="In Transit" value={String(metrics.inTransit)} />
            <SummaryCard label="Delivered" value={String(metrics.delivered)} />
            <SummaryCard label="Exceptions" value={String(metrics.exceptions)} />
            <SummaryCard
              label="Gross Collected"
              value={formatMoney(ordersQuery.data?.settings.currency, statsQuery.data?.grossCollectedAmount ?? 0)}
            />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ padding: "12px 14px", display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 2 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Operations Views</div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              Switch between payment review, active fulfilment, delivery exceptions, and completed orders.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {OPERATIONS_FILTERS.map((filter) => {
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
              <th style={{ textAlign: "left", width: "13%" }}>Order</th>
              <th style={{ textAlign: "left", width: "15%" }}>Customer</th>
              <th style={{ textAlign: "left", width: "20%" }}>Items</th>
              <th style={{ textAlign: "left", width: "13%" }}>Finance</th>
              <th style={{ textAlign: "left", width: "15%" }}>Fulfilment</th>
              <th style={{ textAlign: "left", width: "16%" }}>Delivery</th>
              <th style={{ textAlign: "left", width: "5%" }}>Updated</th>
              <th style={{ textAlign: "center", width: "3%" }} />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((order) => {
              const snapshot = asRecord(order.ticketSnapshot);
              const latestPayment = order.latestPayment ?? null;
              const fulfillment = getFulfillmentStatus(order);
              return (
                <tr key={order.id} onClick={() => setSelectedOrderId(order.id)} style={{ cursor: "pointer" }}>
                  <td>
                    <div style={{ display: "grid", gap: 3 }}>
                      <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700 }}>#{shortId(order.id)}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{order.paymentReference || "-"}</div>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "grid", gap: 3 }}>
                      <div>{order.customerName || order.recipientName || order.customerPhone || "-"}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>
                        {order.recipientPhone || order.customerPhone || "No phone"}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span style={{ display: "block", whiteSpace: "normal", wordBreak: "break-word", fontSize: 13 }}>
                      {formatOrderItems(snapshot)}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontWeight: 600 }}>{formatMoney(order.currency, resolveOrderAmount(order))}</span>
                      <span
                        style={{
                          ...financeTone(order),
                          padding: "4px 10px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          display: "inline-flex",
                          width: "fit-content",
                          textTransform: "uppercase",
                        }}
                      >
                        {describeFinanceState(order, latestPayment)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "grid", gap: 4 }}>
                      <span
                        style={{
                          ...orderFulfillmentTone(fulfillment),
                          padding: "4px 10px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          display: "inline-flex",
                          width: "fit-content",
                        }}
                      >
                        {formatOrderFulfillmentStatus(fulfillment)}
                      </span>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>
                        {describeOrderFulfillmentNextAction(fulfillment)}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "grid", gap: 3 }}>
                      <div style={{ whiteSpace: "normal", wordBreak: "break-word", fontSize: 13 }}>
                        {getDeliverySummary(order)}
                      </div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{getDeliveryHint(order)}</div>
                    </div>
                  </td>
                  <td style={{ fontSize: 12 }}>{formatDate(order.updatedAt)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <RowActionsMenu
                      items={[
                        { label: "Open Details", onSelect: () => setSelectedOrderId(order.id) },
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
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", padding: "24px 10px", color: "var(--muted)" }}>
                  No orders match this operations view.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
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
    </PortalDataTable>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="card"
      style={{
        background: "rgba(15, 23, 42, 0.82)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
      }}
    >
      <div className="card-body" style={{ padding: "12px 14px" }}>
        <div className="text-muted" style={{ fontSize: 11 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div>
      </div>
    </div>
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
      <div className="drawer open">
        <div className="drawer-header">
          <h3 className="drawer-title">Order Operations</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close details">
            x
          </button>
        </div>
        <div className="drawer-body">
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            <div
              className="card"
              style={{
                overflow: "hidden",
                background:
                  "radial-gradient(circle at top right, rgba(184, 134, 11, 0.12), transparent 35%), linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(15, 23, 42, 0.88))",
              }}
            >
              <div className="card-body" style={{ display: "grid", gap: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--muted)" }}>
                      #{shortId(order.id)} ({order.id})
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>
                      {order.customerName || order.recipientName || "Unassigned customer"}
                    </div>
                    <div className="text-muted" style={{ fontSize: 13 }}>
                      {formatOrderItems(snapshot)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                    <StatusPill
                      label={describeFinanceState(order, latestPayment)}
                      tone={financeTone(order)}
                    />
                    <StatusPill
                      label={formatOrderFulfillmentStatus(fulfillment)}
                      tone={orderFulfillmentTone(fulfillment)}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <Detail label="Order Reference" value={order.paymentReference || "-"} />
                  <Detail label="Payment Method" value={normalizeStatusLabel(order.paymentMethod)} />
                  <Detail label="Amount" value={formatMoney(order.currency, resolveOrderAmount(order))} />
                  <Detail label="Updated" value={formatDate(order.updatedAt)} />
                  <Detail label="Delivery" value={getDeliverySummary(order)} />
                  <Detail label="Next Action" value={describeOrderFulfillmentNextAction(fulfillment)} />
                </div>
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
                        tone={paymentWindowTone}
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

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: { color: string; background: string; border: string };
}) {
  return (
    <span
      style={{
        ...tone,
        padding: "6px 12px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        display: "inline-flex",
        width: "fit-content",
      }}
    >
      {label}
    </span>
  );
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
    <label style={{ display: "grid", gap: 6 }}>
      <span className="text-muted" style={{ fontSize: 12 }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        style={{
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "10px 12px",
          background: "rgba(15, 23, 42, 0.65)",
          color: "var(--foreground)",
        }}
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
    <label style={{ display: "grid", gap: 6 }}>
      <span className="text-muted" style={{ fontSize: 12 }}>{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        style={{
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "10px 12px",
          background: "rgba(15, 23, 42, 0.65)",
          color: "var(--foreground)",
          resize: "vertical",
        }}
      />
    </label>
  );
}
