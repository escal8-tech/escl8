import { z } from "zod";

import { sendWebChatMessageViaBot } from "@/server/services/botApi";

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


  const body = await request.json().catch(() => null);
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return widgetJson({ error: "Invalid widget chat payload" }, { status: 400, headers: {} });
  }

  const widgetBusiness = await getBusinessByWebsiteWidgetKey(parsed.data.key);
  if (!widgetBusiness) {
    return widgetJson({ error: "Widget not found" }, { status: 404, headers: {} });
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
    );
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Chat reply failed";
    return widgetJson({ error: message }, { status: 502, headers: {} });
  }
}
