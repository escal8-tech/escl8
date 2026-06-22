import {
  normalizeOrderFulfillmentStatus,
  type OrderFulfillmentStatus,
} from "@/lib/order-operations";
import { TRPCError } from "@trpc/server";

export function parseOptionalDate(value: string | null | undefined): Date | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asNullableDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function nextFulfillmentTimestamps(input: {
  currentStatus: string | null | undefined;
  nextStatus: OrderFulfillmentStatus;
  now: Date;
  existing: {
    packedAt?: Date | string | null;
    dispatchedAt?: Date | string | null;
    outForDeliveryAt?: Date | string | null;
    deliveredAt?: Date | string | null;
    failedDeliveryAt?: Date | string | null;
    returnedAt?: Date | string | null;
  };
}) {
  const current = normalizeOrderFulfillmentStatus(input.currentStatus);
  const changed = current !== input.nextStatus;
  const next = {
    packedAt: asNullableDate(input.existing.packedAt),
    dispatchedAt: asNullableDate(input.existing.dispatchedAt),
    outForDeliveryAt: asNullableDate(input.existing.outForDeliveryAt),
    deliveredAt: asNullableDate(input.existing.deliveredAt),
    failedDeliveryAt: asNullableDate(input.existing.failedDeliveryAt),
    returnedAt: asNullableDate(input.existing.returnedAt),
    fulfillmentUpdatedAt: changed ? input.now : null,
  };
  if (!changed) return next;
  if (input.nextStatus === "packed" && !next.packedAt) next.packedAt = input.now;
  if (input.nextStatus === "dispatched" && !next.dispatchedAt) next.dispatchedAt = input.now;
  if (input.nextStatus === "out_for_delivery" && !next.outForDeliveryAt) next.outForDeliveryAt = input.now;
  if (input.nextStatus === "delivered" && !next.deliveredAt) next.deliveredAt = input.now;
  if (input.nextStatus === "failed_delivery" && !next.failedDeliveryAt) next.failedDeliveryAt = input.now;
  if (input.nextStatus === "returned" && !next.returnedAt) next.returnedAt = input.now;
  return next;
}

export function requiresDispatchData(status: OrderFulfillmentStatus): boolean {
  return status === "dispatched" || status === "out_for_delivery";
}

const FULFILLMENT_MUTABLE_ORDER_STATUSES = new Set(["paid", "refund_pending", "refunded"]);

export function assertOrderAllowsFulfillmentUpdates(orderRow: {
  status?: string | null;
}) {
  const status = String(orderRow.status || "").trim().toLowerCase();
  if (FULFILLMENT_MUTABLE_ORDER_STATUSES.has(status)) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "Only paid or refund-tracked orders can be updated in order status.",
  });
}
