export const SUITE_FEATURES = {
  AGENT_PORTAL_VIEW: "agent.portal.view",
  AGENT_SETTINGS_BASIC: "agent.settings.basic",
  AGENT_MESSAGES_VIEW: "agent.messages.view",
  AGENT_WHATSAPP_CONNECT: "agent.whatsapp.connect",
  AGENT_WHATSAPP_SEND: "agent.whatsapp.send",
  AGENT_WIDGET_MANAGE: "agent.widget.manage",
  AGENT_WIDGET_PUBLIC: "agent.widget.public",
  AGENT_ANALYTICS_VIEW: "agent.analytics.view",
  RESERVATION_WORKSPACE: "reservation.workspace.access",
  RESERVATION_SETTINGS_BASIC: "reservation.settings.basic",
  RESERVATION_WIDGET_PUBLIC: "reservation.widget.public",
  RESERVATION_WHATSAPP_BOOKING: "reservation.whatsapp.booking",
  RESERVATION_INVOICE_SEND: "reservation.invoice.send",
} as const;

export type SuiteFeatureKey = typeof SUITE_FEATURES[keyof typeof SUITE_FEATURES];
export type SuiteFeatureManifest = Partial<Record<SuiteFeatureKey, boolean>>;
export type SuiteLimitManifest = Record<string, number | string | boolean | null>;

export const AGENT_READONLY_FEATURES: SuiteFeatureManifest = {
  [SUITE_FEATURES.AGENT_PORTAL_VIEW]: true,
  [SUITE_FEATURES.AGENT_SETTINGS_BASIC]: true,
  [SUITE_FEATURES.AGENT_MESSAGES_VIEW]: true,
  [SUITE_FEATURES.AGENT_WHATSAPP_CONNECT]: false,
  [SUITE_FEATURES.AGENT_WHATSAPP_SEND]: false,
  [SUITE_FEATURES.AGENT_WIDGET_MANAGE]: false,
  [SUITE_FEATURES.AGENT_WIDGET_PUBLIC]: false,
  [SUITE_FEATURES.AGENT_ANALYTICS_VIEW]: false,
};

export const AGENT_FULL_FEATURES: SuiteFeatureManifest = {
  ...AGENT_READONLY_FEATURES,
  [SUITE_FEATURES.AGENT_WHATSAPP_CONNECT]: true,
  [SUITE_FEATURES.AGENT_WHATSAPP_SEND]: true,
  [SUITE_FEATURES.AGENT_WIDGET_MANAGE]: true,
  [SUITE_FEATURES.AGENT_WIDGET_PUBLIC]: true,
  [SUITE_FEATURES.AGENT_ANALYTICS_VIEW]: true,
};

export const RESERVATION_BLOCKED_FEATURES: SuiteFeatureManifest = {
  [SUITE_FEATURES.RESERVATION_WORKSPACE]: false,
  [SUITE_FEATURES.RESERVATION_SETTINGS_BASIC]: false,
  [SUITE_FEATURES.RESERVATION_WIDGET_PUBLIC]: false,
  [SUITE_FEATURES.RESERVATION_WHATSAPP_BOOKING]: false,
  [SUITE_FEATURES.RESERVATION_INVOICE_SEND]: false,
};

export const RESERVATION_FULL_FEATURES: SuiteFeatureManifest = {
  [SUITE_FEATURES.RESERVATION_WORKSPACE]: true,
  [SUITE_FEATURES.RESERVATION_SETTINGS_BASIC]: true,
  [SUITE_FEATURES.RESERVATION_WIDGET_PUBLIC]: true,
  [SUITE_FEATURES.RESERVATION_WHATSAPP_BOOKING]: true,
  [SUITE_FEATURES.RESERVATION_INVOICE_SEND]: true,
};

export function mergeFeatureManifests(...manifests: Array<SuiteFeatureManifest | null | undefined>): SuiteFeatureManifest {
  return manifests.reduce<SuiteFeatureManifest>((acc, current) => {
    if (!current) return acc;
    for (const [key, value] of Object.entries(current)) {
      acc[key as SuiteFeatureKey] = Boolean(value);
    }
    return acc;
  }, {});
}

export function mergeLimitManifests(...manifests: Array<SuiteLimitManifest | null | undefined>): SuiteLimitManifest {
  return manifests.reduce<SuiteLimitManifest>((acc, current) => {
    if (!current) return acc;
    return { ...acc, ...current };
  }, {});
}

export function hasFeature(manifest: SuiteFeatureManifest | null | undefined, featureKey: SuiteFeatureKey) {
  return Boolean(manifest?.[featureKey]);
}
