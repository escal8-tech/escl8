export type BusinessCustomizationSettings = {
  businessName: string;
  logoBlobPath: string;
  logoContainer: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  invoiceFooterNote: string;
};

export const DEFAULT_CUSTOMIZATION_SETTINGS: BusinessCustomizationSettings = {
  businessName: "",
  logoBlobPath: "",
  logoContainer: "",
  logoUrl: "",
  primaryColor: "#0E1B40",
  secondaryColor: "#D4A457",
  address: "",
  phone: "",
  email: "",
  website: "",
  invoiceFooterNote: "Please keep this invoice for your records.",
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function asHex(value: unknown, fallback: string): string {
  const normalized = asString(value);
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) return normalized.toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(normalized)) return `#${normalized.toUpperCase()}`;
  return fallback;
}

export function normalizeCustomizationSettings(raw: unknown): BusinessCustomizationSettings {
  const root = asObject(raw);
  const nested = asObject(root.customization);
  return {
    businessName: asString(nested.businessName, DEFAULT_CUSTOMIZATION_SETTINGS.businessName),
    logoBlobPath: asString(nested.logoBlobPath, DEFAULT_CUSTOMIZATION_SETTINGS.logoBlobPath),
    logoContainer: asString(nested.logoContainer, DEFAULT_CUSTOMIZATION_SETTINGS.logoContainer),
    logoUrl: asString(nested.logoUrl, DEFAULT_CUSTOMIZATION_SETTINGS.logoUrl),
    primaryColor: asHex(nested.primaryColor, DEFAULT_CUSTOMIZATION_SETTINGS.primaryColor),
    secondaryColor: asHex(nested.secondaryColor, DEFAULT_CUSTOMIZATION_SETTINGS.secondaryColor),
    address: asString(nested.address, DEFAULT_CUSTOMIZATION_SETTINGS.address),
    phone: asString(nested.phone, DEFAULT_CUSTOMIZATION_SETTINGS.phone),
    email: asString(nested.email, DEFAULT_CUSTOMIZATION_SETTINGS.email),
    website: asString(nested.website, DEFAULT_CUSTOMIZATION_SETTINGS.website),
    invoiceFooterNote: asString(nested.invoiceFooterNote, DEFAULT_CUSTOMIZATION_SETTINGS.invoiceFooterNote),
  };
}

export function mergeCustomizationSettings(
  settings: Record<string, unknown> | null | undefined,
  nextCustomization: BusinessCustomizationSettings,
): Record<string, unknown> {
  return {
    ...(settings ?? {}),
    customization: {
      businessName: nextCustomization.businessName,
      logoBlobPath: nextCustomization.logoBlobPath,
      logoContainer: nextCustomization.logoContainer,
      logoUrl: nextCustomization.logoUrl,
      primaryColor: nextCustomization.primaryColor,
      secondaryColor: nextCustomization.secondaryColor,
      address: nextCustomization.address,
      phone: nextCustomization.phone,
      email: nextCustomization.email,
      website: nextCustomization.website,
      invoiceFooterNote: nextCustomization.invoiceFooterNote,
    },
  };
}
