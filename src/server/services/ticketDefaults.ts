import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { supportTicketTypes } from "../../../drizzle/schema";

export const DEFAULT_TICKET_TYPES = [
  {
    key: "ordercreation",
    label: "Orders",
    requiredFields: ["name", "phonenumber", "items"],
    sortOrder: 10,
  },
  {
    key: "orderstatus",
    label: "Order Status",
    requiredFields: ["orderid", "phonenumber"],
    sortOrder: 20,
  },
  {
    key: "complaint",
    label: "Complaint",
    requiredFields: ["name", "phonenumber", "details"],
    sortOrder: 30,
  },
  {
    key: "refund",
    label: "Refund",
    requiredFields: ["orderid", "reason"],
    sortOrder: 40,
  },
  {
    key: "cancellation",
    label: "Cancellation",
    requiredFields: ["orderid", "reason"],
    sortOrder: 50,
  },
  {
    key: "warrantyclaim",
    label: "Warranty Claim",
    requiredFields: ["name", "phonenumber", "warrantynumber", "issue"],
    sortOrder: 60,
  },
  {
    key: "invoice",
    label: "Invoice / Billing",
    requiredFields: ["name", "phonenumber", "details"],
    sortOrder: 70,
  },
] as const;

export const DEFAULT_TICKET_TYPE_KEYS = new Set(DEFAULT_TICKET_TYPES.map((t) => t.key));

export async function ensureDefaultTicketTypes(businessId: string): Promise<void> {
  await db
    .insert(supportTicketTypes)
    .values(
      DEFAULT_TICKET_TYPES.map((t) => ({
        businessId,
        key: t.key,
        label: t.label,
        requiredFields: [...t.requiredFields],
        enabled: true,
        sortOrder: t.sortOrder,
      })),
    )
    .onConflictDoNothing({
      target: [supportTicketTypes.businessId, supportTicketTypes.key],
    });
}

export async function isDefaultTicketType(businessId: string, id: string): Promise<boolean> {
  const [row] = await db
    .select({ key: supportTicketTypes.key })
    .from(supportTicketTypes)
    .where(and(eq(supportTicketTypes.id, id), eq(supportTicketTypes.businessId, businessId)))
    .limit(1);
  if (!row) return false;
  return DEFAULT_TICKET_TYPE_KEYS.has(row.key as (typeof DEFAULT_TICKET_TYPES)[number]["key"]);
}
