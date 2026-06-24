function asMetaRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export type ThreadMessageLike = {
  id: string;
  direction: string;
  messageType: string | null;
  textBody: string | null;
  meta: unknown;
  createdAt: string | Date;
};

export type InteractiveButtonOption = {
  id: string;
  title: string;
};

export type InteractiveListRow = {
  id: string;
  title: string;
  description?: string;
};

export type InteractiveListSection = {
  title?: string;
  rows: InteractiveListRow[];
};

export type ParsedOutboundInteractive = {
  kind: "button" | "list";
  bodyText: string;
  buttons: InteractiveButtonOption[];
  sections: InteractiveListSection[];
  listButtonLabel?: string;
};

export type ParsedInboundInteractive = {
  replyId: string;
  replyTitle: string;
  replyKind: "button_reply" | "list_reply" | "interactive";
  promptText?: string;
  promptOptions?: string[];
};

const OUTBOUND_DIRECTIONS = new Set(["outbound", "assistant", "bot", "staff", "system_out"]);

const O2_ACTION_LABELS: Record<string, string> = {
  add_more: "Add more",
  edit_cart: "Edit cart",
  checkout: "Checkout",
  delivery: "Delivery",
  pickup: "Pickup",
  payment_complete: "Payment complete",
  edit_order: "Edit order",
  cancel: "Cancel",
  yes: "Yes",
  no: "No",
  quantity: "Change quantity",
  change_option: "Change option",
  remove: "Remove item",
  back: "Back",
};

const LEGACY_ORDER_LABELS: Record<string, string> = {
  "order:cart:add_more": "Add more",
  "order:cart:checkout": "Checkout",
  "order:cart:cancel": "Cancel order",
  "order:cart:edit": "Edit cart",
  "order:cart_edit_action:qty": "Change quantity",
  "order:cart_edit_action:variant": "Change price option",
  "order:cart_edit_action:remove": "Remove item",
  "order:cart_edit_confirm:yes": "Yes",
  "order:cart_edit_confirm:no": "No",
  "order:confirm:place": "Confirm order",
  "order:confirm:edit": "Edit cart",
  "order:confirm:cancel": "Cancel order",
  "order:add:confirm": "Add this item",
  "order:add:other": "Show other items",
  "order:add:cancel": "Cancel order",
  "order:item:buy_now": "Buy now",
  "order:item:more_details": "More details",
  "order:item:other_options": "Other options",
};

export function isOutboundDirection(direction: string): boolean {
  return OUTBOUND_DIRECTIONS.has(String(direction || "").trim().toLowerCase());
}

function titleCaseWords(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function normalizeReplyToken(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

export function humanizeReplyToken(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "Selected option";

  if (LEGACY_ORDER_LABELS[trimmed]) return LEGACY_ORDER_LABELS[trimmed];

  const lower = trimmed.toLowerCase();
  if (LEGACY_ORDER_LABELS[lower]) return LEGACY_ORDER_LABELS[lower];

  if (lower.startsWith("o2:")) {
    const tail = lower.slice(3);
    if (O2_ACTION_LABELS[tail]) return O2_ACTION_LABELS[tail];
    const itemMatch = tail.match(/^item:(\d+)$/);
    if (itemMatch) return `Selected item #${itemMatch[1]}`;
    const variantMatch = tail.match(/^variant:(\d+)$/);
    if (variantMatch) return `Selected price option #${variantMatch[1]}`;
    const editItemMatch = tail.match(/^edit_item:(\d+)$/);
    if (editItemMatch) return `Cart item #${editItemMatch[1]}`;
    const action = tail.split(":").pop() || tail;
    if (O2_ACTION_LABELS[action]) return O2_ACTION_LABELS[action];
    return titleCaseWords(action);
  }

  if (lower.startsWith("order:")) {
    const mapped = LEGACY_ORDER_LABELS[lower];
    if (mapped) return mapped;
    const tail = lower.split(":").pop() || lower;
    return titleCaseWords(tail);
  }

  const compact = normalizeReplyToken(trimmed);
  if (O2_ACTION_LABELS[compact]) return O2_ACTION_LABELS[compact];

  if (/^\[interactive:[^\]]+\]$/i.test(trimmed)) return "Interactive message";

  return trimmed;
}

function readInteractivePayload(meta: Record<string, unknown>): Record<string, unknown> | null {
  const direct = asMetaRecord(meta.interactive);
  if (Object.keys(direct).length) return direct;
  return null;
}

function readButtons(interactive: Record<string, unknown>): InteractiveButtonOption[] {
  const action = asMetaRecord(interactive.action);
  const buttonsRaw = Array.isArray(action.buttons) ? action.buttons : [];
  const buttons: InteractiveButtonOption[] = [];
  for (const entry of buttonsRaw) {
    const button = asMetaRecord(entry);
    const reply = asMetaRecord(button.reply);
    const id = String(reply.id || "").trim();
    const title = String(reply.title || "").trim();
    if (!id && !title) continue;
    buttons.push({ id: id || title, title: title || humanizeReplyToken(id) });
  }
  return buttons;
}

function readListSections(interactive: Record<string, unknown>): {
  sections: InteractiveListSection[];
  listButtonLabel?: string;
} {
  const action = asMetaRecord(interactive.action);
  const buttonLabel = String(action.button || "").trim() || undefined;
  const sectionsRaw = Array.isArray(action.sections) ? action.sections : [];
  const sections: InteractiveListSection[] = [];

  for (const sectionEntry of sectionsRaw) {
    const section = asMetaRecord(sectionEntry);
    const rowsRaw = Array.isArray(section.rows) ? section.rows : [];
    const rows: InteractiveListRow[] = [];
    for (const rowEntry of rowsRaw) {
      const row = asMetaRecord(rowEntry);
      const id = String(row.id || "").trim();
      const title = String(row.title || "").trim();
      const description = String(row.description || "").trim() || undefined;
      if (!id && !title) continue;
      rows.push({
        id: id || title,
        title: title || humanizeReplyToken(id),
        description,
      });
    }
    if (!rows.length) continue;
    sections.push({
      title: String(section.title || "").trim() || undefined,
      rows,
    });
  }

  return { sections, listButtonLabel: buttonLabel };
}

export function parseOutboundInteractive(message: ThreadMessageLike): ParsedOutboundInteractive | null {
  const meta = asMetaRecord(message.meta);
  const interactive = readInteractivePayload(meta);
  if (!interactive) return null;

  const kindRaw = String(interactive.type || "").trim().toLowerCase();
  const bodyText =
    String(asMetaRecord(interactive.body).text || "").trim() ||
    String(message.textBody || "").trim();

  if (kindRaw === "button") {
    const buttons = readButtons(interactive);
    if (!bodyText && !buttons.length) return null;
    return { kind: "button", bodyText, buttons, sections: [] };
  }

  if (kindRaw === "list") {
    const { sections, listButtonLabel } = readListSections(interactive);
    if (!bodyText && !sections.length) return null;
    return { kind: "list", bodyText, buttons: [], sections, listButtonLabel };
  }

  return null;
}

export function parseInboundInteractive(message: ThreadMessageLike): ParsedInboundInteractive | null {
  const messageType = String(message.messageType || "").trim().toLowerCase();
  const meta = asMetaRecord(message.meta);
  const interactive = readInteractivePayload(meta);

  const replyId = String(interactive?.reply_id || "").trim();
  const replyTitle = String(interactive?.reply_title || "").trim();
  const replyKindRaw = String(interactive?.reply_kind || "").trim().toLowerCase();

  const textBody = String(message.textBody || "").trim();
  const looksInteractive =
    messageType === "interactive" ||
    Boolean(replyId || replyTitle) ||
    /^o2:/i.test(textBody) ||
    /^order:/i.test(textBody) ||
    /^\[interactive:/i.test(textBody);

  if (!looksInteractive) return null;

  const resolvedReplyId = replyId || textBody;
  const resolvedTitle = replyTitle || humanizeReplyToken(resolvedReplyId);

  const replyKind: ParsedInboundInteractive["replyKind"] =
    replyKindRaw === "list_reply"
      ? "list_reply"
      : replyKindRaw === "button_reply"
        ? "button_reply"
        : "interactive";

  return {
    replyId: resolvedReplyId,
    replyTitle: resolvedTitle,
    replyKind,
  };
}

function replyIdsMatch(storedId: string, inboundId: string): boolean {
  const a = String(storedId || "").trim().toLowerCase();
  const b = String(inboundId || "").trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.endsWith(b) || b.endsWith(a)) return true;
  const aTail = a.split(":").pop() || a;
  const bTail = b.split(":").pop() || b;
  return aTail === bTail;
}

export function findInboundReplyContext(
  messages: ThreadMessageLike[],
  messageIndex: number,
  inbound: ParsedInboundInteractive,
): { promptText?: string; promptOptions?: string[] } | null {
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (!candidate || !isOutboundDirection(candidate.direction)) continue;

    const parsed = parseOutboundInteractive(candidate);
    if (!parsed) continue;

      const optionIds: string[] = [];
      const optionTitles: string[] = [];

      if (parsed.kind === "button") {
        for (const button of parsed.buttons) {
          optionIds.push(button.id);
          optionTitles.push(button.title);
        }
      } else {
        for (const section of parsed.sections) {
          for (const row of section.rows) {
            optionIds.push(row.id);
            optionTitles.push(row.title);
          }
        }
      }

      const matched = optionIds.some((id) => replyIdsMatch(id, inbound.replyId));
    if (matched) {
      return {
        promptText: parsed.bodyText || undefined,
        promptOptions: optionTitles.length ? optionTitles : undefined,
      };
    }
  }
  return null;
}

export function enrichInboundInteractive(
  message: ThreadMessageLike,
  messages: ThreadMessageLike[],
  messageIndex: number,
): ParsedInboundInteractive | null {
  const parsed = parseInboundInteractive(message);
  if (!parsed) return null;

  const context = findInboundReplyContext(messages, messageIndex, parsed);
  if (!context) return parsed;

  return {
    ...parsed,
    promptText: context.promptText,
    promptOptions: context.promptOptions,
  };
}

export function isInteractivePlaceholderText(text: string): boolean {
  return /^\[interactive:[^\]]+\]$/i.test(String(text || "").trim());
}