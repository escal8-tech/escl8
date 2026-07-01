import { and, asc, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  customers,
  messageThreads,
  threadMessages,
} from "@/../drizzle/schema";
import { withCache, scanDelCached } from "@/lib/redis";

// Optimized: use the denormalized column directly to avoid expensive subquery
const lastMessageDirectionSelection = messageThreads.lastMessageDirection;

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

function digitsOnly(value: string) {
  return value.replace(/\D+/g, "");
}

export async function listRecentThreadsForBusiness(args: {
  businessId: string;
  limit?: number;
  channelIdentityId?: string | null;
}) {
  const cacheKey = `msg:listRecentThreads:${args.businessId}:${JSON.stringify(args)}`;
  return withCache(cacheKey, 60, async () => {
    const whereConditions = [
      eq(messageThreads.businessId, args.businessId),
      isNull(messageThreads.deletedAt),
      eq(customers.businessId, args.businessId),
      isNull(customers.deletedAt),
    ];

    if (args.channelIdentityId) {
      whereConditions.push(eq(messageThreads.channelIdentityId, args.channelIdentityId));
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
      .limit(args.limit ?? 50);
  });
}

export async function listRecentThreadsPageForBusiness(args: {
  businessId: string;
  limit: number;
  channelIdentityId?: string | null;
  query?: string;
  cursorThreadId?: string;
  cursorSortAt?: string;
}) {
  const cacheKey = `msg:listRecentThreadsPage:${args.businessId}:${JSON.stringify(args)}`;
  return withCache(cacheKey, 60, async () => {
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
  });
}

export async function listMessagesForThread(args: {
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

  if (!thread) return null;

  let cursorDate: Date | null = null;
  if (args.cursor) {
    const [cursorMsg] = await db
      .select({ createdAt: threadMessages.createdAt })
      .from(threadMessages)
      .where(eq(threadMessages.id, args.cursor))
      .limit(1);
    cursorDate = cursorMsg?.createdAt ?? null;
  }

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
    .limit(args.limit + 1);

  const hasMore = rows.length > args.limit;
  const messages = hasMore ? rows.slice(0, args.limit) : rows;

  return {
    messages: messages.reverse(),
    nextCursor: hasMore ? messages[0]?.id : null,
    hasMore,
  };
}

export async function invalidateThreadCache(businessId: string) {
  await scanDelCached(`msg:*listRecentThreads*:${businessId}:*`);
}
