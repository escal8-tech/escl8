import { db } from "../db/client";
import {
  customers,
  messageThreads,
  threadMessages,
  channelIdentities,
  whatsappIdentityDetails,
} from "@/../drizzle/schema";
import { and, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { observeAssistantMessageViaBot, sendWhatsAppMessagesViaBot } from "./botApi";
import { recordAiUsageEvent } from "./aiUsage";
import { threadMessageSelection } from "./messageReadSupport";

export async function sendText(opts: {
  businessId: string;
  userId?: string;
  firebaseUid?: string;
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
        eq(channelIdentities.businessId, opts.businessId),
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
    businessId: opts.businessId,
    phoneNumberId: identity.phoneNumberId,
    to,
    messages: [{ type: "text", text: opts.text }],
  });

  const now = new Date();
  const [saved] = await db
    .insert(threadMessages)
    .values({
      threadId: opts.threadId,
      externalMessageId: botResult?.messageId || null,
      direction: "outbound",
      messageType: "text",
      textBody: opts.text,
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
    .where(eq(messageThreads.id, opts.threadId));

  if (saved) {
    recordBusinessEvent({
      event: "message.manual_send_succeeded",
      action: "sendText",
      area: "message",
      businessId: opts.businessId,
      entity: "thread_message",
      entityId: saved.id,
      userId: opts.userId,
      actorId: opts.firebaseUid ?? opts.userId ?? null,
      actorType: "user",
      outcome: "success",
      attributes: {
        message_type: saved.messageType,
        text_length: opts.text.length,
        thread_id: opts.threadId,
        channel_identity_id: thread.channelIdentityId,
      },
    });
  }

  try {
    if (identity.aiEnabled) {
      await observeAssistantMessageViaBot({
        businessId: opts.businessId,
        phoneNumberId: thread.channelIdentityId,
        to,
        text: opts.text,
        intent: "general",
      });
      await recordAiUsageEvent({
        businessId: opts.businessId,
        channelIdentityId: thread.channelIdentityId,
        threadId: opts.threadId,
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
      businessId: opts.businessId,
      entity: "thread",
      entityId: opts.threadId,
      userId: opts.userId,
      actorId: opts.firebaseUid ?? opts.userId ?? null,
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

export async function sendMedia(opts: {
  businessId: string;
  userId?: string;
  firebaseUid?: string;
  threadId: string;
  messages: {
    type: "text" | "image" | "document";
    text?: string;
    imageUrl?: string;
    documentUrl?: string;
    filename?: string;
    caption?: string;
  }[];
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
        eq(channelIdentities.businessId, opts.businessId),
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
    businessId: opts.businessId,
    phoneNumberId: identity.phoneNumberId,
    to,
    messages: opts.messages,
  });

  const now = new Date();
  const rowsToInsert = opts.messages.map((message, index) => {
    const botResult = botResults[index];
    const sharedMeta = {
      source: "portal_manual_send",
      channelIdentityId: thread.channelIdentityId,
      providerResponse: botResult?.providerResponse ?? null,
    } as Record<string, unknown>;
    if (message.type === "text") {
      return {
        threadId: opts.threadId,
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
        threadId: opts.threadId,
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
      threadId: opts.threadId,
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
    .where(eq(messageThreads.id, opts.threadId));

  recordBusinessEvent({
    event: "message.manual_media_send_succeeded",
    action: "sendMedia",
    area: "message",
    businessId: opts.businessId,
    entity: "thread",
    entityId: opts.threadId,
    userId: opts.userId,
    actorId: opts.firebaseUid ?? opts.userId ?? null,
    actorType: "user",
    outcome: "success",
    attributes: {
      message_count: opts.messages.length,
      channel_identity_id: thread.channelIdentityId,
    },
  });

  try {
    if (identity.aiEnabled) {
      const observationText = opts.messages
        .map((message) => {
          if (message.type === "text") return message.text;
          if (message.type === "image") return message.caption || "[image sent by staff]";
          return message.caption || message.filename || "[document sent by staff]";
        })
        .filter(Boolean)
        .join("\n");
      if (observationText) {
        await observeAssistantMessageViaBot({
          businessId: opts.businessId,
          phoneNumberId: thread.channelIdentityId,
          to,
          text: observationText,
          intent: "general",
        });
      }
      await recordAiUsageEvent({
        businessId: opts.businessId,
        channelIdentityId: thread.channelIdentityId,
        threadId: opts.threadId,
        eventType: "manual_outbound_message",
        source: "portal_manual_send",
        credits: opts.messages.length,
        metadata: {
          customerExternalId: thread.customerExternalId ?? null,
          messageCount: opts.messages.length,
        },
      });
    }
  } catch {
    recordBusinessEvent({
      event: "message.manual_send_observe_failed",
      action: "sendMedia",
      area: "message",
      businessId: opts.businessId,
      entity: "thread",
      entityId: opts.threadId,
      userId: opts.userId,
      actorId: opts.firebaseUid ?? opts.userId ?? null,
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
