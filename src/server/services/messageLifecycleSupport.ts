import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  customers,
  messageThreads,
  threadMessages,
  channelIdentities,
  whatsappIdentityDetails,
} from "@/../drizzle/schema";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { observeAssistantMessageViaBot, sendWhatsAppMessagesViaBot } from "./botApi";
import { recordAiUsageEvent } from "./aiUsage";
import { type Context } from "../trpc";
import { withStatsCache } from "@/server/lib/statsCache";

type BusinessContext = Context & { businessId: string; firebaseUid: string; userId: string };

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

export async function listRecentThreads(ctx: { businessId: string }, input: { limit: number; channelIdentityId?: string | null }) {
  const cacheKey = `messages:recentThreads:${ctx.businessId}:${input.limit}:${input.channelIdentityId ?? 'all'}`;
  return withStatsCache(cacheKey, 60, async () => {
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
  });
}

export async function listRecentThreadsPage(ctx: { businessId: string }, input: { limit: number; channelIdentityId?: string | null; query?: string; cursorThreadId?: string; cursorSortAt?: string }) {
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

export async function listMessages(ctx: { businessId: string }, input: { threadId: string; limit: number; cursor?: string }) {
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
    throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
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
  const messages = hasMore ? rows.slice(0, input.limit) : rows;

  return {
    messages: messages.reverse(),
    nextCursor: hasMore ? messages[0]?.id : null,
    hasMore,
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
    throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
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
      messages: batch.reverse(),
      anchorMessageId: input.anchorMessageId ?? null,
      hasMoreBefore,
      hasMoreAfter: false,
      olderCursor: hasMoreBefore ? batch[0]?.id ?? null : null,
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

  const beforeRows = await db
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
    .limit(input.beforeLimit + 1);

  const anchorRow = await db
    .select(threadMessageSelection)
    .from(threadMessages)
    .where(eq(threadMessages.id, anchorId))
    .limit(1);

  const afterRows =
    input.afterLimit > 0
      ? await db
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
      : [];

  const hasMoreBefore = beforeRows.length > input.beforeLimit;
  const beforeBatch = hasMoreBefore ? beforeRows.slice(0, input.beforeLimit) : beforeRows;
  const hasMoreAfter = afterRows.length > input.afterLimit;
  const afterBatch = hasMoreAfter ? afterRows.slice(0, input.afterLimit) : afterRows;

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

const parseUtc = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

export async function getThreadSessionWindow(ctx: { businessId: string }, input: { threadId: string }) {
  const cacheKey = `messages:sessionWindow:${ctx.businessId}:${input.threadId}`;
  return withStatsCache(cacheKey, 30, async () => {
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
      .where(eq(threadMessages.threadId, input.threadId));

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
  });
}

export async function sendText(ctx: BusinessContext, input: { threadId: string; text: string }) {
  const [thread] = await db
    .select({
      id: messageThreads.id,
      channelIdentityId: messageThreads.channelIdentityId,
      customerExternalId: customers.externalId,
      customerPhone: customers.phone,
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
    throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
  }
  if (thread.customerSource !== "whatsapp") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Manual send is supported only for WhatsApp threads." });
  }
  if (!thread.channelIdentityId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Thread has no WhatsApp identity configured." });
  }

  const [identity] = await db
    .select({
      phoneNumberId: whatsappIdentityDetails.phoneNumberId,
      aiEnabled: channelIdentities.aiEnabled,
    })
    .from(channelIdentities)
    .innerJoin(whatsappIdentityDetails, eq(channelIdentities.id, whatsappIdentityDetails.channelIdentityId))
    .where(
      and(
        eq(channelIdentities.id, thread.channelIdentityId),
        eq(channelIdentities.businessId, ctx.businessId),
      ),
    )
    .limit(1);
  if (!identity) {
    throw new TRPCError({ code: "NOT_FOUND", message: "WhatsApp identity not found for this business." });
  }

  const toRaw = String(thread.customerExternalId || thread.customerPhone || "").trim();
  const to = toRaw.replace(/[^\d]/g, "");
  if (!to) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Customer WhatsApp ID is missing." });
  }

  const [botResult] = await sendWhatsAppMessagesViaBot({
    businessId: ctx.businessId,
    phoneNumberId: identity.phoneNumberId,
    to,
    messages: [{ type: "text", text: input.text }],
  });

  const now = new Date();
  const [saved] = await db
    .insert(threadMessages)
    .values({
      threadId: input.threadId,
      externalMessageId: botResult?.messageId || null,
      direction: "outbound",
      messageType: "text",
      textBody: input.text,
      meta: {
        source: "portal_manual_send",
        channelIdentityId: thread.channelIdentityId,
        providerResponse: botResult?.providerResponse ?? null,
      },
      createdAt: now,
    })
    .returning(threadMessageSelection);

  await db
    .update(messageThreads)
    .set({
      lastMessageAt: now,
      lastMessageDirection: "outbound",
      updatedAt: now,
    })
    .where(eq(messageThreads.id, input.threadId));

  if (saved) {
    recordBusinessEvent({
      event: "message.manual_send_succeeded",
      action: "sendText",
      area: "message",
      businessId: ctx.businessId,
      entity: "thread_message",
      entityId: saved.id,
      userId: ctx.userId,
      actorId: ctx.firebaseUid ?? ctx.userId ?? null,
      actorType: "user",
      outcome: "success",
      attributes: {
        message_type: saved.messageType,
        text_length: input.text.length,
        thread_id: input.threadId,
        channel_identity_id: thread.channelIdentityId,
      },
    });
  }

  try {
    if (identity.aiEnabled) {
      await observeAssistantMessageViaBot({
        businessId: ctx.businessId,
        phoneNumberId: thread.channelIdentityId,
        to,
        text: input.text,
        intent: "general",
      });
      await recordAiUsageEvent({
        businessId: ctx.businessId,
        channelIdentityId: thread.channelIdentityId,
        threadId: input.threadId,
        eventType: "manual_outbound_message",
        source: "portal_manual_send",
        credits: 1,
        metadata: {
          customerExternalId: thread.customerExternalId ?? null,
        },
      });
    }
  } catch {
    recordBusinessEvent({
      event: "message.manual_send_observe_failed",
      action: "sendText",
      area: "message",
      businessId: ctx.businessId,
      entity: "thread",
      entityId: input.threadId,
      userId: ctx.userId,
      actorId: ctx.firebaseUid ?? ctx.userId ?? null,
      actorType: "user",
      outcome: "degraded",
      status: "assistant_observe_failed",
      attributes: {
        channel_identity_id: thread.channelIdentityId,
      },
    });
  }

  return saved;
}

export async function sendMedia(ctx: BusinessContext, input: { threadId: string; messages: any[] }) {
  const [thread] = await db
    .select({
      id: messageThreads.id,
      channelIdentityId: messageThreads.channelIdentityId,
      customerExternalId: customers.externalId,
      customerPhone: customers.phone,
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
    throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
  }
  if (thread.customerSource !== "whatsapp") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Manual send is supported only for WhatsApp threads." });
  }
  if (!thread.channelIdentityId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Thread has no WhatsApp identity configured." });
  }

  const [identity] = await db
    .select({
      phoneNumberId: whatsappIdentityDetails.phoneNumberId,
      aiEnabled: channelIdentities.aiEnabled,
    })
    .from(channelIdentities)
    .innerJoin(whatsappIdentityDetails, eq(channelIdentities.id, whatsappIdentityDetails.channelIdentityId))
    .where(
      and(
        eq(channelIdentities.id, thread.channelIdentityId),
        eq(channelIdentities.businessId, ctx.businessId),
      ),
    )
    .limit(1);
  if (!identity) {
    throw new TRPCError({ code: "NOT_FOUND", message: "WhatsApp identity not found for this business." });
  }

  const toRaw = String(thread.customerExternalId || thread.customerPhone || "").trim();
  const to = toRaw.replace(/[^\d]/g, "");
  if (!to) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Customer WhatsApp ID is missing." });
  }

  const botResults = await sendWhatsAppMessagesViaBot({
    businessId: ctx.businessId,
    phoneNumberId: identity.phoneNumberId,
    to,
    messages: input.messages,
  });

  const now = new Date();
  const rowsToInsert = input.messages.map((message: any, index: number) => {
    const botResult = botResults[index];
    const sharedMeta = {
      source: "portal_manual_send",
      channelIdentityId: thread.channelIdentityId,
      providerResponse: botResult?.providerResponse ?? null,
    } as Record<string, unknown>;
    if (message.type === "text") {
      return {
        threadId: input.threadId,
        externalMessageId: botResult?.messageId || null,
        direction: "outbound" as const,
        messageType: "text",
        textBody: message.text,
        meta: sharedMeta,
        createdAt: now,
      };
    }
    if (message.type === "image") {
      return {
        threadId: input.threadId,
        externalMessageId: botResult?.messageId || null,
        direction: "outbound" as const,
        messageType: "image",
        textBody: message.caption || "[image]",
        meta: {
          ...sharedMeta,
          imageUrl: message.imageUrl,
          ...(message.caption ? { caption: message.caption } : {}),
        },
        createdAt: now,
      };
    }
    return {
      threadId: input.threadId,
      externalMessageId: botResult?.messageId || null,
      direction: "outbound" as const,
      messageType: "document",
      textBody: message.caption || message.filename || "[document]",
      meta: {
        ...sharedMeta,
        documentUrl: message.documentUrl,
        ...(message.filename ? { filename: message.filename } : {}),
        ...(message.caption ? { caption: message.caption } : {}),
      },
      createdAt: now,
    };
  });

  const saved = await db
    .insert(threadMessages)
    .values(rowsToInsert)
    .returning(threadMessageSelection);

  await db
    .update(messageThreads)
    .set({
      lastMessageAt: now,
      lastMessageDirection: "outbound",
      updatedAt: now,
    })
    .where(eq(messageThreads.id, input.threadId));

  recordBusinessEvent({
    event: "message.manual_media_send_succeeded",
    action: "sendMedia",
    area: "message",
    businessId: ctx.businessId,
    entity: "thread",
    entityId: input.threadId,
    userId: ctx.userId,
    actorId: ctx.firebaseUid ?? ctx.userId ?? null,
    actorType: "user",
    outcome: "success",
    attributes: {
      message_count: input.messages.length,
      channel_identity_id: thread.channelIdentityId,
    },
  });

  try {
    if (identity.aiEnabled) {
      const observationText = input.messages
        .map((message: any) => {
          if (message.type === "text") return message.text;
          if (message.type === "image") return message.caption || "[image sent by staff]";
          return message.caption || message.filename || "[document sent by staff]";
        })
        .filter(Boolean)
        .join("\n");
      if (observationText) {
        await observeAssistantMessageViaBot({
          businessId: ctx.businessId,
          phoneNumberId: thread.channelIdentityId,
          to,
          text: observationText,
          intent: "general",
        });
      }
      await recordAiUsageEvent({
        businessId: ctx.businessId,
        channelIdentityId: thread.channelIdentityId,
        threadId: input.threadId,
        eventType: "manual_outbound_message",
        source: "portal_manual_send",
        credits: input.messages.length,
        metadata: {
          customerExternalId: thread.customerExternalId ?? null,
          messageCount: input.messages.length,
        },
      });
    }
  } catch {
    recordBusinessEvent({
      event: "message.manual_send_observe_failed",
      action: "sendMedia",
      area: "message",
      businessId: ctx.businessId,
      entity: "thread",
      entityId: input.threadId,
      userId: ctx.userId,
      actorId: ctx.firebaseUid ?? ctx.userId ?? null,
      actorType: "user",
      outcome: "degraded",
      status: "assistant_observe_failed",
      attributes: {
        channel_identity_id: thread.channelIdentityId,
      },
    });
  }

  return saved;
}
