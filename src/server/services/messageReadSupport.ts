import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../db/client";
import {
  customers,
  messageThreads,
  orders,
  threadMessages,
} from "@/../drizzle/schema";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
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

const threadMessageSelection = {
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

export async function listRecentThreads(args: {
  businessId: string;
  limit: number;
  channelIdentityId?: string | null;
}) {
  const whereConditions = [
    eq(messageThreads.businessId, args.businessId),
    isNull(messageThreads.deletedAt),
    eq(customers.businessId, args.businessId),
    isNull(customers.deletedAt),
  ];

  if (args.channelIdentityId) {
    whereConditions.push(eq(messageThreads.channelIdentityId, args.channelIdentityId));
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
    .limit(args.limit);

  return rows;
}

export async function listRecentThreadsPage(args: {
  businessId: string;
  limit: number;
  channelIdentityId?: string | null;
  query?: string;
  cursorThreadId?: string;
  cursorSortAt?: string;
}) {
  const whereConditions = [
    eq(messageThreads.businessId, args.businessId),
    isNull(messageThreads.deletedAt),
    eq(customers.businessId, args.businessId),
    isNull(customers.deletedAt),
  ];

  if (args.channelIdentityId) {
    whereConditions.push(eq(messageThreads.channelIdentityId, args.channelIdentityId));
  }

  const trimmedQuery = String(args.query || "").trim();
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
  if (args.cursorThreadId && args.cursorSortAt) {
    const cursorSortAt = new Date(args.cursorSortAt);
    whereConditions.push(
      or(
        lt(sortAtExpr, cursorSortAt),
        and(eq(sortAtExpr, cursorSortAt), lt(messageThreads.id, args.cursorThreadId)),
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
    .limit(args.limit + 1);

  const hasMore = rows.length > args.limit;
  const items = hasMore ? rows.slice(0, args.limit) : rows;
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

export async function searchCustomers(args: {
  businessId: string;
  query: string;
  source: string;
  limit: number;
}) {
  const q = args.query.trim();
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
        eq(customers.businessId, args.businessId),
        eq(customers.source, args.source),
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
    .limit(args.limit);

  return rows;
}

export async function listThreadsForCustomer(args: {
  businessId: string;
  customerId: string;
}) {
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
        eq(messageThreads.businessId, args.businessId),
        eq(messageThreads.customerId, args.customerId),
        isNull(messageThreads.deletedAt),
      ),
    )
    .orderBy(desc(messageThreads.lastMessageAt));

  return rows;
}

export async function listMessages(args: {
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
        eq(messageThreads.id, args.threadId),
        eq(messageThreads.businessId, args.businessId),
        isNull(messageThreads.deletedAt),
      ),
    )
    .limit(1);

  if (!thread) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
  }

  // If cursor provided, get the createdAt of that message for pagination
  let cursorDate: Date | null = null;
  if (args.cursor) {
    const [cursorMsg] = await db
      .select({ createdAt: threadMessages.createdAt })
      .from(threadMessages)
      .where(eq(threadMessages.id, args.cursor))
      .limit(1);
    cursorDate = cursorMsg?.createdAt ?? null;
  }

  // Fetch messages older than cursor (or all if no cursor), newest first
  const rows = await db
    .select(threadMessageSelection)
    .from(threadMessages)
    .where(
      cursorDate
        ? and(
            eq(threadMessages.threadId, args.threadId),
            lt(threadMessages.createdAt, cursorDate),
          )
        : eq(threadMessages.threadId, args.threadId),
    )
    .orderBy(desc(threadMessages.createdAt))
    .limit(args.limit + 1); // Fetch one extra to check if there are more

  const hasMore = rows.length > args.limit;
  const messages = hasMore ? rows.slice(0, args.limit) : rows;

  // Return in ascending order for display (oldest first within batch)
  // Client will prepend older batches
  return {
    messages: messages.reverse(),
    nextCursor: hasMore ? messages[0]?.id : null,
    hasMore,
  };
}

export async function getOrderThreadAnchor(args: {
  businessId: string;
  orderId: string;
}) {
  const [order] = await db
    .select({
      id: orders.id,
      threadId: orders.threadId,
      threadAnchorMessageId: orders.threadAnchorMessageId,
    })
    .from(orders)
    .where(and(eq(orders.id, args.orderId), eq(orders.businessId, args.businessId)))
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
        eq(threadMessages.linkedOrderId, args.orderId),
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
          sql`${threadMessages.meta} -> 'orderAnchor' ->> 'orderId' = ${args.orderId}`,
          sql`${threadMessages.meta} -> 'sourceMeta' ->> 'orderId' = ${args.orderId}`,
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

export async function listThreadWindow(args: {
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
        eq(messageThreads.id, args.threadId),
        eq(messageThreads.businessId, args.businessId),
        isNull(messageThreads.deletedAt),
      ),
    )
    .limit(1);

  if (!thread) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
  }

  if (args.olderCursor) {
    const [cursorMsg] = await db
      .select({ createdAt: threadMessages.createdAt })
      .from(threadMessages)
      .where(eq(threadMessages.id, args.olderCursor))
      .limit(1);
    const cursorDate = cursorMsg?.createdAt ?? null;
    if (!cursorDate) {
      return {
        messages: [],
        anchorMessageId: args.anchorMessageId ?? null,
        hasMoreBefore: false,
        hasMoreAfter: false,
        olderCursor: null,
        newerCursor: null,
      };
    }

    const rows = await db
      .select(threadMessageSelection)
      .from(threadMessages)
      .where(and(eq(threadMessages.threadId, args.threadId), lt(threadMessages.createdAt, cursorDate)))
      .orderBy(desc(threadMessages.createdAt))
      .limit(args.beforeLimit + 1);

    const hasMoreBefore = rows.length > args.beforeLimit;
    const batch = hasMoreBefore ? rows.slice(0, args.beforeLimit) : rows;
    return {
      messages: batch.reverse(),
      anchorMessageId: args.anchorMessageId ?? null,
      hasMoreBefore,
      hasMoreAfter: false,
      olderCursor: hasMoreBefore ? batch[0]?.id ?? null : null,
      newerCursor: null,
    };
  }

  if (args.newerCursor) {
    const [cursorMsg] = await db
      .select({ createdAt: threadMessages.createdAt })
      .from(threadMessages)
      .where(eq(threadMessages.id, args.newerCursor))
      .limit(1);
    const cursorDate = cursorMsg?.createdAt ?? null;
    if (!cursorDate) {
      return {
        messages: [],
        anchorMessageId: args.anchorMessageId ?? null,
        hasMoreBefore: false,
        hasMoreAfter: false,
        olderCursor: null,
        newerCursor: null,
      };
    }

    const rows = await db
      .select(threadMessageSelection)
      .from(threadMessages)
      .where(and(eq(threadMessages.threadId, args.threadId), gt(threadMessages.createdAt, cursorDate)))
      .orderBy(asc(threadMessages.createdAt))
      .limit(args.afterLimit + 1);

    const hasMoreAfter = rows.length > args.afterLimit;
    const batch = hasMoreAfter ? rows.slice(0, args.afterLimit) : rows;
    return {
      messages: batch,
      anchorMessageId: args.anchorMessageId ?? null,
      hasMoreBefore: false,
      hasMoreAfter,
      olderCursor: null,
      newerCursor: hasMoreAfter ? batch[batch.length - 1]?.id ?? null : null,
    };
  }

  let anchorId = String(args.anchorMessageId || "").trim();
  let anchorDate: Date | null = null;

  if (anchorId) {
    const [anchorMsg] = await db
      .select({ id: threadMessages.id, createdAt: threadMessages.createdAt })
      .from(threadMessages)
      .where(and(eq(threadMessages.id, anchorId), eq(threadMessages.threadId, args.threadId)))
      .limit(1);
    anchorDate = anchorMsg?.createdAt ?? null;
    anchorId = anchorMsg?.id ?? "";
  }

  if (!anchorDate) {
    const [latest] = await db
      .select({ id: threadMessages.id, createdAt: threadMessages.createdAt })
      .from(threadMessages)
      .where(eq(threadMessages.threadId, args.threadId))
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

  const beforeRows = await db
    .select(threadMessageSelection)
    .from(threadMessages)
    .where(
      and(
        eq(threadMessages.threadId, args.threadId),
        or(
          lt(threadMessages.createdAt, anchorDate),
          and(eq(threadMessages.createdAt, anchorDate), lt(threadMessages.id, anchorId)),
        ),
      ),
    )
    .orderBy(desc(threadMessages.createdAt), desc(threadMessages.id))
    .limit(args.beforeLimit + 1);

  const anchorRow = await db
    .select(threadMessageSelection)
    .from(threadMessages)
    .where(eq(threadMessages.id, anchorId))
    .limit(1);

  const afterRows =
    args.afterLimit > 0
      ? await db
          .select(threadMessageSelection)
          .from(threadMessages)
          .where(
            and(
              eq(threadMessages.threadId, args.threadId),
              or(
                gt(threadMessages.createdAt, anchorDate),
                and(eq(threadMessages.createdAt, anchorDate), gt(threadMessages.id, anchorId)),
              ),
            ),
          )
          .orderBy(asc(threadMessages.createdAt), asc(threadMessages.id))
          .limit(args.afterLimit + 1)
      : [];

  const hasMoreBefore = beforeRows.length > args.beforeLimit;
  const beforeBatch = hasMoreBefore ? beforeRows.slice(0, args.beforeLimit) : beforeRows;
  const hasMoreAfter = afterRows.length > args.afterLimit;
  const afterBatch = hasMoreAfter ? afterRows.slice(0, args.afterLimit) : afterRows;

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

export async function getThreadSessionWindow(args: {
  businessId: string;
  threadId: string;
}) {
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
        eq(messageThreads.id, args.threadId),
        eq(messageThreads.businessId, args.businessId),
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
    .where(eq(threadMessages.threadId, args.threadId));

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
  // Fallback for legacy rows where direction was not set consistently.
  // Use latest thread activity as the reference point for window visibility.
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
