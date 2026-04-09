import { and, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { orders, supportTicketTypes, supportTickets } from "@/../drizzle/schema";
import { ensureDefaultTicketTypes } from "@/server/services/ticketDefaults";
import { getHydratedTicketRow, normalizeKey } from "@/server/services/ticketWorkflowSupport";

const LEGACY_ORDER_OPS_TICKET_TYPE_KEYS = ["orderstatus", "paymentstatus"] as const;

export async function listTicketTypesForBusiness(args: { businessId: string; includeDisabled?: boolean }) {
  await ensureDefaultTicketTypes(args.businessId);
  const conditions = [eq(supportTicketTypes.businessId, args.businessId)];
  if (!args.includeDisabled) conditions.push(eq(supportTicketTypes.enabled, true));
  conditions.push(sql`lower(${supportTicketTypes.key}) not in (${sql.join(
    LEGACY_ORDER_OPS_TICKET_TYPE_KEYS.map((key) => sql`${key}`),
    sql`, `,
  )})`);
  return db
    .select()
    .from(supportTicketTypes)
    .where(and(...conditions))
    .orderBy(supportTicketTypes.sortOrder, supportTicketTypes.label);
}

export async function listTicketsForBusiness(args: {
  businessId: string;
  status?: "open" | "in_progress" | "resolved";
  typeKey?: string;
  limit?: number;
}) {
  const conditions = [eq(supportTickets.businessId, args.businessId)];
  if (args.status) conditions.push(eq(supportTickets.status, args.status));
  if (args.typeKey) conditions.push(eq(supportTickets.ticketTypeKey, normalizeKey(args.typeKey)));
  return db
    .select({
      ...getTableColumns(supportTickets),
      orderId: orders.id,
      orderStatus: orders.status,
      orderPaymentMethod: orders.paymentMethod,
      orderUpdatedAt: orders.updatedAt,
    })
    .from(supportTickets)
    .leftJoin(orders, and(eq(orders.businessId, supportTickets.businessId), eq(orders.supportTicketId, supportTickets.id)))
    .where(and(...conditions))
    .orderBy(desc(supportTickets.updatedAt), desc(supportTickets.createdAt))
    .limit(args.limit ?? 200);
}

export async function listTicketLedgerForBusiness(args: {
  businessId: string;
  typeKey?: string;
  status?: "open" | "in_progress" | "resolved";
  orderStage?: "pending_approval" | "edit_required" | "approved" | "awaiting_payment" | "payment_submitted" | "payment_rejected" | "paid" | "refund_pending" | "refunded" | "denied";
  search?: string;
  limit: number;
  offset: number;
}) {
  const conditions: Array<ReturnType<typeof eq> | ReturnType<typeof sql<boolean>> | ReturnType<typeof or>> = [
    eq(supportTickets.businessId, args.businessId),
  ];
  const normalizedStatusExpr = sql<string>`case when lower(coalesce(${supportTickets.status}, '')) = 'closed' then 'resolved' else lower(coalesce(${supportTickets.status}, '')) end`;
  const orderStageExpr = sql<string>`case
    when lower(coalesce(${orders.status}, '')) in ('pending_approval', 'edit_required', 'approved', 'awaiting_payment', 'payment_submitted', 'payment_rejected', 'paid', 'refund_pending', 'refunded', 'denied')
      then lower(coalesce(${orders.status}, ''))
    when lower(coalesce(${supportTickets.outcome}, '')) = 'lost' then 'denied'
    when lower(coalesce(${supportTickets.outcome}, '')) = 'won' then 'approved'
    else 'pending_approval'
  end`;
  if (args.typeKey) conditions.push(eq(supportTickets.ticketTypeKey, normalizeKey(args.typeKey)));
  if (args.status) conditions.push(sql<boolean>`${normalizedStatusExpr} = ${args.status}`);
  if (args.orderStage) conditions.push(sql<boolean>`${orderStageExpr} = ${args.orderStage}`);

  const searchPattern = String(args.search ?? "").trim().replace(/^#/, "");
  if (searchPattern) {
    const pattern = `%${searchPattern}%`;
    conditions.push(
      or(
        ilike(supportTickets.ticketNumber, pattern),
        ilike(supportTickets.id, pattern),
        ilike(supportTickets.title, pattern),
        ilike(supportTickets.summary, pattern),
        ilike(supportTickets.notes, pattern),
        ilike(supportTickets.customerName, pattern),
        ilike(supportTickets.customerPhone, pattern),
        ilike(orders.id, pattern),
      ),
    );
  }

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(supportTickets)
    .leftJoin(orders, and(eq(orders.businessId, supportTickets.businessId), eq(orders.supportTicketId, supportTickets.id)))
    .where(and(...conditions));

  const rows = await db
    .select({
      ...getTableColumns(supportTickets),
      orderId: orders.id,
      orderStatus: orders.status,
      orderPaymentMethod: orders.paymentMethod,
      orderUpdatedAt: orders.updatedAt,
    })
    .from(supportTickets)
    .leftJoin(orders, and(eq(orders.businessId, supportTickets.businessId), eq(orders.supportTicketId, supportTickets.id)))
    .where(and(...conditions))
    .orderBy(desc(supportTickets.updatedAt), desc(supportTickets.createdAt))
    .limit(args.limit)
    .offset(args.offset);

  return {
    totalCount: countRow?.count ?? 0,
    items: rows,
  };
}

export async function getHydratedTicketByIdForBusiness(args: { businessId: string; ticketId: string }) {
  return getHydratedTicketRow(args.businessId, args.ticketId);
}

export async function getTicketTypeCountersForBusiness(businessId: string) {
  const rows = await db
    .select({
      key: supportTickets.ticketTypeKey,
      openCount: sql<number>`count(*) filter (where lower(coalesce(${supportTickets.status}, '')) = 'open')::int`,
      inProgressCount: sql<number>`count(*) filter (where lower(coalesce(${supportTickets.status}, '')) in ('in_progress', 'pending'))::int`,
    })
    .from(supportTickets)
    .where(eq(supportTickets.businessId, businessId))
    .groupBy(supportTickets.ticketTypeKey);

  return rows.map((row) => ({
    key: row.key,
    openCount: Number(row.openCount ?? 0),
    inProgressCount: Number(row.inProgressCount ?? 0),
  }));
}

export async function getTicketPerformanceForBusiness(args: {
  businessId: string;
  typeKey?: string;
  windowDays?: number;
}) {
  const whereChunks = [sql`${supportTickets.businessId} = ${args.businessId}`];
  if (args.typeKey) whereChunks.push(sql`${supportTickets.ticketTypeKey} = ${normalizeKey(args.typeKey)}`);
  if (args.windowDays) whereChunks.push(sql`${supportTickets.createdAt} >= now() - (${args.windowDays} * interval '1 day')`);

  const whereSql = sql.join(whereChunks, sql` AND `);
  const result = await db.execute<{
    total: number;
    overdue_open: number;
    resolved_total: number;
    resolved_on_time: number;
    resolved_late: number;
    won_count: number;
    lost_count: number;
  }>(sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (
        WHERE ${supportTickets.status} IN ('open','in_progress')
        AND ${supportTickets.slaDueAt} IS NOT NULL
        AND ${supportTickets.slaDueAt} < now()
      )::int AS overdue_open,
      count(*) FILTER (WHERE ${supportTickets.status} = 'resolved')::int AS resolved_total,
      count(*) FILTER (
        WHERE ${supportTickets.status} = 'resolved'
        AND ${supportTickets.resolvedAt} IS NOT NULL
        AND ${supportTickets.slaDueAt} IS NOT NULL
        AND ${supportTickets.resolvedAt} <= ${supportTickets.slaDueAt}
      )::int AS resolved_on_time,
      count(*) FILTER (
        WHERE ${supportTickets.status} = 'resolved'
        AND ${supportTickets.resolvedAt} IS NOT NULL
        AND ${supportTickets.slaDueAt} IS NOT NULL
        AND ${supportTickets.resolvedAt} > ${supportTickets.slaDueAt}
      )::int AS resolved_late,
      count(*) FILTER (WHERE ${supportTickets.outcome} = 'won')::int AS won_count,
      count(*) FILTER (WHERE ${supportTickets.outcome} = 'lost')::int AS lost_count
    FROM ${supportTickets}
    WHERE ${whereSql}
  `);

  const row = result.rows?.[0] ?? {
    total: 0,
    overdue_open: 0,
    resolved_total: 0,
    resolved_on_time: 0,
    resolved_late: 0,
    won_count: 0,
    lost_count: 0,
  };
  const won = Number(row.won_count ?? 0);
  const lost = Number(row.lost_count ?? 0);
  const closedDeals = won + lost;
  const resolvedTotal = Number(row.resolved_total ?? 0);
  const resolvedOnTime = Number(row.resolved_on_time ?? 0);

  return {
    total: Number(row.total ?? 0),
    overdueOpen: Number(row.overdue_open ?? 0),
    resolvedTotal,
    resolvedOnTime,
    resolvedLate: Number(row.resolved_late ?? 0),
    wonCount: won,
    lostCount: lost,
    conversionRate: closedDeals > 0 ? Number(((won / closedDeals) * 100).toFixed(1)) : 0,
    slaOnTimeRate: resolvedTotal > 0 ? Number(((resolvedOnTime / resolvedTotal) * 100).toFixed(1)) : 0,
  };
}
