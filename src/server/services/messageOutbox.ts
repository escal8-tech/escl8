/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { messageOutbox, whatsappIdentities } from "../../../drizzle/schema";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { captureSentryException } from "@/lib/sentry-monitoring";
import { observeAssistantMessageViaBot, sendWhatsAppMessagesViaBot, type BotSendMessage } from "./botApi";
import { sendBusinessGmailMessage, type BusinessEmailMessage } from "./companyGmail";
import { persistOutboundThreadMessage, sanitizePhoneDigits } from "./orderFlow";

type JsonRecord = Record<string, unknown>;
const STALE_OUTBOX_LOCK_MS = Number(process.env.MESSAGE_OUTBOX_STALE_LOCK_MS ?? String(10 * 60 * 1000));

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
    const imageId = String(row.imageId ?? "").trim();
    if (!imageUrl && !imageId) return null;
    const caption = String(row.caption ?? "").trim();
    return {
      type: "image",
      ...(imageUrl ? { imageUrl } : {}),
      ...(imageId ? { imageId } : {}),
      ...(caption ? { caption } : {}),
    };
  }
  if (type === "document") {
    const documentUrl = String(row.documentUrl ?? "").trim();
    const documentId = String(row.documentId ?? "").trim();
    if (!documentUrl && !documentId) return null;
    const filename = String(row.filename ?? "").trim();
    const caption = String(row.caption ?? "").trim();
    return {
      type: "document",
      ...(documentUrl ? { documentUrl } : {}),
      ...(documentId ? { documentId } : {}),
      ...(filename ? { filename } : {}),
      ...(caption ? { caption } : {}),
    };
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

export function buildOutboxAssistantObservation(input: {
  source: string;
  message: BotSendMessage;
}): { text: string; intent: string } | null {
  const source = String(input.source || "").trim().toLowerCase();
  const message = input.message;
  const text = (
    message.type === "text"
      ? message.text
      : message.type === "image"
        ? (message.caption || "")
        : (message.caption || message.filename || "")
  ).trim();
  if (!text) return null;
  if (
    source.startsWith("order_ticket_approval")
    || source.startsWith("order_approved")
    || source.startsWith("order_payment_details_manual_send")
    || source.startsWith("order_payment_approved")
    || source.startsWith("order_payment_rejected")
    || source.startsWith("order_manual_payment_collected")
  ) {
    return { text, intent: "paymentstatus" };
  }
  if (source.startsWith("order_ticket_denied")) {
    return { text, intent: "orderstatus" };
  }
  if (source === "order_fulfillment_update") {
    return { text, intent: "orderstatus" };
  }
  return { text, intent: "general" };
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
  const staleLockCutoff = new Date(Date.now() - Math.max(60_000, STALE_OUTBOX_LOCK_MS));
  const filters = [
    eq(messageOutbox.businessId, input.businessId),
    or(
      inArray(messageOutbox.status, ["pending", "failed"]),
      and(eq(messageOutbox.status, "sending"), lte(messageOutbox.lockedAt, staleLockCutoff)),
    ),
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
  const identityAiDisabledCache = new Map<string, boolean>();

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
      .where(
        and(
          eq(messageOutbox.id, row.id),
          or(
            inArray(messageOutbox.status, ["pending", "failed"]),
            and(eq(messageOutbox.status, "sending"), lte(messageOutbox.lockedAt, staleLockCutoff)),
          ),
        ),
      )
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
          const messageMeta: Record<string, unknown> = {
            source: claimed.source,
            entityType: claimed.entityType,
            entityId: claimed.entityId,
            idempotencyKey: claimed.idempotencyKey,
            providerResponse: result?.providerResponse ?? null,
            whatsappIdentityId: claimed.whatsappIdentityId,
            recipient: claimed.recipient,
          };
          if (message.type === "image") {
            messageMeta.imageUrl = message.imageUrl;
            if (message.caption) messageMeta.caption = message.caption;
          } else if (message.type === "document") {
            messageMeta.documentUrl = message.documentUrl;
            if (message.filename) messageMeta.filename = message.filename;
            if (message.caption) messageMeta.caption = message.caption;
          }
          await persistOutboundThreadMessage({
            businessId: claimed.businessId,
            threadId: claimed.threadId,
            messageType: message.type,
            textBody:
              message.type === "text"
                ? message.text
                : message.type === "image"
                  ? message.caption ?? "[image]"
                  : message.caption ?? `[document${message.type === "document" && message.filename ? `: ${message.filename}` : ""}]`,
            externalMessageId: result?.messageId ?? null,
            meta: messageMeta,
          });
        }

        try {
          const observation = buildOutboxAssistantObservation({
            source: String(claimed.source || ""),
            message,
          });
          const identityKey = String(claimed.whatsappIdentityId || "").trim();
          let aiDisabled = false;
          if (identityKey) {
            if (identityAiDisabledCache.has(identityKey)) {
              aiDisabled = Boolean(identityAiDisabledCache.get(identityKey));
            } else {
              const [identityRow] = await db
                .select({ aiDisabled: whatsappIdentities.aiDisabled })
                .from(whatsappIdentities)
                .where(
                  and(
                    eq(whatsappIdentities.businessId, claimed.businessId),
                    eq(whatsappIdentities.phoneNumberId, identityKey),
                  ),
                )
                .limit(1);
              aiDisabled = Boolean(identityRow?.aiDisabled);
              identityAiDisabledCache.set(identityKey, aiDisabled);
            }
          }
          if (observation && claimed.whatsappIdentityId && claimed.recipient && !aiDisabled) {
            await observeAssistantMessageViaBot({
              businessId: claimed.businessId,
              phoneNumberId: claimed.whatsappIdentityId,
              to: claimed.recipient,
              text: observation.text,
              intent: observation.intent,
            });
          }
        } catch (error) {
          recordBusinessEvent({
            event: "outbox.assistant_observe_failed",
            action: "deliver",
            area: "message_outbox",
            businessId: claimed.businessId,
            entity: claimed.entityType,
            entityId: claimed.entityId,
            actorType: "system",
            outcome: "degraded",
            status: "assistant_observe_failed",
            attributes: {
              idempotency_key: claimed.idempotencyKey,
              whatsapp_identity_id: claimed.whatsappIdentityId ?? undefined,
              source: claimed.source,
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
      recordBusinessEvent({
        event: "outbox.delivery_failed",
        businessId: claimed.businessId,
        entity: claimed.entityType,
        entityId: claimed.entityId,
        action: "deliver",
        level: "warn",
        status: claimed.channel,
        attributes: {
          idempotency_key: claimed.idempotencyKey,
          attempts: claimed.attempts,
          error_message: messageText,
          error_name: error instanceof Error ? error.name : undefined,
          whatsapp_identity_id: claimed.whatsappIdentityId ?? undefined,
        },
      });
      captureSentryException(error, {
        area: "message_outbox",
        action: "deliver",
        level: "warning",
        tags: {
          business_id: claimed.businessId,
          channel: claimed.channel,
          entity_type: claimed.entityType,
          whatsapp_identity_id: claimed.whatsappIdentityId ?? undefined,
        },
        contexts: {
          outbox: {
            entityId: claimed.entityId,
            idempotencyKey: claimed.idempotencyKey,
            attempts: claimed.attempts,
            errorMessage: messageText,
            errorName: error instanceof Error ? error.name : null,
            whatsappIdentityId: claimed.whatsappIdentityId ?? null,
          },
        },
      });
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
