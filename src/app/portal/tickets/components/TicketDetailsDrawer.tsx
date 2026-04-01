"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ToastProvider";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";
import { TableSelect } from "@/app/portal/components/TableToolbarControls";
import {
  LOSS_REASON_OPTIONS,
  OUTCOME_OPTIONS,
  applyOrderEditorToFields,
  buildOrderEditorLines,
  canApproveOrderStage,
  canDenyOrderStage,
  computeOrderEditorLineTotal,
  computeOrderEditorTotal,
  firstFieldText,
  formatDate,
  formatFieldValue,
  formatOrderStage,
  formatSlaCountdown,
  formatStatus,
  getImportantFieldRows,
  getTicketFields,
  getTicketString,
  getTicketValue,
  isOrderTicketRow,
  orderStagePillClass,
  priorityPillClass,
  resolveOrderStage,
  shortId,
  toDateTimeLocalValue,
  type OrderEditorLine,
  type TicketEventRow,
  type TicketOutcome,
  type TicketRow,
} from "@/app/portal/tickets/lib/ticketPageUtils";
import { trpc } from "@/utils/trpc";

function toMutationDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const normalized = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(normalized.getTime()) ? undefined : normalized;
}

export function TicketDetailsDrawer({
  ticket,
  onClose,
  threadHref,
  nowMs,
  onApproveOrderTicket,
  onDenyOrderTicket,
  orderActionPending,
}: {
  ticket: TicketRow | null;
  onClose: () => void;
  threadHref: string;
  nowMs: number;
  onApproveOrderTicket: (ticket: TicketRow) => Promise<void>;
  onDenyOrderTicket: (ticket: TicketRow) => void;
  orderActionPending: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [updatingOutcome, setUpdatingOutcome] = useState(false);
  const [updatingSla, setUpdatingSla] = useState(false);
  const [savingTicket, setSavingTicket] = useState(false);
  const ticketId = ticket?.id ?? "";
  const updateOutcome = trpc.tickets.updateTicketOutcome.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.tickets.listTickets.invalidate(),
        utils.tickets.listTicketLedger.invalidate(),
        utils.tickets.getTicketById.invalidate(),
        utils.tickets.getPerformance.invalidate(),
      ]);
      showSuccessToast(toast, {
        title: "Outcome updated",
        message: "Ticket outcome saved successfully.",
      });
    },
    onError: (error) => {
      showErrorToast(toast, {
        title: "Update failed",
        message: error.message || "Ticket outcome could not be saved.",
      });
    },
    onSettled: () => setUpdatingOutcome(false),
  });
  const updateSlaDueAt = trpc.tickets.updateTicketSlaDueAt.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.tickets.listTickets.invalidate(),
        utils.tickets.listTicketLedger.invalidate(),
        utils.tickets.getTicketById.invalidate(),
        utils.tickets.listTicketEvents.invalidate(),
        utils.tickets.getPerformance.invalidate(),
      ]);
      showSuccessToast(toast, {
        title: "SLA updated",
        message: "Ticket SLA saved successfully.",
      });
    },
    onError: (error) => {
      showErrorToast(toast, {
        title: "Update failed",
        message: error.message || "Ticket SLA could not be saved.",
      });
    },
    onSettled: () => setUpdatingSla(false),
  });
  const updateTicket = trpc.tickets.updateTicket.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.tickets.listTickets.invalidate(),
        utils.tickets.listTicketLedger.invalidate(),
        utils.tickets.getTicketById.invalidate(),
        utils.tickets.listTicketEvents.invalidate(),
      ]);
      showSuccessToast(toast, {
        title: "Ticket updated",
        message: "Ticket details saved successfully.",
      });
    },
    onError: (error) => {
      showErrorToast(toast, {
        title: "Save failed",
        message: error.message || "Ticket details could not be saved.",
      });
    },
    onSettled: () => setSavingTicket(false),
  });
  const eventsQuery = trpc.tickets.listTicketEvents.useQuery(
    { ticketId, limit: 80 },
    { enabled: Boolean(ticketId) },
  );
  const slaDueAtRaw = ticket
    ? (getTicketValue(ticket, "slaDueAt", "sla_due_at") as Date | string | null | undefined)
    : null;
  const fields = ticket ? getTicketFields(ticket) : {};
  const initialCustomerName = ticket
    ? (
        firstFieldText(fields, ["name", "customerName", "customer_name"]) ||
        getTicketString(ticket, "customerName", "customer_name")
      )
    : "";
  const initialCustomerPhone = ticket
    ? (
        firstFieldText(fields, ["contact", "phone", "phoneNumber", "mobile", "whatsapp", "customerPhone"]) ||
        getTicketString(ticket, "customerPhone", "customer_phone")
      )
    : "";
  const initialCustomerEmail = ticket
    ? firstFieldText(fields, ["email", "customerEmail", "customer_email"])
    : "";
  const [slaInput, setSlaInput] = useState(() => toDateTimeLocalValue(slaDueAtRaw));
  const [draftTitle, setDraftTitle] = useState(() => ticket?.title || "");
  const [draftSummary, setDraftSummary] = useState(() => ticket?.summary || "");
  const [draftNotes, setDraftNotes] = useState(() => ticket?.notes || "");
  const [draftCustomerName, setDraftCustomerName] = useState(() => initialCustomerName);
  const [draftCustomerPhone, setDraftCustomerPhone] = useState(() => initialCustomerPhone);
  const [draftCustomerEmail, setDraftCustomerEmail] = useState(() => initialCustomerEmail);
  const [draftOrderLines, setDraftOrderLines] = useState<OrderEditorLine[]>(() => buildOrderEditorLines(fields));
  if (!ticket) return null;

  const isOrderTicket = isOrderTicketRow(ticket);
  const orderStage = resolveOrderStage(ticket);
  const computedOrderTotal = computeOrderEditorTotal(draftOrderLines);
  const fieldRows = Object.entries(fields);
  const importantFieldRows = getImportantFieldRows(fields);
  const status = getTicketString(ticket, "status");
  const outcome = (getTicketString(ticket, "outcome", "outcome") || "pending") as TicketOutcome;
  const lossReason = getTicketString(ticket, "lossReason", "loss_reason");
  const slaDueAt = slaDueAtRaw;
  const slaCountdown = formatSlaCountdown(slaDueAt, nowMs);
  const priority = getTicketString(ticket, "priority");
  const source = getTicketString(ticket, "source");
  const typeKey = getTicketString(ticket, "ticketTypeKey", "ticket_type_key");
  const createdBy = getTicketString(ticket, "createdBy", "created_by");
  const customerEmail = initialCustomerEmail;
  const customerId = getTicketString(ticket, "customerId", "customer_id");
  const customerHref = customerId ? `/customers?customerId=${encodeURIComponent(customerId)}` : null;
  const createdAt = getTicketValue(ticket, "createdAt", "created_at") as Date | string | null | undefined;
  const updatedAt = getTicketValue(ticket, "updatedAt", "updated_at") as Date | string | null | undefined;
  const resolvedAt = getTicketValue(ticket, "resolvedAt", "resolved_at") as Date | string | null | undefined;
  const closedAt = getTicketValue(ticket, "closedAt", "closed_at") as Date | string | null | undefined;
  const expectedUpdatedAt = toMutationDate(updatedAt);
  const canApproveOrder = isOrderTicket && canApproveOrderStage(orderStage);
  const canDenyOrder = isOrderTicket && canDenyOrderStage(orderStage);

  const handleSaveTicket = () => {
    let parsedFields: Record<string, unknown> = { ...fields };
    if (isOrderTicket) {
      parsedFields = applyOrderEditorToFields(parsedFields, draftOrderLines, computeOrderEditorTotal(draftOrderLines));
      const normalizedEmail = draftCustomerEmail.trim();
      if (normalizedEmail) parsedFields.customerEmail = normalizedEmail;
      else delete parsedFields.customerEmail;
    }
    setSavingTicket(true);
    updateTicket.mutate({
      id: ticket.id,
      expectedUpdatedAt,
      title: draftTitle,
      summary: draftSummary,
      notes: draftNotes,
      customerName: draftCustomerName,
      customerPhone: draftCustomerPhone,
      fields: parsedFields,
    });
  };

  return (
    <>
      <div className="drawer-backdrop open" onClick={onClose} />
      <div className="drawer open portal-drawer-shell">
        <div className="drawer-header">
          <div className="portal-drawer-heading">
            <div>
              <div className="portal-drawer-eyebrow">Ticket Details</div>
              <div className="portal-drawer-title">Ticket #{shortId(ticket.id)}</div>
              <div className="portal-drawer-copy">
                {ticket.title || ticket.summary || "Untitled ticket"}
              </div>
            </div>
            <button className="portal-drawer-close" onClick={onClose} aria-label="Close details">
              <TicketCloseIcon />
            </button>
          </div>
          <div className="portal-drawer-tags">
            <span className={priorityPillClass(priority || "normal")}>{formatStatus(priority || "normal")}</span>
            <span className={isOrderTicket ? orderStagePillClass(orderStage) : "portal-pill portal-pill--neutral"}>
              {isOrderTicket ? formatOrderStage(orderStage) : formatStatus(status || "open")}
            </span>
          </div>
          <div className="portal-drawer-metrics">
            <div className="portal-drawer-metric">
              <div className="portal-drawer-metric__label">Created</div>
              <div className="portal-drawer-metric__value">{formatDate(createdAt)}</div>
            </div>
            <div className="portal-drawer-metric">
              <div className="portal-drawer-metric__label">Updated</div>
              <div className="portal-drawer-metric__value">{formatDate(updatedAt)}</div>
            </div>
            <div className="portal-drawer-metric">
              <div className="portal-drawer-metric__label">SLA Due</div>
              <div className="portal-drawer-metric__value">{formatDate(slaDueAt)}</div>
            </div>
          </div>
        </div>
        <div className="drawer-body">
          <div className="portal-rows">
            <div className="portal-detail-panel">
              <div className="portal-section-head">
                <div className="portal-section-kicker">Ticket #{shortId(ticket.id)}</div>
                <div className="portal-section-title">{ticket.title || ticket.summary || "Untitled ticket"}</div>
                <div className="portal-section-caption">
                  {ticket.summary || ticket.notes || "Review the order request and keep the workflow clean from one place."}
                </div>
              </div>
              <div className="portal-inline-actions" style={{ justifyContent: "flex-start" }}>
                <span className={priorityPillClass(priority || "normal")}>{formatStatus(priority || "normal")}</span>
                <span className={isOrderTicket ? orderStagePillClass(orderStage) : "portal-pill portal-pill--neutral"}>
                  {isOrderTicket ? formatOrderStage(orderStage) : formatStatus(status || "open")}
                </span>
              </div>
              <div className="portal-detail-grid">
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Outcome</div>
                  <div className="portal-detail-value">{isOrderTicket ? formatOrderStage(orderStage) : outcome}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">SLA Due</div>
                  <div className="portal-detail-value">{formatDate(slaDueAt)}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">SLA Timer</div>
                  <div className="portal-detail-value">{slaCountdown.label}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Type</div>
                  <div className="portal-detail-value">{formatStatus(typeKey || "-")}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Source</div>
                  <div className="portal-detail-value">{source || "-"}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Created By</div>
                  <div className="portal-detail-value">{createdBy || "-"}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Created</div>
                  <div className="portal-detail-value">{formatDate(createdAt)}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Updated</div>
                  <div className="portal-detail-value">{formatDate(updatedAt)}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Resolved</div>
                  <div className="portal-detail-value">{formatDate(resolvedAt)}</div>
                </div>
                <div className="portal-detail-item">
                  <div className="portal-detail-label">Closed</div>
                  <div className="portal-detail-value">{formatDate(closedAt)}</div>
                </div>
                {isOrderTicket ? (
                  <div className="portal-detail-item">
                    <div className="portal-detail-label">Customer Email</div>
                    <div className="portal-detail-value">{customerEmail || "-"}</div>
                  </div>
                ) : null}
              </div>
            </div>

            {!isOrderTicket ? (
              <div className="portal-detail-panel">
                <div className="portal-section-head">
                  <div className="portal-section-kicker">Workflow</div>
                  <div className="portal-section-title">Routing And Customer Details</div>
                  <div className="portal-section-caption">
                    Keep the SLA, customer details, and workflow fields aligned without exposing raw JSON by default.
                  </div>
                </div>

                <div className="portal-field">
                  <div className="portal-field-label">SLA due date</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      type="datetime-local"
                      value={slaInput}
                      onChange={(e) => setSlaInput(e.target.value)}
                      style={{ flex: "1 1 220px" }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={updatingSla}
                      onClick={() => {
                        setUpdatingSla(true);
                        updateSlaDueAt.mutate({
                          id: ticket.id,
                          expectedUpdatedAt,
                          slaDueAt: slaInput ? new Date(slaInput) : null,
                        });
                      }}
                    >
                      Save SLA
                    </button>
                  </div>
                </div>

                <div className="portal-form-grid">
                  <div className="portal-field">
                    <div className="portal-field-label">Outcome</div>
                    <TableSelect
                      style={{ width: "100%" }}
                      value={outcome}
                      disabled={updatingOutcome || status !== "resolved"}
                      onChange={(e) => {
                        const nextOutcome = e.target.value as TicketOutcome;
                        setUpdatingOutcome(true);
                        updateOutcome.mutate({
                          id: ticket.id,
                          expectedUpdatedAt,
                          outcome: nextOutcome,
                          lossReason: nextOutcome === "lost" ? lossReason || "Other" : undefined,
                        });
                      }}
                    >
                      {OUTCOME_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </TableSelect>
                  </div>
                  <div className="portal-field">
                    <div className="portal-field-label">Loss reason</div>
                    <TableSelect
                      style={{ width: "100%" }}
                      value={lossReason || "Other"}
                      disabled={updatingOutcome || outcome !== "lost"}
                      onChange={(e) => {
                        setUpdatingOutcome(true);
                        updateOutcome.mutate({
                          id: ticket.id,
                          expectedUpdatedAt,
                          outcome: "lost",
                          lossReason: e.target.value,
                        });
                      }}
                    >
                      {LOSS_REASON_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </TableSelect>
                  </div>
                </div>

                {importantFieldRows.length ? (
                  <div>
                    <div className="portal-detail-label" style={{ marginBottom: 8 }}>Captured details</div>
                    <div className="portal-table-details">
                      {importantFieldRows.map((row) => (
                        <div key={row.key} className="portal-table-details__row">
                          <div className="portal-table-details__label">{row.label}</div>
                          <div className="portal-table-details__value">{row.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {ticket.notes ? (
                  <div className="portal-note-box">
                    <div className="portal-detail-label" style={{ marginBottom: 8 }}>Internal notes</div>
                    <div>{ticket.notes}</div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {isOrderTicket ? (
              <div className="portal-detail-panel">
                <div className="portal-section-head">
                  <div className="portal-section-kicker">Edit</div>
                  <div className="portal-section-title">Ticket And Order Draft</div>
                  <div className="portal-section-caption">
                    Staff edit only the structured order fields here. Raw fields remain visible below for reference, not direct editing.
                  </div>
                </div>

                <div className="portal-form-grid">
                  <div className="portal-field">
                    <div className="portal-field-label">Title</div>
                    <input type="text" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
                  </div>
                  <div className="portal-field">
                    <div className="portal-field-label">Customer Name</div>
                    <input type="text" value={draftCustomerName} onChange={(e) => setDraftCustomerName(e.target.value)} />
                  </div>
                  <div className="portal-field">
                    <div className="portal-field-label">Customer Phone</div>
                    <input type="text" value={draftCustomerPhone} onChange={(e) => setDraftCustomerPhone(e.target.value)} />
                  </div>
                  <div className="portal-field">
                    <div className="portal-field-label">Customer Email</div>
                    <input type="email" value={draftCustomerEmail} onChange={(e) => setDraftCustomerEmail(e.target.value)} />
                  </div>
                  <div className="portal-field portal-field--full">
                    <div className="portal-field-label">Summary</div>
                    <textarea value={draftSummary} onChange={(e) => setDraftSummary(e.target.value)} style={{ minHeight: 96 }} />
                  </div>
                  <div className="portal-field portal-field--full">
                    <div className="portal-field-label">Internal Notes</div>
                    <textarea value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} style={{ minHeight: 88 }} />
                  </div>
                </div>

                <div className="portal-rows">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div className="portal-section-title" style={{ fontSize: 16 }}>Order Items</div>
                    <button
                      type="button"
                      className="portal-ledger-action portal-ledger-action--neutral"
                      aria-label="Add order item"
                      title="Add order item"
                      onClick={() => setDraftOrderLines((current) => [...current, { item: "", quantity: "1", unitPrice: "" }])}
                    >
                      <TicketPlusIcon />
                    </button>
                  </div>

                  {draftOrderLines.length ? (
                    <div className="portal-rows">
                      {draftOrderLines.map((line, index) => (
                        <div key={`order-line-${index}`} className="portal-order-line">
                          <div className="portal-field">
                            <div className="portal-field-label">Item</div>
                            <input
                              type="text"
                              value={line.item}
                              onChange={(e) =>
                                setDraftOrderLines((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, item: e.target.value } : entry,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div className="portal-field">
                            <div className="portal-field-label">Qty</div>
                            <input
                              type="number"
                              min={1}
                              value={line.quantity}
                              onChange={(e) =>
                                setDraftOrderLines((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, quantity: e.target.value } : entry,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div className="portal-field">
                            <div className="portal-field-label">Unit Price</div>
                            <input
                              type="text"
                              value={line.unitPrice}
                              onChange={(e) =>
                                setDraftOrderLines((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, unitPrice: e.target.value } : entry,
                                  ),
                                )
                              }
                              placeholder="Optional"
                            />
                          </div>
                          <div className="portal-field portal-order-line-total">
                            <div className="portal-field-label">Line Total</div>
                            <div className="portal-read-box">{computeOrderEditorLineTotal(line) || "-"}</div>
                          </div>
                          <div className="portal-order-line-actions">
                            <button
                              type="button"
                              className="portal-ledger-action portal-ledger-action--reject"
                              aria-label="Remove order item"
                              title="Remove order item"
                              onClick={() =>
                                setDraftOrderLines((current) => current.filter((_, entryIndex) => entryIndex !== index))
                              }
                            >
                              <TicketTrashIcon />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="portal-meta-text">No order items yet.</div>
                  )}
                </div>
                <div className="portal-order-editor-footer">
                  <div className="portal-order-editor-total">
                    <div className="portal-field-label">Computed Total</div>
                    <div className="portal-order-editor-total__value">{computedOrderTotal || "-"}</div>
                  </div>
                  <button type="button" className="btn btn-primary" disabled={savingTicket} onClick={handleSaveTicket}>
                    {savingTicket ? "Saving..." : "Save Ticket"}
                  </button>
                </div>
              </div>
            ) : null}

            {fieldRows.length ? (
              <details className="portal-disclosure">
                <summary>Raw Structured Fields</summary>
                <div className="portal-disclosure__body">
                  <div className="portal-table-details">
                    {fieldRows.map(([key, value]) => (
                      <div key={key} className="portal-table-details__row">
                        <div className="portal-table-details__label">{key}</div>
                        <div className="portal-table-details__value">{formatFieldValue(value, key, fields)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ) : null}

            <div className="portal-detail-panel">
              <div className="portal-section-head">
                <div className="portal-section-kicker">History</div>
                <div className="portal-section-title">Ticket Timeline</div>
                <div className="portal-section-caption">Every major change on the ticket, ordered newest to oldest.</div>
              </div>
              {!eventsQuery.data?.length ? (
                <div className="portal-meta-text">No change history yet.</div>
              ) : (
                <div className="portal-rows">
                  {(eventsQuery.data as TicketEventRow[]).map((evt) => {
                    const payload = evt.payload ?? {};
                    const pretty = (() => {
                      if (evt.eventType === "status_changed") {
                        return `Status ${(payload.from as string) || "-"} -> ${(payload.to as string) || "-"}`;
                      }
                      if (evt.eventType === "outcome_changed") {
                        return `Outcome ${(payload.from as string) || "-"} -> ${(payload.to as string) || "-"}`;
                      }
                      if (evt.eventType === "sla_changed") {
                        return `SLA ${formatDate(payload.from as string | null | undefined)} -> ${formatDate(payload.to as string | null | undefined)}`;
                      }
                      if (evt.eventType === "created") {
                        return "Ticket created";
                      }
                      return evt.eventType.replace(/_/g, " ");
                    })();
                    return (
                      <div key={evt.id} className="portal-note-box">
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{pretty}</div>
                        {(payload.lossReason as string | undefined) ? (
                          <div className="portal-meta-text">Loss reason: {String(payload.lossReason)}</div>
                        ) : null}
                        <div className="portal-meta-text">
                          {formatDate(evt.createdAt)} by {evt.actorLabel || evt.actorType || "system"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="portal-drawer-footer">
          <div className="portal-drawer-footer__label">{isOrderTicket ? "Order Actions" : "Quick Actions"}</div>
          <div className="portal-drawer-footer__actions">
            {isOrderTicket ? (
              <>
                <button
                  type="button"
                  className="portal-ledger-action portal-ledger-action--approve portal-drawer-action-icon"
                  disabled={orderActionPending || !canApproveOrder}
                  onClick={() => void onApproveOrderTicket(ticket)}
                  title="Approve order"
                  aria-label="Approve order"
                >
                  <TicketCheckIcon />
                </button>
                <button
                  type="button"
                  className="portal-ledger-action portal-ledger-action--reject portal-drawer-action-icon"
                  disabled={orderActionPending || !canDenyOrder}
                  onClick={() => onDenyOrderTicket(ticket)}
                  title="Deny order"
                  aria-label="Deny order"
                >
                  <TicketCloseIcon />
                </button>
              </>
            ) : null}
            <button
              type="button"
              className={isOrderTicket ? "btn btn-secondary" : "btn btn-primary"}
              onClick={() => {
                onClose();
                router.push(threadHref);
              }}
            >
              Open Thread
            </button>
            {customerHref ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  onClose();
                  router.push(customerHref);
                }}
              >
                Customer Details
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" disabled>
                Customer Details
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function TicketCloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function TicketCheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

function TicketPlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function TicketTrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}
