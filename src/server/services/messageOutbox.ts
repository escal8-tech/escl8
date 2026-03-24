/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { messageOutbox } from "../../../drizzle/schema";
import { sendWhatsAppMessagesViaBot, type BotSendMessage } from "./botApi";
import { sendBusinessGmailMessage, type BusinessEmailMessage } from "./companyGmail";
import { persistOutboundThreadMessage, sanitizePhoneDigits } from "./orderFlow";

type JsonRecord = Record<string, unknown>;

function asJsonRecord(value: unknown): JsonRecord {
  try {
    const serialized = JSON.parse(JSON.stringify(value ?? {})) as unknown;
    if (serialized && typeof serialized === "object" && !Array.isArray(serialized)) {
      return serialized as JsonRecord;
    }
  } catch {
    // noop
  }
  return {};
}

function normalizeOutboxMessage(value: unknown): BotSendMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const type = String(row.type ?? "text").trim().toLowerCase();
  if (type === "image") {
    const imageUrl = String(row.imageUrl ?? "").trim();
    if (!imageUrl) return null;
    const caption = String(row.caption ?? "").trim();
    return caption ? { type: "image", imageUrl, caption } : { type: "image", imageUrl };
  }
  const text = String(row.text ?? "").trim();
  if (!text) return null;
  return { type: "text", text };
}

function normalizeOutboxEmail(value: unknown): BusinessEmailMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const subject = String(row.subject ?? "").trim();
  const text = String(row.text ?? "").trim();
  if (!subject || !text) return null;
  const html = String(row.html ?? "").trim();
  return {
    subject,
    text,
    html: html || null,
  };
}

export function buildOutboxMessageKey(baseKey: string, index: number): string {
  const normalized = String(baseKey || "").trim();
  return `${normalized}:${index + 1}`;
}

export async function enqueueWhatsAppOutboxMessages(
  tx: any,
  input: {
    businessId: string;
    entityType: string;
    entityId: string;
    customerId?: string | null;
    threadId?: string | null;
    whatsappIdentityId?: string | null;
    recipient?: string | null;
    source: string;
    messages: BotSendMessage[];
    idempotencyBaseKey: string;
    recipientSource?: string | null;
    whatsappIdentitySource?: string | null;
  },
) {
  if (!input.messages.length) {
    return {
      ok: true as const,
      error: null,
      recipientSource: input.recipientSource ?? null,
      whatsappIdentitySource: input.whatsappIdentitySource ?? null,
      idempotencyKeys: [] as string[],
    };
  }

  const recipient = sanitizePhoneDigits(input.recipient);
  if (!input.whatsappIdentityId || !recipient) {
    return {
      ok: false as const,
      error: "Customer notification is missing WhatsApp routing details.",
      recipientSource: input.recipientSource ?? null,
      whatsappIdentitySource: input.whatsappIdentitySource ?? null,
      idempotencyKeys: [] as string[],
    };
  }

  const now = new Date();
  const rows = input.messages.map((message, index) => ({
    businessId: input.businessId,
    entityType: input.entityType,
    entityId: input.entityId,
    customerId: input.customerId ?? null,
    threadId: input.threadId ?? null,
    whatsappIdentityId: input.whatsappIdentityId ?? null,
    recipient,
    channel: "whatsapp",
    source: input.source,
    messageType: message.type,
    payload: asJsonRecord(message),
    status: "pending",
    attempts: 0,
    idempotencyKey: buildOutboxMessageKey(input.idempotencyBaseKey, index),
    createdAt: now,
    updatedAt: now,
  }));

  await tx
    .insert(messageOutbox)
    .values(rows)
    .onConflictDoNothing({
      target: [messageOutbox.businessId, messageOutbox.idempotencyKey],
    });

  return {
    ok: true as const,
    error: null,
    recipientSource: input.recipientSource ?? null,
    whatsappIdentitySource: input.whatsappIdentitySource ?? null,
    idempotencyKeys: rows.map((row) => row.idempotencyKey),
  };
}

export async function enqueueEmailOutboxMessages(
  tx: any,
  input: {
    businessId: string;
    entityType: string;
    entityId: string;
    customerId?: string | null;
    recipientEmail?: string | null;
    source: string;
    messages: BusinessEmailMessage[];
    idempotencyBaseKey: string;
  },
) {
  const recipient = String(input.recipientEmail || "").trim().toLowerCase();
  if (!input.messages.length) {
    return {
      ok: true as const,
      error: null,
      idempotencyKeys: [] as string[],
    };
  }
  if (!recipient) {
    return {
      ok: false as const,
      error: "Customer notification is missing an email address.",
      idempotencyKeys: [] as string[],
    };
  }

  const now = new Date();
  const rows = input.messages.map((message, index) => ({
    businessId: input.businessId,
    entityType: input.entityType,
    entityId: input.entityId,
    customerId: input.customerId ?? null,
    recipient,
    channel: "email",
    source: input.source,
    messageType: "email",
    payload: asJsonRecord(message),
    status: "pending",
    attempts: 0,
    idempotencyKey: buildOutboxMessageKey(input.idempotencyBaseKey, index),
    createdAt: now,
    updatedAt: now,
  }));

  await tx
    .insert(messageOutbox)
    .values(rows)
    .onConflictDoNothing({
      target: [messageOutbox.businessId, messageOutbox.idempotencyKey],
    });

  return {
    ok: true as const,
    error: null,
    idempotencyKeys: rows.map((row) => row.idempotencyKey),
  };
}

async function markOutboxFailure(id: string, error: string) {
  await db
    .update(messageOutbox)
    .set({
      status: "failed",
      lockedAt: null,
      lastError: error.slice(0, 1000),
      updatedAt: new Date(),
    })
    .where(eq(messageOutbox.id, id));
}

export async function drainBusinessOutbox(input: {
  businessId: string;
  idempotencyKeys?: string[];
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(50, input.limit ?? 20));
  const filters = [
    eq(messageOutbox.businessId, input.businessId),
    inArray(messageOutbox.status, ["pending", "failed"]),
  ];
  if (Array.isArray(input.idempotencyKeys) && input.idempotencyKeys.length) {
    filters.push(inArray(messageOutbox.idempotencyKey, input.idempotencyKeys));
  }

  const rows = await db
    .select()
    .from(messageOutbox)
    .where(and(...filters))
    .orderBy(asc(messageOutbox.createdAt))
    .limit(limit);

  let sentCount = 0;
  let failedCount = 0;
  let firstError: string | null = null;

  for (const row of rows) {
    const now = new Date();
    const [claimed] = await db
      .update(messageOutbox)
      .set({
        status: "sending",
        attempts: sql`${messageOutbox.attempts} + 1`,
        lastError: null,
        lockedAt: now,
        updatedAt: now,
      })
      .where(and(eq(messageOutbox.id, row.id), inArray(messageOutbox.status, ["pending", "failed"])))
      .returning();
    if (!claimed) continue;

    try {
      if (String(claimed.channel || "").trim().toLowerCase() === "email") {
        const email = normalizeOutboxEmail(claimed.payload);
        if (!email || !claimed.recipient) {
          failedCount += 1;
          firstError = firstError ?? "Outbox row is missing a valid email payload or recipient.";
          await markOutboxFailure(claimed.id, firstError);
          continue;
        }

        const result = await sendBusinessGmailMessage({
          businessId: claimed.businessId,
          to: claimed.recipient,
          subject: email.subject,
          text: email.text,
          html: email.html ?? null,
        });
        if (!result.success) {
          throw new Error(result.error || "Failed to deliver order email update.");
        }

        await db
          .update(messageOutbox)
          .set({
            status: "sent",
            lockedAt: null,
            sentAt: new Date(),
            updatedAt: new Date(),
            providerMessageId: result.messageId ?? null,
            providerResponse: asJsonRecord({ channel: "email", messageId: result.messageId ?? null }),
          })
          .where(eq(messageOutbox.id, claimed.id));
      } else {
        const message = normalizeOutboxMessage(claimed.payload);
        if (!message || !claimed.whatsappIdentityId || !claimed.recipient) {
          failedCount += 1;
          firstError = firstError ?? "Outbox row is missing a valid message payload or routing details.";
          await markOutboxFailure(claimed.id, firstError);
          continue;
        }

        const [result] = await sendWhatsAppMessagesViaBot({
          businessId: claimed.businessId,
          phoneNumberId: claimed.whatsappIdentityId,
          to: claimed.recipient,
          messages: [message],
          idempotencyKey: claimed.idempotencyKey,
        });

        if (claimed.threadId) {
          await persistOutboundThreadMessage({
            businessId: claimed.businessId,
            threadId: claimed.threadId,
            messageType: message.type,
            textBody: message.type === "text" ? message.text : message.caption ?? "[order update image]",
            externalMessageId: result?.messageId ?? null,
            meta: {
              source: claimed.source,
              entityType: claimed.entityType,
              entityId: claimed.entityId,
              idempotencyKey: claimed.idempotencyKey,
              providerResponse: result?.providerResponse ?? null,
              whatsappIdentityId: claimed.whatsappIdentityId,
              recipient: claimed.recipient,
            },
          });
        }

        await db
          .update(messageOutbox)
          .set({
            status: "sent",
            lockedAt: null,
            sentAt: new Date(),
            updatedAt: new Date(),
            providerMessageId: result?.messageId ?? null,
            providerResponse: asJsonRecord(result?.providerResponse ?? null),
          })
          .where(eq(messageOutbox.id, claimed.id));
      }
      sentCount += 1;
    } catch (error) {
      failedCount += 1;
      const messageText = error instanceof Error ? error.message : "Failed to deliver WhatsApp order update.";
      firstError = firstError ?? messageText;
      await markOutboxFailure(claimed.id, messageText);
    }
  }

  return {
    ok: failedCount === 0,
    sentCount,
    failedCount,
    error: firstError,
  };
}

export async function drainWhatsAppOutbox(input: {
  businessId: string;
  idempotencyKeys?: string[];
  limit?: number;
}) {
  return drainBusinessOutbox(input);
}
