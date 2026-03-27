import { z } from "zod";

import { sendWebChatMessageViaBot } from "@/server/services/botApi";
import { checkRateLimit } from "@/server/rateLimit";
import { getBusinessByWebsiteWidgetKey } from "@/server/widget/service";
import { widgetJson, widgetOptionsResponse } from "@/server/widget/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const chatSchema = z.object({
  key: z.string().min(12).max(160),
  visitorId: z.string().min(3).max(160),
  message: z.string().min(1).max(4000),
  customerName: z.string().min(1).max(120).optional(),
});

export async function OPTIONS() {
  return widgetOptionsResponse();
}

export async function POST(request: Request) {
  const rl = checkRateLimit(request, {
    name: "widget_chat",
    max: Number(process.env.RATE_LIMIT_WIDGET_CHAT_MAX ?? "40"),
    windowMs: Number(process.env.RATE_LIMIT_WIDGET_CHAT_WINDOW_MS ?? String(60_000)),
  });

  if (!rl.ok) {
    return widgetJson(
      { error: "Too Many Requests" },
      {
        status: 429,
        headers: {
          ...rl.headers,
          "retry-after": String(Math.max(1, Math.ceil((rl.resetAtMs - Date.now()) / 1000))),
        },
      },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return widgetJson({ error: "Invalid widget chat payload" }, { status: 400, headers: rl.headers });
  }

  const widgetBusiness = await getBusinessByWebsiteWidgetKey(parsed.data.key);
  if (!widgetBusiness) {
    return widgetJson({ error: "Widget not found" }, { status: 404, headers: rl.headers });
  }

  try {
    const result = await sendWebChatMessageViaBot({
      businessId: widgetBusiness.businessId,
      visitorId: parsed.data.visitorId,
      text: parsed.data.message.trim(),
      customerName: parsed.data.customerName?.trim() || null,
    });

    return widgetJson(
      {
        ok: true,
        botPaused: Boolean(result.botPaused),
        customerId: result.customerId ?? null,
        threadId: result.threadId ?? null,
        messages: Array.isArray(result.messages) ? result.messages : [],
      },
      { headers: rl.headers },
    );
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Chat reply failed";
    return widgetJson({ error: message }, { status: 502, headers: rl.headers });
  }
}
