"use client";

import { useMemo, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";
import { PortalSelect } from "@/app/portal/components/PortalSelect";
import { trpc } from "@/utils/trpc";

const PRIORITY_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
] as const;

const LONG_FIELD_KEYS = new Set(["details", "reason", "issue", "summary", "description"]);
const CONTACT_FIELD_KEYS = new Set(["name", "customername", "phone", "customerphone", "email", "customeremail"]);

function normalizeFieldKey(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function formatFieldLabel(value: string): string {
  const normalized = normalizeFieldKey(value);
  if (normalized === "orderid") return "Order ID";
  if (normalized === "warrantynumber") return "Warranty Number";
  if (normalized === "customername") return "Customer Name";
  if (normalized === "customerphone") return "Customer Phone";
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\w\S*/g, (part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
}

function defaultTitle(typeLabel: string, customerName: string, customerPhone: string): string {
  const subject = customerName.trim() || customerPhone.trim() || "manual ticket";
  return `${typeLabel} - ${subject}`;
}

export function ManualSupportTicketLauncher({
  ticketTypeKey,
  ticketTypeLabel,
  requiredFields,
  onCreated,
}: {
  ticketTypeKey: string;
  ticketTypeLabel: string;
  requiredFields: string[];
  onCreated?: (ticketId: string) => void;
}) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [priority, setPriority] = useState<(typeof PRIORITY_OPTIONS)[number]["value"]>("normal");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  const visibleRequiredFields = useMemo(
    () =>
      requiredFields
        .map((field) => String(field || "").trim())
        .filter((field) => field && !CONTACT_FIELD_KEYS.has(normalizeFieldKey(field))),
    [requiredFields],
  );

  const resetForm = () => {
    setPriority("normal");
    setCustomerName("");
    setCustomerPhone("");
    setTitle("");
    setSummary("");
    setNotes("");
    setFieldValues({});
  };

  const createTicket = trpc.tickets.createTicket.useMutation({
    onSuccess: async (ticket) => {
      await Promise.all([
        utils.tickets.listTickets.invalidate(),
        utils.tickets.listTicketLedger.invalidate(),
        utils.tickets.getTicketById.invalidate(),
        utils.tickets.getPerformance.invalidate(),
      ]);
      showSuccessToast(toast, {
        title: "Ticket created",
        message: `${ticketTypeLabel} ticket is now in the ledger.`,
      });
      setOpen(false);
      resetForm();
      if (ticket?.id) onCreated?.(ticket.id);
    },
    onError: (error) => {
      showErrorToast(toast, {
        title: "Could not create ticket",
        message: error.message || "Manual ticket creation failed.",
      });
    },
  });

  const submit = () => {
    for (const field of visibleRequiredFields) {
      if (!String(fieldValues[field] || "").trim()) {
        showErrorToast(toast, {
          title: `${formatFieldLabel(field)} required`,
          message: "Fill the required ticket detail before creating it.",
        });
        return;
      }
    }
    const fields: Record<string, unknown> = {
      staff_created: true,
      manual_ticket: true,
      ...(customerName.trim() ? { name: customerName.trim(), customer_name: customerName.trim() } : {}),
      ...(customerPhone.trim() ? { phone: customerPhone.trim(), customer_phone: customerPhone.trim() } : {}),
    };
    for (const field of visibleRequiredFields) {
      const value = String(fieldValues[field] || "").trim();
      if (value) fields[field] = value;
    }
    const normalizedSummary =
      summary.trim() ||
      visibleRequiredFields
        .map((field) => String(fieldValues[field] || "").trim())
        .filter(Boolean)
        .join(" | ");

    createTicket.mutate({
      ticketTypeKey,
      title: title.trim() || defaultTitle(ticketTypeLabel, customerName, customerPhone),
      summary: normalizedSummary || undefined,
      priority,
      source: "staff_manual",
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      fields,
      notes: notes.trim() || undefined,
      createdBy: "user",
    });
  };

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        New {ticketTypeLabel}
      </button>
      {open ? (
        <>
          <div className="drawer-backdrop open" onClick={() => !createTicket.isPending && setOpen(false)} />
          <div className="portal-modal-shell">
            <div className="portal-modal-card" style={{ width: "min(560px, calc(100vw - 32px))" }}>
              <div className="portal-modal-card__body">
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>New {ticketTypeLabel}</div>
                  <div className="text-muted" style={{ fontSize: 13 }}>
                    Create a staff-entered ticket for this support queue.
                  </div>
                </div>

                <div className="portal-form-grid">
                  <label className="portal-field">
                    <span className="portal-field-label">Priority</span>
                    <PortalSelect
                      value={priority}
                      onValueChange={(value) => setPriority(value as typeof priority)}
                      options={PRIORITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                      ariaLabel="Manual ticket priority"
                    />
                  </label>
                  <label className="portal-field">
                    <span className="portal-field-label">Customer Phone</span>
                    <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="+947..." />
                  </label>
                  <label className="portal-field">
                    <span className="portal-field-label">Customer Name</span>
                    <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Optional" />
                  </label>
                  <label className="portal-field">
                    <span className="portal-field-label">Title</span>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={defaultTitle(ticketTypeLabel, customerName, customerPhone)} />
                  </label>
                  {visibleRequiredFields.map((field) => {
                    const normalized = normalizeFieldKey(field);
                    const isLong = LONG_FIELD_KEYS.has(normalized);
                    return (
                      <label key={field} className={isLong ? "portal-field portal-field--full" : "portal-field"}>
                        <span className="portal-field-label">{formatFieldLabel(field)}</span>
                        {isLong ? (
                          <textarea
                            value={fieldValues[field] ?? ""}
                            onChange={(e) => setFieldValues((prev) => ({ ...prev, [field]: e.target.value }))}
                            placeholder={formatFieldLabel(field)}
                            style={{ minHeight: 84, resize: "vertical" }}
                          />
                        ) : (
                          <input
                            value={fieldValues[field] ?? ""}
                            onChange={(e) => setFieldValues((prev) => ({ ...prev, [field]: e.target.value }))}
                            placeholder={formatFieldLabel(field)}
                          />
                        )}
                      </label>
                    );
                  })}
                  <label className="portal-field portal-field--full">
                    <span className="portal-field-label">Summary</span>
                    <textarea
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                      placeholder="Optional summary for the ledger"
                      style={{ minHeight: 78, resize: "vertical" }}
                    />
                  </label>
                  <label className="portal-field portal-field--full">
                    <span className="portal-field-label">Internal Notes</span>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Optional staff notes"
                      style={{ minHeight: 78, resize: "vertical" }}
                    />
                  </label>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button type="button" className="btn btn-ghost" disabled={createTicket.isPending} onClick={() => setOpen(false)}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary" disabled={createTicket.isPending} onClick={submit}>
                    {createTicket.isPending ? "Creating..." : "Create Ticket"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
