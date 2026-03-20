import { TRPCError } from "@trpc/server";

export type BotSendMessage =
  | { type: "text"; text: string }
  | { type: "image"; imageUrl: string; caption?: string };

export type BotSendResult = {
  type: "text" | "image";
  messageId: string | null;
  providerResponse: unknown;
};

function getBotBaseUrl(): string {
  return String(process.env.BOT_INTERNAL_BASE_URL || "").trim().replace(/\/+$/, "");
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
    },
    body: JSON.stringify({
      businessId: input.businessId,
      phoneNumberId: input.phoneNumberId,
      to: input.to,
      messages: input.messages,
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
