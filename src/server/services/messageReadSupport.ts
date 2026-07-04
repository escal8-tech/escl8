import { and, desc, eq, ilike, isNull, lt, or, sql, inArray, asc, gt } from "drizzle-orm";
import { db } from "../db/client";
import {
  customers,
  messageThreads,
  threadMessages,
  orders,
} from "@/../drizzle/schema";
import { ORDER_END_MESSAGE_KINDS } from "@/lib/messageFields";

const digitsOnly = (value: string) => value.replace(/\D+/g, "");

const lastMessageDirectionExpr = sql<string | null>`(
  select tm.direction
  from thread_messages tm
  where tm.thread_id = ${messageThreads.id}
  order by tm.created_at desc, tm.id desc
  limit 1
)`;
const lastMessageDirectionSelection = sql<string | null>`coalesce(${messageThreads.lastMessageDirection}, ${lastMessageDirectionExpr})`;

export const threadMessageSelection = {
  id: threadMessages.id,
  direction: threadMessages.direction,
  messageType: threadMessages.messageType,
  textBody: threadMessages.textBody,
  linkedOrderId: threadMessages.linkedOrderId,
  messageKind: threadMessages.messageKind,
  replyId: threadMessages.replyId,
  replyTitle: threadMessages.replyTitle,
  meta: threadMessages.meta,
  createdAt: threadMessages.createdAt,
};

const orderEndMessageKinds = Array.from(ORDER_END_MESSAGE_KINDS);

export async function listRecentThreads(ctx: { businessId: string }, input: { limit: number; channelIdentityId?: string | null }) {
  const whereConditions = [
    eq(messageThreads.businessId, ctx.businessId),
    isNull(messageThreads.deletedAt),
    eq(customers.businessId, ctx.businessId),
    isNull(customers.deletedAt),
  ];

  if (input.channelIdentityId) {
    whereConditions.push(eq(messageThreads.channelIdentityId, input.channelIdentityId));
  }

  const rows = await db
    .select({
      threadId: messageThreads.id,
      customerId: customers.id,
      customerName: customers.name,
      customerExternalId: customers.externalId,
      customerPhone: customers.phone,
      customerSource: customers.source,
      status: messageThreads.status,
      lastMessageAt: messageThreads.lastMessageAt,
      lastMessageDirection: lastMessageDirectionSelection,
      threadCreatedAt: messageThreads.createdAt,
      channelIdentityId: messageThreads.channelIdentityId,
    })
    .from(messageThreads)
    .innerJoin(customers, eq(messageThreads.customerId, customers.id))
    .where(and(...whereConditions))
    .orderBy(desc(messageThreads.lastMessageAt), desc(messageThreads.createdAt))
    .limit(input.limit);

  return rows;
}

export async function listRecentThreadsPage(ctx: { businessId: string }, input: {
  limit: number;
  channelIdentityId?: string | null;
  query?: string;
  cursorThreadId?: string;
  cursorSortAt?: string;
}) {
  const whereConditions = [
    eq(messageThreads.businessId, ctx.businessId),
    isNull(messageThreads.deletedAt),
    eq(customers.businessId, ctx.businessId),
    isNull(customers.deletedAt),
  ];

  if (input.channelIdentityId) {
    whereConditions.push(eq(messageThreads.channelIdentityId, input.channelIdentityId));
  }

  const trimmedQuery = String(input.query || "").trim();
  if (trimmedQuery) {
    const pattern = `%${trimmedQuery}%`;
    const digitsQuery = digitsOnly(trimmedQuery);
    const digitPattern = `%${digitsQuery}%`;
    whereConditions.push(
      or(
        ilike(customers.name, pattern),
        ilike(customers.phone, pattern),
        ilike(customers.externalId, pattern),
        ...(digitsQuery
          ? [
              sql`regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]+', '', 'g') ilike ${digitPattern}`,
              sql`regexp_replace(coalesce(${customers.externalId}, ''), '[^0-9]+', '', 'g') ilike ${digitPattern}`,
            ]
          : []),
      )!,
    );
  }

  const sortAtExpr = sql<Date>`coalesce(${messageThreads.lastMessageAt}, ${messageThreads.createdAt})`;
  if (input.cursorThreadId && input.cursorSortAt) {
    const cursorSortAt = new Date(input.cursorSortAt);
    whereConditions.push(
      or(
        lt(sortAtExpr, cursorSortAt),
        and(eq(sortAtExpr, cursorSortAt), lt(messageThreads.id, input.cursorThreadId)),
      )!,
    );
  }

  const rows = await db
    .select({
      threadId: messageThreads.id,
      customerId: customers.id,
      customerName: customers.name,
      customerExternalId: customers.externalId,
      customerPhone: customers.phone,
      customerSource: customers.source,
      status: messageThreads.status,
      lastMessageAt: messageThreads.lastMessageAt,
      lastMessageDirection: lastMessageDirectionSelection,
      threadCreatedAt: messageThreads.createdAt,
      channelIdentityId: messageThreads.channelIdentityId,
      sortAt: sortAtExpr,
    })
    .from(messageThreads)
    .innerJoin(customers, eq(messageThreads.customerId, customers.id))
    .where(and(...whereConditions))
    .orderBy(desc(sortAtExpr), desc(messageThreads.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const lastItem = items[items.length - 1];

  return {
    items,
    hasMore,
    nextCursor:
      hasMore && lastItem
        ? {
            threadId: lastItem.threadId,
            sortAt: lastItem.sortAt instanceof Date ? lastItem.sortAt.toISOString() : new Date(lastItem.sortAt).toISOString(),
          }
        : null,
  };
}

export async function searchCustomers(ctx: { businessId: string }, input: {
  query: string;
  source: "whatsapp" | "shopee" | "lazada" | "telegram" | "instagram" | "facebook" | "email" | "web" | "other";
  limit: number;
}) {
  const q = input.query.trim();
  const pattern = `%${q}%`;
  const digitsQuery = digitsOnly(q);
  const digitPattern = `%${digitsQuery}%`;

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      externalId: customers.externalId,
      phone: customers.phone,
      lastMessageAt: customers.lastMessageAt,
      source: customers.source,
    })
    .from(customers)
    .where(
      and(
        eq(customers.businessId, ctx.businessId),
        eq(customers.source, input.source),
        isNull(customers.deletedAt),
        or(
          ilike(customers.externalId, pattern),
          ilike(customers.phone, pattern),
          ...(digitsQuery
            ? [
                sql`regexp_replace(coalesce(${customers.externalId}, ''), '[^0-9]+', '', 'g') ilike ${digitPattern}`,
                sql`regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]+', '', 'g') ilike ${digitPattern}`,
              ]
            : []),
        ),
      ),
    )
    .orderBy(desc(customers.lastMessageAt))
    .limit(input.limit);

  return rows;
}

export async function listThreadsForCustomer(ctx: { businessId: string }, input: { customerId: string }) {
  const rows = await db
    .select({
      id: messageThreads.id,
      status: messageThreads.status,
      lastMessageAt: messageThreads.lastMessageAt,
      createdAt: messageThreads.createdAt,
    })
    .from(messageThreads)
    .where(
      and(
        eq(messageThreads.businessId, ctx.businessId),
        eq(messageThreads.customerId, input.customerId),
        isNull(messageThreads.deletedAt),
      ),
    )
    .orderBy(desc(messageThreads.lastMessageAt));

  return rows;
}

export async function listMessages(ctx: { businessId: string }, input: {
  threadId: string;
  limit: number;
  cursor?: string;
}) {
  const [thread] = await db
    .select({ id: messageThreads.id })
    .from(messageThreads)
    .where(
      and(
        eq(messageThreads.id, input.threadId),
        eq(messageThreads.businessId, ctx.businessId),
        isNull(messageThreads.deletedAt),
      ),
    )
    .limit(1);

  if (!thread) {
    return null;
  }

  let cursorDate: Date | null = null;
  if (input.cursor) {
    const [cursorMsg] = await db
      .select({ createdAt: threadMessages.createdAt })
      .from(threadMessages)
      .where(eq(threadMessages.id, input.cursor))
      .limit(1);
    cursorDate = cursorMsg?.createdAt ?? null;
  }

  const rows = await db
    .select(threadMessageSelection)
    .from(threadMessages)
    .where(
      cursorDate
        ? and(
            eq(threadMessages.threadId, input.threadId),
            lt(threadMessages.createdAt, cursorDate),
          )
        : eq(threadMessages.threadId, input.threadId),
    )
    .orderBy(desc(threadMessages.createdAt))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;

  return {
    messages: [...items].reverse(),
    nextCursor: hasMore ? items[items.length - 1]?.id : null,
    hasMore,
  };
}

export async function getOrderThreadAnchor(ctx: { businessId: string }, input: { orderId: string }) {
  const [order] = await db
    .select({
      id: orders.id,
      threadId: orders.threadId,
      threadAnchorMessageId: orders.threadAnchorMessageId,
    })
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.businessId, ctx.businessId)))
    .limit(1);

  if (!order?.threadId) {
    return { threadId: null, anchorMessageId: null, anchorCreatedAt: null as Date | null };
  }

  if (order.threadAnchorMessageId) {
    const [storedAnchor] = await db
      .select({
        id: threadMessages.id,
        createdAt: threadMessages.createdAt,
      })
      .from(threadMessages)
      .where(
        and(
          eq(threadMessages.id, order.threadAnchorMessageId),
          eq(threadMessages.threadId, order.threadId),
        ),
      )
      .limit(1);

    if (storedAnchor) {
      return {
        threadId: order.threadId,
        anchorMessageId: storedAnchor.id,
        anchorCreatedAt: storedAnchor.createdAt,
      };
    }
  }

  const [linkedAnchor] = await db
    .select({
      id: threadMessages.id,
      createdAt: threadMessages.createdAt,
    })
    .from(threadMessages)
    .where(
      and(
        eq(threadMessages.threadId, order.threadId),
        eq(threadMessages.linkedOrderId, input.orderId),
        inArray(threadMessages.messageKind, orderEndMessageKinds),
      ),
    )
    .orderBy(desc(threadMessages.createdAt), desc(threadMessages.id))
    .limit(1);

  if (linkedAnchor) {
    return {
      threadId: order.threadId,
      anchorMessageId: linkedAnchor.id,
      anchorCreatedAt: linkedAnchor.createdAt,
    };
  }

  const [legacyAnchor] = await db
    .select({
      id: threadMessages.id,
      createdAt: threadMessages.createdAt,
    })
    .from(threadMessages)
    .where(
      and(
        eq(threadMessages.threadId, order.threadId),
        or(
          sql`${threadMessages.meta} -> 'orderAnchor' ->> 'orderId' = ${input.orderId}`,
          sql`${threadMessages.meta} -> 'sourceMeta' ->> 'orderId' = ${input.orderId}`,
        ),
      ),
    )
    .orderBy(desc(threadMessages.createdAt), desc(threadMessages.id))
    .limit(1);

  return {
    threadId: order.threadId,
    anchorMessageId: legacyAnchor?.id ?? null,
    anchorCreatedAt: legacyAnchor?.createdAt ?? null,
  };
}

export async function listThreadWindow(ctx: { businessId: string }, input: {
  threadId: string;
  anchorMessageId?: string;
  beforeLimit: number;
  afterLimit: number;
  olderCursor?: string;
  newerCursor?: string;
}) {
  const [thread] = await db
    .select({ id: messageThreads.id })
    .from(messageThreads)
    .where(
      and(
        eq(messageThreads.id, input.threadId),
        eq(messageThreads.businessId, ctx.businessId),
        isNull(messageThreads.deletedAt),
      ),
    )
    .limit(1);

  if (!thread) {
    return null;
  }

  if (input.olderCursor) {
    const [cursorMsg] = await db
      .select({ createdAt: threadMessages.createdAt })
      .from(threadMessages)
      .where(eq(threadMessages.id, input.olderCursor))
      .limit(1);
    const cursorDate = cursorMsg?.createdAt ?? null;
    if (!cursorDate) {
      return {
        messages: [],
        anchorMessageId: input.anchorMessageId ?? null,
        hasMoreBefore: false,
        hasMoreAfter: false,
        olderCursor: null,
        newerCursor: null,
      };
    }

    const rows = await db
      .select(threadMessageSelection)
      .from(threadMessages)
      .where(and(eq(threadMessages.threadId, input.threadId), lt(threadMessages.createdAt, cursorDate)))
      .orderBy(desc(threadMessages.createdAt))
      .limit(input.beforeLimit + 1);

    const hasMoreBefore = rows.length > input.beforeLimit;
    const batch = hasMoreBefore ? rows.slice(0, input.beforeLimit) : rows;
    return {
      messages: [...batch].reverse(),
      anchorMessageId: input.anchorMessageId ?? null,
      hasMoreBefore,
      hasMoreAfter: false,
      olderCursor: hasMoreBefore ? batch[batch.length - 1]?.id ?? null : null,
      newerCursor: null,
    };
  }

  if (input.newerCursor) {
    const [cursorMsg] = await db
      .select({ createdAt: threadMessages.createdAt })
      .from(threadMessages)
      .where(eq(threadMessages.id, input.newerCursor))
      .limit(1);
    const cursorDate = cursorMsg?.createdAt ?? null;
    if (!cursorDate) {
      return {
        messages: [],
        anchorMessageId: input.anchorMessageId ?? null,
        hasMoreBefore: false,
        hasMoreAfter: false,
        olderCursor: null,
        newerCursor: null,
      };
    }

    const rows = await db
      .select(threadMessageSelection)
      .from(threadMessages)
      .where(and(eq(threadMessages.threadId, input.threadId), gt(threadMessages.createdAt, cursorDate)))
      .orderBy(asc(threadMessages.createdAt))
      .limit(input.afterLimit + 1);

    const hasMoreAfter = rows.length > input.afterLimit;
    const batch = hasMoreAfter ? rows.slice(0, input.afterLimit) : rows;
    return {
      messages: batch,
      anchorMessageId: input.anchorMessageId ?? null,
      hasMoreBefore: false,
      hasMoreAfter,
      olderCursor: null,
      newerCursor: hasMoreAfter ? batch[batch.length - 1]?.id ?? null : null,
    };
  }

  let anchorId = String(input.anchorMessageId || "").trim();
  let anchorDate: Date | null = null;

  if (anchorId) {
    const [anchorMsg] = await db
      .select({ id: threadMessages.id, createdAt: threadMessages.createdAt })
      .from(threadMessages)
      .where(and(eq(threadMessages.id, anchorId), eq(threadMessages.threadId, input.threadId)))
      .limit(1);
    anchorDate = anchorMsg?.createdAt ?? null;
    anchorId = anchorMsg?.id ?? "";
  }

  if (!anchorDate) {
    const [latest] = await db
      .select({ id: threadMessages.id, createdAt: threadMessages.createdAt })
      .from(threadMessages)
      .where(eq(threadMessages.threadId, input.threadId))
      .orderBy(desc(threadMessages.createdAt), desc(threadMessages.id))
      .limit(1);
    anchorId = latest?.id ?? "";
    anchorDate = latest?.createdAt ?? null;
  }

  if (!anchorDate) {
    return {
      messages: [],
      anchorMessageId: null,
      hasMoreBefore: false,
      hasMoreAfter: false,
      olderCursor: null,
      newerCursor: null,
    };
  }

  const [beforeRows, anchorRow, afterRows] = await Promise.all([
    db
      .select(threadMessageSelection)
      .from(threadMessages)
      .where(
        and(
          eq(threadMessages.threadId, input.threadId),
          or(
            lt(threadMessages.createdAt, anchorDate),
            and(eq(threadMessages.createdAt, anchorDate), lt(threadMessages.id, anchorId)),
          ),
        ),
      )
      .orderBy(desc(threadMessages.createdAt), desc(threadMessages.id))
      .limit(input.beforeLimit + 1),
    db
      .select(threadMessageSelection)
      .from(threadMessages)
      .where(eq(threadMessages.id, anchorId))
      .limit(1),
    input.afterLimit > 0
      ? db
          .select(threadMessageSelection)
          .from(threadMessages)
          .where(
            and(
              eq(threadMessages.threadId, input.threadId),
              or(
                gt(threadMessages.createdAt, anchorDate),
                and(eq(threadMessages.createdAt, anchorDate), gt(threadMessages.id, anchorId)),
              ),
            ),
          )
          .orderBy(asc(threadMessages.createdAt), asc(threadMessages.id))
          .limit(input.afterLimit + 1)
      : Promise.resolve([]),
  ]);

  const hasMoreBefore = beforeRows.length > input.beforeLimit;
  const beforeBatch = hasMoreBefore ? beforeRows.slice(0, input.beforeLimit) : beforeRows;
  const hasMoreAfter = afterRows.length > input.afterLimit;
  const afterBatch = hasMoreAfter ? afterRows.slice(0, input.afterLimit) : afterRows;

  const merged = new Map<string, (typeof beforeBatch)[number]>();
  for (const message of [...[...beforeBatch].reverse(), ...anchorRow, ...afterBatch]) {
    if (message?.id) merged.set(message.id, message);
  }

  return {
    messages: Array.from(merged.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    ),
    anchorMessageId: anchorId || null,
    hasMoreBefore,
    hasMoreAfter,
    olderCursor: hasMoreBefore ? beforeBatch[beforeBatch.length - 1]?.id ?? null : null,
    newerCursor: hasMoreAfter ? afterBatch[afterBatch.length - 1]?.id ?? null : null,
  };
}

export async function getThreadSessionWindow(ctx: { businessId: string }, input: { threadId: string }) {
  const [thread] = await db
    .select({
      id: messageThreads.id,
      channelIdentityId: messageThreads.channelIdentityId,
      customerSource: customers.source,
    })
    .from(messageThreads)
    .innerJoin(customers, eq(messageThreads.customerId, customers.id))
    .where(
      and(
        eq(messageThreads.id, input.threadId),
        eq(messageThreads.businessId, ctx.businessId),
        isNull(messageThreads.deletedAt),
        isNull(customers.deletedAt),
      ),
    )
    .limit(1);

  if (!thread) {
    return null;
  }

  const source = String(thread.customerSource || "").toLowerCase();
  const isWhatsApp = source === "whatsapp" || Boolean(thread.channelIdentityId);
  if (!isWhatsApp) {
    return {
      channel: source || "unknown",
      lastInboundAt: null as Date | null,
      closesAt: null as Date | null,
      isOpen: false,
      secondsRemaining: 0,
    };
  }

  const [agg] = await db
    .select({
      lastInboundAt: sql<Date | null>`
        max(${threadMessages.createdAt})
        filter (
          where lower(coalesce(${threadMessages.direction}, '')) in ('inbound', 'incoming', 'customer', 'user')
        )
      `,
      lastMessageAt: sql<Date | null>`max(${threadMessages.createdAt})`,
    })
    .from(threadMessages)
    .where(eq(threadMessages.threadId, input.threadId));

  const parseUtc = (value: unknown): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === "string") {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  };

  const lastInboundAt = parseUtc(agg?.lastInboundAt);
  const lastMessageAt = parseUtc(agg?.lastMessageAt);
  const windowAnchorAt = lastInboundAt ?? lastMessageAt;
  if (!windowAnchorAt) {
    return {
      channel: "whatsapp",
      lastInboundAt: null as Date | null,
      closesAt: null as Date | null,
      isOpen: false,
      secondsRemaining: 0,
    };
  }

  const closesAt = new Date(windowAnchorAt.getTime() + 24 * 60 * 60 * 1000);
  const secondsRemaining = Math.max(0, Math.floor((closesAt.getTime() - Date.now()) / 1000));
  return {
    channel: "whatsapp",
    lastInboundAt,
    closesAt,
    isOpen: secondsRemaining > 0,
    secondsRemaining,
  };
}
