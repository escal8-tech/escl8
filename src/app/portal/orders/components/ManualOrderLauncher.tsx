"use client";

import { useMemo, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";
import { PortalSelect } from "@/app/portal/components/PortalSelect";
import { trpc } from "@/utils/trpc";

type ManualOrderLine = {
  item: string;
  quantity: string;
  unitPrice: string;
};

const CHANNEL_OPTIONS = [
  { value: "walkin", label: "Walk-in" },
  { value: "phone", label: "Phone call" },
  { value: "website", label: "Website" },
  { value: "other", label: "Other" },
] as const;

const PRIORITY_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
] as const;

function cleanMoney(value: string): number | null {
  const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function lineTotal(line: ManualOrderLine): number | null {
  const price = cleanMoney(line.unitPrice);
  if (price == null) return null;
  const qty = Math.max(1, Number(String(line.quantity || "1").replace(/[^\d]/g, "") || "1"));
  return price * qty;
}

export function ManualOrderLauncher({
  onCreated,
  buttonLabel = "New Manual Order",
}: {
  onCreated?: (ticketId: string) => void;
  buttonLabel?: string;
}) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<(typeof CHANNEL_OPTIONS)[number]["value"]>("walkin");
  const [priority, setPriority] = useState<(typeof PRIORITY_OPTIONS)[number]["value"]>("urgent");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [deliveryArea, setDeliveryArea] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [total, setTotal] = useState("");
  const [lines, setLines] = useState<ManualOrderLine[]>([
    { item: "", quantity: "1", unitPrice: "" },
  ]);

  const computedTotal = useMemo(() => {
    let sum = 0;
    for (const line of lines) {
      const totalValue = lineTotal(line);
      if (totalValue == null) return "";
      sum += totalValue;
    }
    return lines.some((line) => line.item.trim()) ? sum.toFixed(2) : "";
  }, [lines]);

  const resetForm = () => {
    setChannel("walkin");
    setPriority("urgent");
    setCustomerName("");
    setCustomerPhone("");
    setCustomerEmail("");
    setDeliveryArea("");
    setShippingAddress("");
    setNotes("");
    setTotal("");
    setLines([{ item: "", quantity: "1", unitPrice: "" }]);
  };

  const createManualOrder = trpc.tickets.createManualOrderTicket.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.tickets.listTicketLedger.invalidate(),
        utils.tickets.getTicketById.invalidate(),
        utils.tickets.getPerformance.invalidate(),
        utils.customers.listPage.invalidate(),
        utils.requests.listPage.invalidate(),
        utils.orders.listOrdersPage.invalidate(),
        utils.orders.getOverview.invalidate(),
      ]);
      showSuccessToast(toast, {
        title: "Manual order created",
        message: "The order is in Pending Approval and will not send customer WhatsApp messages.",
      });
      setOpen(false);
      resetForm();
      if (result.ticket?.id) onCreated?.(result.ticket.id);
    },
    onError: (error) => {
      showErrorToast(toast, {
        title: "Could not create manual order",
        message: error.message || "Manual order creation failed.",
      });
    },
  });

  const submit = () => {
    const validLines = lines
      .map((line) => ({
        item: line.item.trim(),
        quantity: line.quantity.trim() || "1",
        unitPrice: line.unitPrice.trim() || undefined,
      }))
      .filter((line) => line.item);
    if (!customerName.trim()) {
      showErrorToast(toast, { title: "Customer name required", message: "Add the walk-in or caller name first." });
      return;
    }
    if (!validLines.length) {
      showErrorToast(toast, { title: "Order item required", message: "Add at least one item before creating the order." });
      return;
    }
    createManualOrder.mutate({
      channel,
      priority,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || undefined,
      customerEmail: customerEmail.trim() || undefined,
      deliveryArea: deliveryArea.trim() || undefined,
      shippingAddress: shippingAddress.trim() || undefined,
      notes: notes.trim() || undefined,
      total: total.trim() || computedTotal || undefined,
      lineItems: validLines,
    });
  };

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        {buttonLabel}
      </button>
      {open ? (
        <>
          <div className="drawer-backdrop open" onClick={() => !createManualOrder.isPending && setOpen(false)} />
          <div className="portal-modal-shell">
            <div className="portal-modal-card portal-manual-order-modal">
              <div className="portal-modal-card__body">
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>New manual order</div>
                  <div className="text-muted" style={{ fontSize: 13 }}>
                    Staff-created orders stay internal. No WhatsApp payment or approval message is sent to the customer.
                  </div>
                </div>

                <div className="portal-form-grid">
                  <label className="portal-field">
                    <span className="portal-field-label">Channel</span>
                    <PortalSelect
                      value={channel}
                      onValueChange={(value) => setChannel(value as typeof channel)}
                      options={CHANNEL_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                      ariaLabel="Manual order channel"
                    />
                  </label>
                  <label className="portal-field">
                    <span className="portal-field-label">Priority</span>
                    <PortalSelect
                      value={priority}
                      onValueChange={(value) => setPriority(value as typeof priority)}
                      options={PRIORITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                      ariaLabel="Manual order priority"
                    />
                  </label>
                  <label className="portal-field">
                    <span className="portal-field-label">Customer Name</span>
                    <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name" />
                  </label>
                  <label className="portal-field">
                    <span className="portal-field-label">Phone</span>
                    <input type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="+947..." />
                  </label>
                  <label className="portal-field">
                    <span className="portal-field-label">Email</span>
                    <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="Optional" />
                  </label>
                  <label className="portal-field">
                    <span className="portal-field-label">Delivery Area</span>
                    <input type="text" value={deliveryArea} onChange={(e) => setDeliveryArea(e.target.value)} placeholder="Optional" />
                  </label>
                  <label className="portal-field portal-field--full">
                    <span className="portal-field-label">Shipping / Pickup Notes</span>
                    <textarea
                      value={shippingAddress}
                      onChange={(e) => setShippingAddress(e.target.value)}
                      placeholder="Delivery address, pickup note, or call instructions"
                      style={{ minHeight: 72, resize: "vertical" }}
                    />
                  </label>
                </div>

                <div className="portal-manual-order-items">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div className="portal-field-label">Order Items</div>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setLines((prev) => [...prev, { item: "", quantity: "1", unitPrice: "" }])}
                    >
                      Add Item
                    </button>
                  </div>
                  {lines.map((line, index) => (
                    <div key={index} className="portal-manual-order-line">
                      <input
                        type="text"
                        value={line.item}
                        onChange={(e) => {
                          const value = e.target.value;
                          setLines((prev) => prev.map((entry, idx) => idx === index ? { ...entry, item: value } : entry));
                        }}
                        placeholder="Item"
                      />
                      <input
                        type="number"
                        min="1"
                        value={line.quantity}
                        onChange={(e) => {
                          const value = e.target.value;
                          setLines((prev) => prev.map((entry, idx) => idx === index ? { ...entry, quantity: value } : entry));
                        }}
                        placeholder="Qty"
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(e) => {
                          const value = e.target.value;
                          setLines((prev) => prev.map((entry, idx) => idx === index ? { ...entry, unitPrice: value } : entry));
                        }}
                        placeholder="Unit price"
                      />
                      <button
                        type="button"
                        className="portal-ledger-action portal-ledger-action--reject portal-manual-order-remove"
                        aria-label="Remove item"
                        title="Remove item"
                        disabled={lines.length === 1}
                        onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== index))}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M3 6h18" />
                          <path d="M8 6V4h8v2" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v5" />
                          <path d="M14 11v5" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>

                <div className="portal-form-grid">
                  <label className="portal-field">
                    <span className="portal-field-label">Total</span>
                    <input type="number" min="0" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} placeholder={computedTotal || "Optional"} />
                  </label>
                  <label className="portal-field">
                    <span className="portal-field-label">Internal Notes</span>
                    <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
                  </label>
                </div>

                <div className="portal-manual-order-footer">
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    {computedTotal ? `Computed total: ${computedTotal}` : "Payment will be handled by staff in-house."}
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button type="button" className="btn btn-ghost" disabled={createManualOrder.isPending} onClick={() => setOpen(false)}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn-primary" disabled={createManualOrder.isPending} onClick={submit}>
                      {createManualOrder.isPending ? "Creating..." : "Create Order"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
