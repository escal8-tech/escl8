import { eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { orders } from "../../../drizzle/schema";
import {
  OrderAnalyticsDateField,
  OrderAnalyticsMethodFilter,
  OrderWorkspaceFilter,
  OrderWorkspaceMode,
} from "@/server/services/orderWorkflowSupport";


function buildOrderSearchPattern(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? `%${normalized}%` : null;
}

export function buildOrderBaseConditions(params: {
  businessId: string;
  timezone?: string; // Add timezone parameter
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
    const column = params.dateField === "createdAt" ? orders.createdAt : orders.updatedAt;
    const tz = params.timezone && params.timezone.length > 0 ? params.timezone : "UTC";
    const tzSql = sql.raw(`'${tz.replace(/'/g, "''")}'`);
    const intervalSql = sql.raw(`'${params.rangeDays - 1} days'`);
    
    // Convert column to venue's timezone for comparison
    const columnInTz = sql`${column} AT TIME ZONE ${tzSql}`;
    // Get start of the anchor day in venue's timezone
    const rangeStartInTz = sql`(CURRENT_TIMESTAMP AT TIME ZONE ${tzSql})::date - INTERVAL ${intervalSql}`;
    // Get end of today (start of tomorrow) in venue's timezone
    const rangeEndInTz = sql`(CURRENT_TIMESTAMP AT TIME ZONE ${tzSql})::date + INTERVAL '1 day'`;

    conditions.push(gte(columnInTz, rangeStartInTz));
    conditions.push(sql`${columnInTz} < ${rangeEndInTz}`);
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
  timezone?: string;
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
    timezone: params.timezone,
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
