export type PortalTicketTypeKey =
  | "ordercreation"
  | "complaint"
  | "generalsupport"
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

const LEGACY_PORTAL_TICKET_TYPE_LABELS = new Map<string, string>([
  ["orderstatus", "Order Status"],
  ["paymentstatus", "Payment Status"],
]);

export const PORTAL_TICKET_TYPES: PortalTicketTypeConfig[] = [
  { key: "ordercreation", label: "Orders", navLabel: "Orders", chartLabel: "Orders" },
  { key: "complaint", label: "Complaint", navLabel: "Complaint", chartLabel: "Complaint" },
  { key: "generalsupport", label: "General Support", navLabel: "General Support", chartLabel: "General Support" },
];

const PORTAL_TICKET_TYPE_LABELS = new Map(PORTAL_TICKET_TYPES.map((type) => [type.key, type.label]));
const PORTAL_TICKET_TYPE_NAV_LABELS = new Map(PORTAL_TICKET_TYPES.map((type) => [type.key, type.navLabel]));
const PORTAL_TICKET_TYPE_CHART_LABELS = new Map(
  PORTAL_TICKET_TYPES.map((type) => [type.key, type.chartLabel ?? type.label]),
);

export function getPortalTicketTypeLabel(typeKey: string | null | undefined): string {
  const normalizedKey = String(typeKey ?? "").trim().toLowerCase();
  if (!normalizedKey) return "Tickets";
  return PORTAL_TICKET_TYPE_LABELS.get(normalizedKey as PortalTicketTypeKey)
    ?? LEGACY_PORTAL_TICKET_TYPE_LABELS.get(normalizedKey)
    ?? normalizedKey;
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
