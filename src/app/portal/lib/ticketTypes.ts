export type PortalTicketTypeKey =
  | "ordercreation"
  | "orderstatus"
  | "paymentstatus"
  | "complaint"
  | "refund"
  | "cancellation"
  | "warrantyclaim"
  | "invoice";

export type PortalTicketTypeConfig = {
  key: PortalTicketTypeKey;
  label: string;
  navLabel: string;
};

export const PORTAL_TICKET_TYPES: PortalTicketTypeConfig[] = [
  { key: "ordercreation", label: "Orders", navLabel: "Order Tickets" },
  { key: "orderstatus", label: "Order Status", navLabel: "Order Status" },
  { key: "paymentstatus", label: "Payment Status", navLabel: "Payment Status" },
  { key: "complaint", label: "Complaint", navLabel: "Complaint" },
  { key: "refund", label: "Refund", navLabel: "Refund" },
  { key: "cancellation", label: "Cancellation", navLabel: "Cancellation" },
  { key: "warrantyclaim", label: "Warranty Claim", navLabel: "Warranty Claim" },
  { key: "invoice", label: "Invoice", navLabel: "Invoice" },
];

const PORTAL_TICKET_TYPE_LABELS = new Map(PORTAL_TICKET_TYPES.map((type) => [type.key, type.label]));
const PORTAL_TICKET_TYPE_NAV_LABELS = new Map(PORTAL_TICKET_TYPES.map((type) => [type.key, type.navLabel]));

export function getPortalTicketTypeLabel(typeKey: string | null | undefined): string {
  const normalizedKey = String(typeKey ?? "").trim().toLowerCase();
  if (!normalizedKey) return "Tickets";
  return PORTAL_TICKET_TYPE_LABELS.get(normalizedKey as PortalTicketTypeKey) ?? normalizedKey;
}

export function getPortalTicketTypeNavLabel(typeKey: string | null | undefined): string {
  const normalizedKey = String(typeKey ?? "").trim().toLowerCase();
  if (!normalizedKey) return "Tickets";
  return PORTAL_TICKET_TYPE_NAV_LABELS.get(normalizedKey as PortalTicketTypeKey)
    ?? getPortalTicketTypeLabel(normalizedKey);
}
