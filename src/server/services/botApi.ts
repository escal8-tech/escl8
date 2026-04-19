import { TRPCError } from "@trpc/server";
import { normalizeServiceBaseUrl } from "@/server/internalSecurity";
import type { FlowBuilderManifest } from "@/lib/flow-builder/registry";

export type BotSendMessage =
  | { type: "text"; text: string }
  | { type: "image"; imageUrl?: string; imageId?: string; caption?: string }
  | { type: "document"; documentUrl?: string; documentId?: string; filename?: string; caption?: string };

export type BotSendResult = {
  type: "text" | "image" | "document";
  messageId: string | null;
  providerResponse: unknown;
};

export type BotWebChatMessage =
  | { type: "text"; text: string }
  | { type: "image"; imageUrl?: string; imageId?: string; caption?: string }
  | { type: "document"; documentUrl?: string; documentId?: string; filename?: string; caption?: string };

export type BotWebChatResult = {
  success: boolean;
  botPaused?: boolean;
  customerId?: string | null;
  threadId?: string | null;
  messages?: BotWebChatMessage[];
};

export type BotFlowBuilderManifest = FlowBuilderManifest;

function getBotBaseUrl(): string {
  try {
    return normalizeServiceBaseUrl(String(process.env.BOT_INTERNAL_BASE_URL || ""));
  } catch {
    throw new TRPCError({ code: "CONFLICT", message: "BOT_INTERNAL_BASE_URL is invalid." });
  }
}

function getBotApiKey(): string {
  return String(
    process.env.BOT_INTERNAL_API_KEY ||
      process.env.WHATSAPP_API_KEY ||
      process.env.PAYMENT_PROOF_ANALYZER_API_KEY ||
      "",
  ).trim();
}

export async function sendWhatsAppMessagesViaBot(input: {
  businessId: string;
  phoneNumberId: string;
  to: string;
  messages: BotSendMessage[];
  idempotencyKey?: string;
}) {
  const baseUrl = getBotBaseUrl();
  const apiKey = getBotApiKey();
  if (!baseUrl) {
    throw new TRPCError({ code: "CONFLICT", message: "Missing BOT_INTERNAL_BASE_URL." });
  }
  if (!apiKey) {
    throw new TRPCError({ code: "CONFLICT", message: "Missing BOT_INTERNAL_API_KEY." });
  }

  const response = await fetch(`${baseUrl}/internal/whatsapp/send`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      ...(String(input.idempotencyKey || "").trim()
        ? { "x-idempotency-key": String(input.idempotencyKey).trim() }
        : {}),
    },
    body: JSON.stringify({
      businessId: input.businessId,
      phoneNumberId: input.phoneNumberId,
      to: input.to,
      messages: input.messages,
      ...(String(input.idempotencyKey || "").trim()
        ? { idempotencyKey: String(input.idempotencyKey).trim() }
        : {}),
    }),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: String(payload?.error || payload?.message || "Bot WhatsApp send failed."),
    });
  }

  return (Array.isArray(payload?.results) ? payload.results : []) as BotSendResult[];
}

export async function observeAssistantMessageViaBot(input: {
  businessId: string;
  phoneNumberId: string;
  to: string;
  text: string;
  intent?: string;
}) {
  const baseUrl = getBotBaseUrl();
  const apiKey = getBotApiKey();
  if (!baseUrl) {
    throw new TRPCError({ code: "CONFLICT", message: "Missing BOT_INTERNAL_BASE_URL." });
  }
  if (!apiKey) {
    throw new TRPCError({ code: "CONFLICT", message: "Missing BOT_INTERNAL_API_KEY." });
  }

  const response = await fetch(`${baseUrl}/internal/assistant/observe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      businessId: input.businessId,
      phoneNumberId: input.phoneNumberId,
      to: input.to,
      text: input.text,
      intent: input.intent ?? "general",
    }),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: String(payload?.error || payload?.message || "Bot assistant observe failed."),
    });
  }

  return payload as { success?: boolean };
}

export async function sendWebChatMessageViaBot(input: {
  businessId: string;
  visitorId: string;
  text: string;
  customerName?: string | null;
}) {
  const baseUrl = getBotBaseUrl();
  const apiKey = getBotApiKey();
  if (!baseUrl) {
    throw new TRPCError({ code: "CONFLICT", message: "Missing BOT_INTERNAL_BASE_URL." });
  }
  if (!apiKey) {
    throw new TRPCError({ code: "CONFLICT", message: "Missing BOT_INTERNAL_API_KEY." });
  }

  const response = await fetch(`${baseUrl}/internal/webchat/reply`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      businessId: input.businessId,
      visitorId: input.visitorId,
      text: input.text,
      customerName: input.customerName ?? null,
    }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as BotWebChatResult & { error?: string; message?: string };
  if (!response.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: String(payload?.error || payload?.message || "Bot web chat reply failed."),
    });
  }

  return payload;
}

export async function getFlowBuilderManifestViaBot() {
  const baseUrl = getBotBaseUrl();
  const apiKey = getBotApiKey();
  if (!baseUrl) {
    throw new TRPCError({ code: "CONFLICT", message: "Missing BOT_INTERNAL_BASE_URL." });
  }
  if (!apiKey) {
    throw new TRPCError({ code: "CONFLICT", message: "Missing BOT_INTERNAL_API_KEY." });
  }

  const response = await fetch(`${baseUrl}/internal/flow-builder/manifest`, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
    },
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    manifest?: BotFlowBuilderManifest;
    error?: string;
    message?: string;
  };
  if (!response.ok || !payload?.manifest || !Array.isArray(payload.manifest.agents)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: String(payload?.error || payload?.message || "Bot flow-builder manifest unavailable."),
    });
  }

  return payload.manifest;
}
