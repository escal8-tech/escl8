import { db } from "../db/client";
import {
  customers,
  messageThreads,
  orders,
  threadMessages,
  channelIdentities,
  whatsappIdentityDetails,
} from "@/../drizzle/schema";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { ORDER_END_MESSAGE_KINDS } from "@/lib/messageFields";
import { TRPCError } from "@trpc/server";

const lastMessageDirectionExpr = sql<string | null>`(
  select tm.direction
  from thread_messages tm
  where tm.thread_id = ${messageThreads.id}
  order by tm.created_at desc, tm.id desc
  limit 1
)`;
export const lastMessageDirectionSelection = sql<string | null>`coalesce(${messageThreads.lastMessageDirection}, ${lastMessageDirectionExpr})`;

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
const digitsOnly = (value: string) => value.replace(/\D+/g, "");

export async function listRecentThreads(opts: {
  businessId: string;
  limit: number;
  channelIdentityId?: string | null;
}) {
  const whereConditions = [
    eq(messageThreads.businessId, opts.businessId),
    isNull(messageThreads.deletedAt),
    eq(customers.businessId, opts.businessId),
    isNull(customers.deletedAt),
  ];

  if (opts.channelIdentityId) {
    whereConditions.push(eq(messageThreads.channelIdentityId, opts.channelIdentityId));
  }

  return db
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
    .limit(opts.limit);
}

export async function listRecentThreadsPage(opts: {
  businessId: string;
  limit: number;
  channelIdentityId?: string | null;
  query?: string;
  cursorThreadId?: string;
  cursorSortAt?: string;
}) {
  const whereConditions = [
    eq(messageThreads.businessId, opts.businessId),
    isNull(messageThreads.deletedAt),
    eq(customers.businessId, opts.businessId),
    isNull(customers.deletedAt),
  ];

  if (opts.channelIdentityId) {
    whereConditions.push(eq(messageThreads.channelIdentityId, opts.channelIdentityId));
  }

  const trimmedQuery = String(opts.query || "").trim();
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
  if (opts.cursorThreadId && opts.cursorSortAt) {
    const cursorSortAt = new Date(opts.cursorSortAt);
    whereConditions.push(
      or(
        lt(sortAtExpr, cursorSortAt),
        and(eq(sortAtExpr, cursorSortAt), lt(messageThreads.id, opts.cursorThreadId)),
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
    .limit(opts.limit + 1);

  const hasMore = rows.length > opts.limit;
  const items = hasMore ? rows.slice(0, opts.limit) : rows;
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

export async function searchCustomers(opts: {
  businessId: string;
  query: string;
  source: string;
  limit: number;
}) {
  const q = opts.query.trim();
  const pattern = `%${q}%`;
  const digitsQuery = digitsOnly(q);
  const digitPattern = `%${digitsQuery}%`;

  return db
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
        eq(customers.businessId, opts.businessId),
        eq(customers.source, opts.source),
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
    .limit(opts.limit);
}

export async function listThreadsForCustomer(opts: { businessId: string; customerId: string }) {
  return db
    .select({
      id: messageThreads.id,
      status: messageThreads.status,
      lastMessageAt: messageThreads.lastMessageAt,
      createdAt: messageThreads.createdAt,
    })
    .from(messageThreads)
    .where(
      and(
        eq(messageThreads.businessId, opts.businessId),
        eq(messageThreads.customerId, opts.customerId),
        isNull(messageThreads.deletedAt),
      ),
    )
    .orderBy(desc(messageThreads.lastMessageAt));
}

export async function listMessages(opts: {
  businessId: string;
  threadId: string;
  limit: number;
  cursor?: string;
}) {
  const [thread] = await db
    .select({ id: messageThreads.id })
    .from(messageThreads)
    .where(
      and(
        eq(messageThreads.id, opts.threadId),
        eq(messageThreads.businessId, opts.businessId),
        isNull(messageThreads.deletedAt),
      ),
    )
    .limit(1);

  if (!thread) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
  }

  let cursorDate: Date | null = null;
  if (opts.cursor) {
    const [cursorMsg] = await db
      .select({ createdAt: threadMessages.createdAt })
      .from(threadMessages)
      .where(eq(threadMessages.id, opts.cursor))
      .limit(1);
    cursorDate = cursorMsg?.createdAt ?? null;
  }

  const rows = await db
    .select(threadMessageSelection)
    .from(threadMessages)
    .where(
      cursorDate
        ? and(
            eq(threadMessages.threadId, opts.threadId),
            lt(threadMessages.createdAt, cursorDate),
          )
        : eq(threadMessages.threadId, opts.threadId),
    )
    .orderBy(desc(threadMessages.createdAt))
    .limit(opts.limit + 1);

  const hasMore = rows.length > opts.limit;
  const messages = hasMore ? rows.slice(0, opts.limit) : rows;

  return {
    messages: messages.reverse(),
    nextCursor: hasMore ? messages[0]?.id : null,
    hasMore,
  };
}

export async function getOrderThreadAnchor(opts: { businessId: string; orderId: string }) {
  const [order] = await db
    .select({
      id: orders.id,
      threadId: orders.threadId,
      threadAnchorMessageId: orders.threadAnchorMessageId,
    })
    .from(orders)
    .where(and(eq(orders.id, opts.orderId), eq(orders.businessId, opts.businessId)))
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
        eq(threadMessages.linkedOrderId, opts.orderId),
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
          sql`${threadMessages.meta} -> 'orderAnchor' ->> 'orderId' = ${opts.orderId}`,
          sql`${threadMessages.meta} -> 'sourceMeta' ->> 'orderId' = ${opts.orderId}`,
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

export async function listThreadWindow(opts: {
  businessId: string;
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
        eq(messageThreads.id, opts.threadId),
        eq(messageThreads.businessId, opts.businessId),
        isNull(messageThreads.deletedAt),
      ),
    )
    .limit(1);

  if (!thread) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
  }

  if (opts.olderCursor) {
    const [cursorMsg] = await db
      .select({ createdAt: threadMessages.createdAt })
      .from(threadMessages)
      .where(eq(threadMessages.id, opts.olderCursor))
      .limit(1);
    const cursorDate = cursorMsg?.createdAt ?? null;
    if (!cursorDate) {
      return {
        messages: [],
        anchorMessageId: opts.anchorMessageId ?? null,
        hasMoreBefore: false,
        hasMoreAfter: false,
        olderCursor: null,
        newerCursor: null,
      };
    }

    const rows = await db
      .select(threadMessageSelection)
      .from(threadMessages)
      .where(and(eq(threadMessages.threadId, opts.threadId), lt(threadMessages.createdAt, cursorDate)))
      .orderBy(desc(threadMessages.createdAt))
      .limit(opts.beforeLimit + 1);

    const hasMoreBefore = rows.length > opts.beforeLimit;
    const batch = hasMoreBefore ? rows.slice(0, opts.beforeLimit) : rows;
    return {
      messages: batch.reverse(),
      anchorMessageId: opts.anchorMessageId ?? null,
      hasMoreBefore,
      hasMoreAfter: false,
      olderCursor: hasMoreBefore ? batch[0]?.id ?? null : null,
      newerCursor: null,
    };
  }

  if (opts.newerCursor) {
    const [cursorMsg] = await db
      .select({ createdAt: threadMessages.createdAt })
      .from(threadMessages)
      .where(eq(threadMessages.id, opts.newerCursor))
      .limit(1);
    const cursorDate = cursorMsg?.createdAt ?? null;
    if (!cursorDate) {
      return {
        messages: [],
        anchorMessageId: opts.anchorMessageId ?? null,
        hasMoreBefore: false,
        hasMoreAfter: false,
        olderCursor: null,
        newerCursor: null,
      };
    }

    const rows = await db
      .select(threadMessageSelection)
      .from(threadMessages)
      .where(and(eq(threadMessages.threadId, opts.threadId), gt(threadMessages.createdAt, cursorDate)))
      .orderBy(asc(threadMessages.createdAt))
      .limit(opts.afterLimit + 1);

    const hasMoreAfter = rows.length > opts.afterLimit;
    const batch = hasMoreAfter ? rows.slice(0, opts.afterLimit) : rows;
    return {
      messages: batch,
      anchorMessageId: opts.anchorMessageId ?? null,
      hasMoreBefore: false,
      hasMoreAfter,
      olderCursor: null,
      newerCursor: hasMoreAfter ? batch[batch.length - 1]?.id ?? null : null,
    };
  }

  let anchorId = String(opts.anchorMessageId || "").trim();
  let anchorDate: Date | null = null;

  if (anchorId) {
    const [anchorMsg] = await db
      .select({ id: threadMessages.id, createdAt: threadMessages.createdAt })
      .from(threadMessages)
      .where(and(eq(threadMessages.id, anchorId), eq(threadMessages.threadId, opts.threadId)))
      .limit(1);
    anchorDate = anchorMsg?.createdAt ?? null;
    anchorId = anchorMsg?.id ?? "";
  }

  if (!anchorDate) {
    const [latest] = await db
      .select({ id: threadMessages.id, createdAt: threadMessages.createdAt })
      .from(threadMessages)
      .where(eq(threadMessages.threadId, opts.threadId))
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

  // Performance Optimization: Parallelize these queries
  const [beforeRows, anchorRow, afterRows] = await Promise.all([
    db
      .select(threadMessageSelection)
      .from(threadMessages)
      .where(
        and(
          eq(threadMessages.threadId, opts.threadId),
          or(
            lt(threadMessages.createdAt, anchorDate),
            and(eq(threadMessages.createdAt, anchorDate), lt(threadMessages.id, anchorId)),
          ),
        ),
      )
      .orderBy(desc(threadMessages.createdAt), desc(threadMessages.id))
      .limit(opts.beforeLimit + 1),
    db
      .select(threadMessageSelection)
      .from(threadMessages)
      .where(eq(threadMessages.id, anchorId))
      .limit(1),
    opts.afterLimit > 0
      ? db
          .select(threadMessageSelection)
          .from(threadMessages)
          .where(
            and(
              eq(threadMessages.threadId, opts.threadId),
              or(
                gt(threadMessages.createdAt, anchorDate),
                and(eq(threadMessages.createdAt, anchorDate), gt(threadMessages.id, anchorId)),
              ),
            ),
          )
          .orderBy(asc(threadMessages.createdAt), asc(threadMessages.id))
          .limit(opts.afterLimit + 1)
      : Promise.resolve([]),
  ]);

  const hasMoreBefore = beforeRows.length > opts.beforeLimit;
  const beforeBatch = hasMoreBefore ? beforeRows.slice(0, opts.beforeLimit) : beforeRows;
  const hasMoreAfter = afterRows.length > opts.afterLimit;
  const afterBatch = hasMoreAfter ? afterRows.slice(0, opts.afterLimit) : afterRows;

  const merged = new Map<string, (typeof beforeBatch)[number]>();
  for (const message of [...beforeBatch.reverse(), ...anchorRow, ...afterBatch]) {
    if (message?.id) merged.set(message.id, message);
  }

  return {
    messages: Array.from(merged.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    ),
    anchorMessageId: anchorId || null,
    hasMoreBefore,
    hasMoreAfter,
    olderCursor: hasMoreBefore ? beforeBatch[0]?.id ?? null : null,
    newerCursor: hasMoreAfter ? afterBatch[afterBatch.length - 1]?.id ?? null : null,
  };
}

export async function getThreadSessionWindow(opts: { businessId: string; threadId: string }) {
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
        eq(messageThreads.id, opts.threadId),
        eq(messageThreads.businessId, opts.businessId),
        isNull(messageThreads.deletedAt),
        isNull(customers.deletedAt),
      ),
    )
    .limit(1);

  if (!thread) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
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
    .where(eq(threadMessages.threadId, opts.threadId));

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
