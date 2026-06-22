import { eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { orders } from "../../../drizzle/schema";
import {
  OrderAnalyticsDateField,
  OrderAnalyticsMethodFilter,
  OrderWorkspaceFilter,
  OrderWorkspaceMode,
} from "@/server/services/orderWorkflowSupport";

function getOrderRangeBounds(rangeDays: number) {
  const rangeEnd = new Date();
  rangeEnd.setHours(23, 59, 59, 999);
  const rangeStart = new Date(rangeEnd);
  rangeStart.setDate(rangeStart.getDate() - (rangeDays - 1));
  rangeStart.setHours(0, 0, 0, 0);
  return { rangeStart, rangeEnd };
}

function buildOrderSearchPattern(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? `%${normalized}%` : null;
}

export function buildOrderBaseConditions(params: {
  businessId: string;
  status?: string;
  methodFilter?: OrderAnalyticsMethodFilter;
  dateField?: OrderAnalyticsDateField;
  rangeDays?: number;
  search?: string;
}) {
  const conditions: SQL[] = [eq(orders.businessId, params.businessId)];

  if (params.status) {
    conditions.push(eq(orders.status, params.status));
  }

  if (params.methodFilter && params.methodFilter !== "all") {
    conditions.push(eq(orders.paymentMethod, params.methodFilter));
  }

  if (params.dateField && params.rangeDays) {
    const { rangeStart, rangeEnd } = getOrderRangeBounds(params.rangeDays);
    const column = params.dateField === "createdAt" ? orders.createdAt : orders.updatedAt;
    conditions.push(gte(column, rangeStart));
    conditions.push(lte(column, rangeEnd));
  }

  const searchPattern = buildOrderSearchPattern(params.search);
  if (searchPattern) {
    const searchClause = or(
      ilike(orders.id, searchPattern),
      ilike(orders.customerName, searchPattern),
      ilike(orders.customerPhone, searchPattern),
      ilike(orders.recipientName, searchPattern),
      ilike(orders.recipientPhone, searchPattern),
      ilike(orders.paymentReference, searchPattern),
      ilike(orders.trackingNumber, searchPattern),
      ilike(orders.dispatchReference, searchPattern),
    );
    if (searchClause) {
      conditions.push(searchClause);
    }
  }

  return conditions;
}

function simpleFulfillmentBucketExpr() {
  return sql<string>`case
    when lower(coalesce(${orders.fulfillmentStatus}, '')) = 'delivered' then 'completed'
    when lower(coalesce(${orders.fulfillmentStatus}, '')) in ('dispatched', 'out_for_delivery') then 'out_for_delivery'
    else 'pending'
  end`;
}

export function buildWorkspaceConditions(params: {
  businessId: string;
  mode: OrderWorkspaceMode;
  queueFilter: OrderWorkspaceFilter;
  methodFilter?: OrderAnalyticsMethodFilter;
  dateField?: OrderAnalyticsDateField;
  rangeDays?: number;
  search?: string;
}) {
  const statusExpr = sql<string>`lower(coalesce(${orders.status}, ''))`;
  const fulfillmentBucket = simpleFulfillmentBucketExpr();
  const conditions = buildOrderBaseConditions({
    businessId: params.businessId,
    methodFilter: params.methodFilter,
    dateField: params.dateField,
    rangeDays: params.rangeDays,
    search: params.search,
  });

  if (params.mode === "payments") {
    if (params.queueFilter === "pending") {
      conditions.push(
        sql<boolean>`${statusExpr} in ('pending_approval', 'edit_required', 'approved', 'awaiting_payment', 'payment_submitted')`,
      );
    } else if (params.queueFilter === "approved") {
      conditions.push(sql<boolean>`${statusExpr} in ('paid', 'refund_pending', 'refunded')`);
    } else if (params.queueFilter === "denied") {
      conditions.push(sql<boolean>`${statusExpr} in ('payment_rejected', 'denied')`);
    } else {
      conditions.push(
        sql<boolean>`${statusExpr} in ('pending_approval', 'edit_required', 'approved', 'awaiting_payment', 'payment_submitted', 'payment_rejected', 'denied', 'paid', 'refund_pending', 'refunded')`,
      );
    }
  } else if (params.mode === "status") {
    conditions.push(sql<boolean>`${statusExpr} in ('paid', 'refund_pending', 'refunded')`);
    if (params.queueFilter === "pending") {
      conditions.push(sql<boolean>`${fulfillmentBucket} = 'pending'`);
    } else if (params.queueFilter === "out_for_delivery") {
      conditions.push(sql<boolean>`${fulfillmentBucket} = 'out_for_delivery'`);
    } else if (params.queueFilter === "completed") {
      conditions.push(sql<boolean>`${fulfillmentBucket} = 'completed'`);
    }
  } else {
    if (params.queueFilter === "realized") {
      conditions.push(sql<boolean>`${statusExpr} in ('paid', 'refund_pending', 'refunded')`);
    } else if (params.queueFilter === "unrealized") {
      conditions.push(sql<boolean>`false`);
    } else {
      conditions.push(sql<boolean>`${statusExpr} in ('paid', 'refund_pending', 'refunded')`);
    }
  }

  return { conditions, statusExpr, fulfillmentBucket };
}
