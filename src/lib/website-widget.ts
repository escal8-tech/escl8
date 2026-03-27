export type WebsiteWidgetSettings = {
  enabled: boolean;
  key: string | null;
  title: string;
  accentColor: string;
};

export const DEFAULT_WEBSITE_WIDGET_TITLE = "Chat with us";
export const DEFAULT_WEBSITE_WIDGET_ACCENT = "#2563eb";

export function normalizeWebsiteWidgetSettings(rawSettings: unknown): WebsiteWidgetSettings {
  const settings =
    rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)
      ? ((rawSettings as Record<string, unknown>).websiteWidget as Record<string, unknown> | undefined)
      : undefined;

  const title = typeof settings?.title === "string" && settings.title.trim()
    ? settings.title.trim()
    : DEFAULT_WEBSITE_WIDGET_TITLE;
  const accentColor = typeof settings?.accentColor === "string" && settings.accentColor.trim()
    ? settings.accentColor.trim()
    : DEFAULT_WEBSITE_WIDGET_ACCENT;
  const key = typeof settings?.key === "string" && settings.key.trim() ? settings.key.trim() : null;
  const enabled = settings?.enabled === false ? false : Boolean(key);

  return {
    enabled,
    key,
    title,
    accentColor,
  };
}

export function mergeWebsiteWidgetSettings(
  rawSettings: unknown,
  patch: Partial<WebsiteWidgetSettings>,
): Record<string, unknown> {
  const base =
    rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)
      ? { ...(rawSettings as Record<string, unknown>) }
      : {};
  const current = normalizeWebsiteWidgetSettings(rawSettings);

  base.websiteWidget = {
    enabled: patch.enabled ?? current.enabled,
    key: patch.key ?? current.key,
    title: patch.title ?? current.title,
    accentColor: patch.accentColor ?? current.accentColor,
  };

  return base;
}

export function buildWebsiteWidgetSnippet(origin: string, key: string): string {
  const base = String(origin || "").trim().replace(/\/+$/, "");
  const safeKey = encodeURIComponent(String(key || "").trim());
  return `<script src="${base}/widget-embed.js?key=${safeKey}" async></script>`;
}
