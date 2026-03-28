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
  chartLabel?: string;
};

export const PORTAL_TICKET_TYPES: PortalTicketTypeConfig[] = [
  { key: "ordercreation", label: "Orders", navLabel: "Order Tickets", chartLabel: "Orders" },
  { key: "orderstatus", label: "Order Status", navLabel: "Order Status", chartLabel: "Status" },
  { key: "paymentstatus", label: "Payment Status", navLabel: "Payment Status", chartLabel: "Payment" },
  { key: "complaint", label: "Complaint", navLabel: "Complaint", chartLabel: "Complaint" },
  { key: "refund", label: "Refund", navLabel: "Refund", chartLabel: "Refund" },
  { key: "cancellation", label: "Cancellation", navLabel: "Cancellation", chartLabel: "Cancellation" },
  { key: "warrantyclaim", label: "Warranty Claim", navLabel: "Warranty Claim", chartLabel: "Warranty" },
  { key: "invoice", label: "Invoice", navLabel: "Invoice", chartLabel: "Invoice" },
];

const PORTAL_TICKET_TYPE_LABELS = new Map(PORTAL_TICKET_TYPES.map((type) => [type.key, type.label]));
const PORTAL_TICKET_TYPE_NAV_LABELS = new Map(PORTAL_TICKET_TYPES.map((type) => [type.key, type.navLabel]));
const PORTAL_TICKET_TYPE_CHART_LABELS = new Map(
  PORTAL_TICKET_TYPES.map((type) => [type.key, type.chartLabel ?? type.label]),
);

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

export function getPortalTicketTypeChartLabel(typeKey: string | null | undefined): string {
  const normalizedKey = String(typeKey ?? "").trim().toLowerCase();
  if (!normalizedKey) return "Tickets";
  return PORTAL_TICKET_TYPE_CHART_LABELS.get(normalizedKey as PortalTicketTypeKey)
    ?? getPortalTicketTypeLabel(normalizedKey);
}
