function asMetaRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export const ORDER_END_MESSAGE_KINDS = new Set([
  "order2_invoice",
  "order2_tracking_link",
  "order2_payment_pending",
  "order2_payment_finalize_failed",
  "order2_inventory_shortage",
]);

export type NormalizedMessageFields = {
  linkedOrderId: string | null;
  messageKind: string | null;
  replyId: string | null;
  replyTitle: string | null;
};

export type MessageFieldSource = {
  direction?: string | null;
  messageType?: string | null;
  textBody?: string | null;
  linkedOrderId?: string | null;
  messageKind?: string | null;
  replyId?: string | null;
  replyTitle?: string | null;
  meta?: unknown;
};

function clean(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

export function extractMessageFieldsFromMeta(
  meta: unknown,
  options?: { direction?: string | null; textBody?: string | null },
): NormalizedMessageFields {
  const record = asMetaRecord(meta);
  const orderAnchor = asMetaRecord(record.orderAnchor);
  const sourceMeta = asMetaRecord(record.sourceMeta);
  const interactive = asMetaRecord(record.interactive);

  let linkedOrderId = clean(orderAnchor.orderId) ?? clean(sourceMeta.orderId);
  if (!linkedOrderId && String(record.entityType || "").trim().toLowerCase() === "order") {
    linkedOrderId = clean(record.entityId);
  }

  let messageKind = clean(orderAnchor.kind) ?? clean(sourceMeta.kind);
  const replyId = clean(interactive.reply_id);
  const replyTitle = clean(interactive.reply_title);

  if (!messageKind && (replyId || replyTitle)) {
    messageKind = "interactive_reply";
  }

  const direction = String(options?.direction || "").trim().toLowerCase();
  const textBody = clean(options?.textBody);
  if (direction === "inbound" && !replyId && textBody && /^(o2:|order:)/i.test(textBody)) {
    return {
      linkedOrderId,
      messageKind: messageKind ?? "interactive_reply",
      replyId: textBody,
      replyTitle: replyTitle,
    };
  }

  return {
    linkedOrderId,
    messageKind,
    replyId,
    replyTitle,
  };
}

export function resolveMessageFields(message: MessageFieldSource): NormalizedMessageFields {
  const fromColumns: NormalizedMessageFields = {
    linkedOrderId: clean(message.linkedOrderId),
    messageKind: clean(message.messageKind),
    replyId: clean(message.replyId),
    replyTitle: clean(message.replyTitle),
  };

  const fromMeta = extractMessageFieldsFromMeta(message.meta, {
    direction: message.direction,
    textBody: message.textBody,
  });

  return {
    linkedOrderId: fromColumns.linkedOrderId ?? fromMeta.linkedOrderId,
    messageKind: fromColumns.messageKind ?? fromMeta.messageKind,
    replyId: fromColumns.replyId ?? fromMeta.replyId,
    replyTitle: fromColumns.replyTitle ?? fromMeta.replyTitle,
  };
}

export function isOrderEndMessageKind(kind: string | null | undefined): boolean {
  return ORDER_END_MESSAGE_KINDS.has(String(kind || "").trim().toLowerCase());
}

export function readOrderIdFromMessageMeta(meta: unknown): string | null {
  return extractMessageFieldsFromMeta(meta).linkedOrderId;
}

export function isOrderEndAnchorMeta(meta: unknown): boolean {
  const record = asMetaRecord(meta);
  const orderAnchor = asMetaRecord(record.orderAnchor);
  if (String(orderAnchor.milestone || "").trim() === "order_end") return true;

  const sourceMeta = asMetaRecord(record.sourceMeta);
  const kind = clean(sourceMeta.kind) ?? clean(orderAnchor.kind);
  return isOrderEndMessageKind(kind);
}

export function isOrderEndAnchorMessage(message: MessageFieldSource): boolean {
  const fields = resolveMessageFields(message);
  if (isOrderEndMessageKind(fields.messageKind)) return true;
  return isOrderEndAnchorMeta(message.meta);
}