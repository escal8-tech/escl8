import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { supportTicketTypes } from "../../../drizzle/schema";

export const DEFAULT_TICKET_TYPES = [
  {
    key: "ordercreation",
    label: "Order Creation",
    description: "Customer wants to place an order",
    requiredFields: ["name", "phonenumber", "items"],
    triggerPhrases: ["new order", "place order", "buy", "order now"],
    sortOrder: 10,
  },
  {
    key: "orderstatus",
    label: "Order Status",
    description: "Customer asks for delivery/order updates",
    requiredFields: ["orderid", "phonenumber"],
    triggerPhrases: ["order status", "where is my order", "delivery status", "tracking"],
    sortOrder: 20,
  },
  {
    key: "complaint",
    label: "Complaint",
    description: "Issues, wrong item, damaged item, service complaints",
    requiredFields: ["name", "phonenumber", "details"],
    triggerPhrases: ["complaint", "issue", "problem", "wrong item", "damaged", "defective"],
    sortOrder: 30,
  },
  {
    key: "refund",
    label: "Refund",
    description: "Customer asks for refund processing",
    requiredFields: ["orderid", "reason"],
    triggerPhrases: ["refund", "money back"],
    sortOrder: 40,
  },
  {
    key: "cancellation",
    label: "Cancellation",
    description: "Customer asks to cancel order/booking",
    requiredFields: ["orderid", "reason"],
    triggerPhrases: ["cancel", "cancellation"],
    sortOrder: 50,
  },
  {
    key: "warrantyclaim",
    label: "Warranty Claim",
    description: "Warranty service/claim request",
    requiredFields: ["name", "phonenumber", "warrantynumber", "issue"],
    triggerPhrases: ["warranty", "claim"],
    sortOrder: 60,
  },
  {
    key: "invoice",
    label: "Invoice / Billing",
    description: "Invoice copies, billing disputes, payment references",
    requiredFields: ["name", "phonenumber", "details"],
    triggerPhrases: ["invoice", "billing", "receipt", "payment id"],
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
        description: t.description,
        requiredFields: [...t.requiredFields],
        triggerPhrases: [...t.triggerPhrases],
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
