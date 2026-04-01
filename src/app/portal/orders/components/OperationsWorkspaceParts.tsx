"use client";

import { useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";
import { trpc } from "@/utils/trpc";
import {
  asRecord,
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
  type OrderEventRow,
  type OrderPaymentRow,
  type OrderRow,
} from "@/app/portal/orders/lib/orderPageUtils";
import { type OrderFulfillmentStatus } from "@/lib/order-operations";

type OperationsWorkspaceMode = "payments" | "status" | "revenue";

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

function canStaffApprovePayment(order: OrderRow, latestPayment: OrderPaymentRow | null): boolean {
  if (!latestPayment || latestPayment.status !== "submitted") return false;
  const paymentMethod = String(order.paymentMethod || "").trim().toLowerCase();
  if (paymentMethod === "manual" || paymentMethod === "cod") return true;
  return Boolean(latestPayment.aiCheckStatus && latestPayment.aiCheckStatus !== "needs_review");
}

export function PaymentsTable({
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
          const canApprove = canStaffApprovePayment(order, latestPayment);
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
                    <button type="button" className="btn btn-primary portal-button--success" disabled={busy} onClick={() => void onRecordManualPayment(order)}>
                      Mark Paid
                    </button>
                  ) : null}
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

export function StatusTable({
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
    <table className="table table-clickable portal-modern-table portal-ledger-table portal-mobile-cards" style={{ width: "100%", tableLayout: "auto" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left" }}>Order</th>
          <th style={{ textAlign: "left" }}>Customer</th>
          <th style={{ textAlign: "left" }}>Items</th>
          <th style={{ textAlign: "left" }}>Status</th>
          <th style={{ textAlign: "left" }}>Delivery</th>
          <th style={{ textAlign: "left" }}>Updated</th>
          <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>Action</th>
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

export function RevenueTable({
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

export function OrderWorkspaceDrawer({
  mode,
  title,
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
  title: string;
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
  const showPaymentSetup = mode === "payments";
  const showDeliveryDetails = mode === "status";
  const showInvoicePanel = mode !== "status";
  const canApproveLatestPayment = canStaffApprovePayment(order, latestPayment);

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
              <div className="portal-drawer-eyebrow">{title}</div>
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
            {showPaymentSetup ? (
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
            ) : null}

            {showDeliveryDetails ? (
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
            ) : null}

            <div className="card">
              <div className="card-body" style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {mode === "payments" ? "Payment Actions" : "Transaction And Refund"}
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {mode === "payments" && latestPayment?.status === "submitted" ? (
                    <>
                      <button type="button" className="btn btn-primary" disabled={busy || !canApproveLatestPayment} onClick={() => void onApprovePayment(latestPayment.id, "approve")}>Approve Payment</button>
                      <button type="button" className="btn btn-ghost" disabled={busy || !canApproveLatestPayment} onClick={() => void onRejectPayment(latestPayment.id, "reject")}>Deny Payment</button>
                    </>
                  ) : null}
                  {mode === "payments" && canRecordManualPayment(order) ? (
                    <button type="button" className="btn btn-primary portal-button--success" disabled={busy} onClick={() => void onRecordManualPayment(order)}>Mark Paid Manually</button>
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
                {mode === "payments" && latestPayment?.status === "submitted" && !canApproveLatestPayment ? (
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    Bank and QR payments stay locked until the AI proof check finishes. Manual collection can still be approved by staff.
                  </div>
                ) : null}
                {latestPayment?.proofUrl ? (
                  <a href={latestPayment.proofUrl} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ width: "fit-content" }}>
                    Open Latest Proof
                  </a>
                ) : (
                  <div className="text-muted" style={{ fontSize: 12 }}>No payment proof uploaded yet.</div>
                )}
              </div>
            </div>

            {showInvoicePanel ? (
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
            ) : null}

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
