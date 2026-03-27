import { z } from "zod";

import { checkRateLimit } from "@/server/rateLimit";
import { getBusinessByWebsiteWidgetKey, listWebsiteWidgetHistory } from "@/server/widget/service";
import { widgetJson, widgetOptionsResponse } from "@/server/widget/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sessionSchema = z.object({
  key: z.string().min(12).max(160),
  visitorId: z.string().min(3).max(160).optional(),
});

export async function OPTIONS() {
  return widgetOptionsResponse();
}

export async function POST(request: Request) {
  const rl = checkRateLimit(request, {
    name: "widget_session",
    max: Number(process.env.RATE_LIMIT_WIDGET_SESSION_MAX ?? "120"),
    windowMs: Number(process.env.RATE_LIMIT_WIDGET_SESSION_WINDOW_MS ?? String(60_000)),
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
  const parsed = sessionSchema.safeParse(body);
  if (!parsed.success) {
    return widgetJson({ error: "Invalid widget session payload" }, { status: 400, headers: rl.headers });
  }

  const widgetBusiness = await getBusinessByWebsiteWidgetKey(parsed.data.key);
  if (!widgetBusiness) {
    return widgetJson({ error: "Widget not found" }, { status: 404, headers: rl.headers });
  }

  const history = parsed.data.visitorId
    ? await listWebsiteWidgetHistory({
        businessId: widgetBusiness.businessId,
        visitorId: parsed.data.visitorId,
      })
    : [];

  return widgetJson(
    {
      ok: true,
      widget: {
        title: widgetBusiness.widget.title || widgetBusiness.businessName || "Chat with us",
        accentColor: widgetBusiness.widget.accentColor,
      },
      businessName: widgetBusiness.businessName,
      welcomeMessage: history.length > 0 ? null : `Hi, welcome to ${widgetBusiness.businessName || "our team"}. How can we help today?`,
      history,
    },
    { headers: rl.headers },
  );
}
