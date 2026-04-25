import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { businesses, customers, messageThreads, threadMessages } from "@/../drizzle/schema";
import { normalizeWebsiteWidgetSettings } from "@/lib/website-widget";
import { db } from "@/server/db/client";
import { getTenantModuleAccess, tenantHasFeature } from "@/server/control/access";
import { SUITE_FEATURES } from "@/server/control/subscription-features";

export type WebsiteWidgetMessage = {
  id: string;
  direction: "inbound" | "outbound";
  type: "text" | "image";
  text: string | null;
  imageUrl: string | null;
  createdAt: string;
};

export async function getBusinessByWebsiteWidgetKey(key: string) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return null;

  const [row] = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      settings: businesses.settings,
      isActive: businesses.isActive,
      suiteTenantId: businesses.suiteTenantId,
    })
    .from(businesses)
    .where(
      and(
        eq(businesses.isActive, true),
        sql`${businesses.settings} -> 'websiteWidget' ->> 'key' = ${normalizedKey}`,
      ),
    )
    .limit(1);

  if (!row) return null;

  const widget = normalizeWebsiteWidgetSettings(row.settings);
  if (!widget.enabled || widget.key !== normalizedKey) return null;
  const access = row.suiteTenantId ? await getTenantModuleAccess(row.suiteTenantId, "agent") : null;
  if (!tenantHasFeature(access, SUITE_FEATURES.AGENT_WIDGET_PUBLIC)) return null;

  return {
    businessId: row.id,
    businessName: row.name ?? null,
    widget,
  };
}

export async function listWebsiteWidgetHistory(input: {
  businessId: string;
  visitorId: string;
  limit?: number;
}): Promise<WebsiteWidgetMessage[]> {
  const visitorId = String(input.visitorId || "").trim();
  if (!visitorId) return [];

  const [thread] = await db
    .select({
      id: messageThreads.id,
    })
    .from(messageThreads)
    .innerJoin(customers, eq(messageThreads.customerId, customers.id))
    .where(
      and(
        eq(messageThreads.businessId, input.businessId),
        eq(customers.businessId, input.businessId),
        eq(customers.source, "web"),
        eq(customers.externalId, visitorId),
        isNull(customers.deletedAt),
        isNull(messageThreads.deletedAt),
      ),
    )
    .orderBy(desc(messageThreads.updatedAt), desc(messageThreads.lastMessageAt), desc(messageThreads.createdAt))
    .limit(1);

  if (!thread) return [];

  const rows = await db
    .select({
      id: threadMessages.id,
      direction: threadMessages.direction,
      messageType: threadMessages.messageType,
      textBody: threadMessages.textBody,
      meta: threadMessages.meta,
      createdAt: threadMessages.createdAt,
    })
    .from(threadMessages)
    .where(eq(threadMessages.threadId, thread.id))
    .orderBy(asc(threadMessages.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 100));

  return rows.map((row) => {
    const meta = row.meta && typeof row.meta === "object" ? (row.meta as Record<string, unknown>) : {};
    const messageType = String(row.messageType || "text").trim().toLowerCase();
    const textBody = row.textBody ? String(row.textBody) : null;
    const imageUrl = typeof meta.imageUrl === "string" && meta.imageUrl.trim() ? meta.imageUrl : null;

    return {
      id: row.id,
      direction: row.direction === "inbound" ? "inbound" : "outbound",
      type: messageType === "image" ? "image" : "text",
      text: messageType === "image"
        ? textBody && textBody !== "[image]"
          ? textBody
          : null
        : textBody,
      imageUrl,
      createdAt: new Date(row.createdAt).toISOString(),
    };
  });
}
