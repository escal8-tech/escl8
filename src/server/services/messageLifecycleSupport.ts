import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../db/client";
import {
  customers,
  messageThreads,
  threadMessages,
  channelIdentities,
  whatsappIdentityDetails,
} from "@/../drizzle/schema";
import { and, eq, isNull } from "drizzle-orm";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { observeAssistantMessageViaBot, sendWhatsAppMessagesViaBot } from "../services/botApi";
import { recordAiUsageEvent } from "../services/aiUsage";
import { scanDelCached } from "@/lib/redis";

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

async function invalidateMessageCaches(businessId: string) {
  await scanDelCached(`messages:recent_threads:${businessId}`);
  await scanDelCached(`messages:recent_threads_page:${businessId}`);
}

export async function sendText(ctx: { businessId: string; userId: string; firebaseUid?: string | null }, input: {
  threadId: string;
  text: string;
}) {
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

  await invalidateMessageCaches(ctx.businessId);

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
    // Log failure but don't break the main flow
  }

  return saved;
}

export async function sendMedia(ctx: { businessId: string; userId: string; firebaseUid?: string | null }, input: {
  threadId: string;
  messages: any[];
}) {
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
  const rowsToInsert = input.messages.map((message, index) => {
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

  await invalidateMessageCaches(ctx.businessId);

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
        .map((message) => {
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
    // Log failure but don't break the main flow
  }

  return saved;
}
