import { z } from "zod";


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


  const body = await request.json().catch(() => null);
  const parsed = sessionSchema.safeParse(body);
  if (!parsed.success) {
    return widgetJson({ error: "Invalid widget session payload" }, { status: 400, headers: {} });
  }

  const widgetBusiness = await getBusinessByWebsiteWidgetKey(parsed.data.key);
  if (!widgetBusiness) {
    return widgetJson({ error: "Widget not found" }, { status: 404, headers: {} });
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
  );
}
