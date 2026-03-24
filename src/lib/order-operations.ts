export const ORDER_FULFILLMENT_STATUSES = [
  "on_hold",
  "queued",
  "preparing",
  "packed",
  "dispatched",
  "out_for_delivery",
  "delivered",
  "failed_delivery",
  "returned",
] as const;

export type OrderFulfillmentStatus = (typeof ORDER_FULFILLMENT_STATUSES)[number];

const FALLBACK_FULFILLMENT_STATUS: OrderFulfillmentStatus = "queued";

const FULFILLMENT_LABELS: Record<OrderFulfillmentStatus, string> = {
  on_hold: "On Hold",
  queued: "Queued",
  preparing: "Preparing",
  packed: "Packed",
  dispatched: "Dispatched",
  out_for_delivery: "Out For Delivery",
  delivered: "Delivered",
  failed_delivery: "Failed Delivery",
  returned: "Returned",
};

export function normalizeOrderFulfillmentStatus(
  raw: unknown,
  fallback: OrderFulfillmentStatus = FALLBACK_FULFILLMENT_STATUS,
): OrderFulfillmentStatus {
  const normalized = String(raw ?? "").trim().toLowerCase().replace(/[^a-z]+/g, "_");
  return (ORDER_FULFILLMENT_STATUSES as readonly string[]).includes(normalized)
    ? (normalized as OrderFulfillmentStatus)
    : fallback;
}

export function formatOrderFulfillmentStatus(value: unknown): string {
  return FULFILLMENT_LABELS[normalizeOrderFulfillmentStatus(value)];
}

export function resolveInitialFulfillmentStatus(paymentMethod: unknown): OrderFulfillmentStatus {
  const method = String(paymentMethod ?? "").trim().toLowerCase();
  if (method === "bank_qr") return "on_hold";
  return "queued";
}

export function describeOrderFulfillmentState(value: unknown): string {
  const status = normalizeOrderFulfillmentStatus(value);
  if (status === "on_hold") return "Order is approved but waiting for payment or internal release before fulfilment starts.";
  if (status === "queued") return "Ready for the team to confirm delivery details and start packing.";
  if (status === "preparing") return "Team is collecting items and preparing the order.";
  if (status === "packed") return "Order is packed and waiting for courier handoff.";
  if (status === "dispatched") return "Courier handoff is done and tracking should be active.";
  if (status === "out_for_delivery") return "Courier is attempting delivery now.";
  if (status === "delivered") return "Order reached the customer.";
  if (status === "failed_delivery") return "Delivery attempt failed and staff follow-up is required.";
  return "Order is back from the courier or returned after delivery.";
}

export function describeOrderFulfillmentNextAction(value: unknown): string {
  const status = normalizeOrderFulfillmentStatus(value);
  if (status === "on_hold") return "Wait for payment approval or release it manually when finance is settled.";
  if (status === "queued") return "Verify recipient details, address, and packing readiness.";
  if (status === "preparing") return "Finish packing and add courier details before dispatch.";
  if (status === "packed") return "Hand over to courier and add tracking details.";
  if (status === "dispatched") return "Monitor courier progress and move it to out for delivery.";
  if (status === "out_for_delivery") return "Confirm delivery success or mark the attempt as failed.";
  if (status === "delivered") return "No action unless payment settlement, return, or refund is needed.";
  if (status === "failed_delivery") return "Correct the issue, then resend or mark the order returned.";
  return "Decide whether the item should be re-sent, refunded, or closed.";
}

export function orderFulfillmentTone(
  value: unknown,
): { color: string; background: string; border: string } {
  const status = normalizeOrderFulfillmentStatus(value);
  if (status === "delivered") {
    return {
      color: "#86efac",
      background: "rgba(34, 197, 94, 0.12)",
      border: "1px solid rgba(34, 197, 94, 0.28)",
    };
  }
  if (status === "out_for_delivery" || status === "dispatched") {
    return {
      color: "#7dd3fc",
      background: "rgba(14, 165, 233, 0.12)",
      border: "1px solid rgba(14, 165, 233, 0.28)",
    };
  }
  if (status === "packed" || status === "preparing") {
    return {
      color: "#fcd34d",
      background: "rgba(245, 158, 11, 0.12)",
      border: "1px solid rgba(245, 158, 11, 0.28)",
    };
  }
  if (status === "failed_delivery" || status === "returned") {
    return {
      color: "#fca5a5",
      background: "rgba(239, 68, 68, 0.12)",
      border: "1px solid rgba(239, 68, 68, 0.28)",
    };
  }
  return {
    color: "#cbd5e1",
    background: "rgba(148, 163, 184, 0.12)",
    border: "1px solid rgba(148, 163, 184, 0.24)",
  };
}

export function getFulfillmentProgress(status: unknown): number {
  const normalized = normalizeOrderFulfillmentStatus(status);
  const stages: OrderFulfillmentStatus[] = [
    "on_hold",
    "queued",
    "preparing",
    "packed",
    "dispatched",
    "out_for_delivery",
    "delivered",
  ];
  const index = stages.indexOf(normalized);
  if (index >= 0) return index;
  if (normalized === "failed_delivery") return stages.indexOf("out_for_delivery");
  return stages.indexOf("delivered");
}
