import { eq } from "drizzle-orm";

import {
  businessCustomizationSettings,
  businessOrderSettings,
  businessPreferences,
  businessWebsiteWidgetSettings,
  type BusinessCustomizationSettingsRow,
  type BusinessOrderSettingsRow,
  type BusinessPreferencesRow,
  type BusinessWebsiteWidgetSettingsRow,
} from "../../../drizzle/schema";
import {
  normalizeCustomizationSettings,
  type BusinessCustomizationSettings,
} from "@/lib/customization-settings";
import {
  normalizeOrderFlowSettings,
  type OrderFlowSettings,
} from "@/lib/order-settings";
import {
  normalizeWebsiteWidgetSettings,
  type WebsiteWidgetSettings,
} from "@/lib/website-widget";
import { db } from "@/server/db/client";

export function isSettingsSchemaUnavailable(error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code || "").trim();
  return code === "42P01" || code === "42703";
}

export function orderSettingsFromRow(
  row: BusinessOrderSettingsRow | null | undefined,
  fallbackSettings?: unknown,
): OrderFlowSettings {
  if (!row) return normalizeOrderFlowSettings(fallbackSettings);
  return normalizeOrderFlowSettings({
    orderFlow: {
      ticketToOrderEnabled: row.ticketToOrderEnabled,
      paymentMethod: row.paymentMethod,
      paymentProofAiEnabled: row.paymentProofAiEnabled,
      paymentSlipRequired: row.paymentSlipRequired,
      currency: row.currency,
      deliveryCharge: {
        enabled: row.deliveryChargeEnabled,
        type: row.deliveryChargeType,
        value: row.deliveryChargeValue,
      },
      bankQr: {
        showQr: row.bankQrShowQr,
        showBankDetails: row.bankQrShowBankDetails,
        qrBlobPath: row.bankQrBlobPath,
        qrImageUrl: row.bankQrImageUrl,
        bankName: row.bankName,
        accountName: row.accountName,
        accountNumber: row.accountNumber,
        accountInstructions: row.accountInstructions,
      },
    },
  });
}

export function customizationSettingsFromRow(
  row: BusinessCustomizationSettingsRow | null | undefined,
  fallbackSettings?: unknown,
): BusinessCustomizationSettings {
  if (!row) return normalizeCustomizationSettings(fallbackSettings);
  return normalizeCustomizationSettings({
    customization: {
      businessName: row.businessName,
      logoBlobPath: row.logoBlobPath,
      logoContainer: row.logoContainer,
      logoUrl: row.logoUrl,
      primaryColor: row.primaryColor,
      secondaryColor: row.secondaryColor,
      address: row.address,
      phone: row.phone,
      email: row.email,
      website: row.website,
      invoiceFooterNote: row.invoiceFooterNote,
    },
  });
}

function timezoneFromFallback(fallbackSettings?: unknown): string {
  const root = fallbackSettings && typeof fallbackSettings === "object" && !Array.isArray(fallbackSettings)
    ? (fallbackSettings as Record<string, unknown>)
    : {};
  const timezone = String(root.timezone ?? "").trim();
  return timezone || "UTC";
}

export function preferencesFromRow(
  row: BusinessPreferencesRow | null | undefined,
  fallbackSettings?: unknown,
): { timezone: string } {
  return {
    timezone: String(row?.timezone || "").trim() || timezoneFromFallback(fallbackSettings),
  };
}

export function websiteWidgetSettingsFromRow(
  row: BusinessWebsiteWidgetSettingsRow | null | undefined,
  fallbackSettings?: unknown,
): WebsiteWidgetSettings {
  if (!row) return normalizeWebsiteWidgetSettings(fallbackSettings);
  return normalizeWebsiteWidgetSettings({
    websiteWidget: {
      enabled: row.enabled,
      key: row.widgetKey,
      title: row.title,
      accentColor: row.accentColor,
    },
  });
}

export async function getBusinessOrderSettingsRecord(
  businessId: string,
  fallbackSettings?: unknown,
): Promise<OrderFlowSettings> {
  try {
    const [row] = await db
      .select()
      .from(businessOrderSettings)
      .where(eq(businessOrderSettings.businessId, businessId))
      .limit(1);
    return orderSettingsFromRow(row, fallbackSettings);
  } catch (error) {
    if (isSettingsSchemaUnavailable(error)) return normalizeOrderFlowSettings(fallbackSettings);
    throw error;
  }
}

export async function getBusinessCustomizationSettingsRecord(
  businessId: string,
  fallbackSettings?: unknown,
): Promise<BusinessCustomizationSettings> {
  try {
    const [row] = await db
      .select()
      .from(businessCustomizationSettings)
      .where(eq(businessCustomizationSettings.businessId, businessId))
      .limit(1);
    return customizationSettingsFromRow(row, fallbackSettings);
  } catch (error) {
    if (isSettingsSchemaUnavailable(error)) return normalizeCustomizationSettings(fallbackSettings);
    throw error;
  }
}

export async function getBusinessPreferencesRecord(
  businessId: string,
  fallbackSettings?: unknown,
): Promise<{ timezone: string }> {
  try {
    const [row] = await db
      .select()
      .from(businessPreferences)
      .where(eq(businessPreferences.businessId, businessId))
      .limit(1);
    return preferencesFromRow(row, fallbackSettings);
  } catch (error) {
    if (isSettingsSchemaUnavailable(error)) return preferencesFromRow(null, fallbackSettings);
    throw error;
  }
}

export async function getBusinessWebsiteWidgetSettingsRecord(
  businessId: string,
  fallbackSettings?: unknown,
): Promise<WebsiteWidgetSettings> {
  try {
    const [row] = await db
      .select()
      .from(businessWebsiteWidgetSettings)
      .where(eq(businessWebsiteWidgetSettings.businessId, businessId))
      .limit(1);
    return websiteWidgetSettingsFromRow(row, fallbackSettings);
  } catch (error) {
    if (isSettingsSchemaUnavailable(error)) return normalizeWebsiteWidgetSettings(fallbackSettings);
    throw error;
  }
}

export async function upsertBusinessOrderSettings(
  businessId: string,
  settings: OrderFlowSettings,
): Promise<boolean> {
  const row = {
    businessId,
    ticketToOrderEnabled: true,
    paymentMethod: settings.paymentMethod,
    paymentProofAiEnabled: settings.paymentProofAiEnabled,
    paymentSlipRequired: settings.paymentSlipRequired,
    currency: settings.currency,
    deliveryChargeEnabled: settings.deliveryCharge.enabled,
    deliveryChargeType: settings.deliveryCharge.type,
    deliveryChargeValue: settings.deliveryCharge.value,
    bankQrShowQr: settings.bankQr.showQr,
    bankQrShowBankDetails: settings.bankQr.showBankDetails,
    bankQrBlobPath: settings.bankQr.qrBlobPath,
    bankQrImageUrl: settings.bankQr.qrImageUrl,
    bankName: settings.bankQr.bankName,
    accountName: settings.bankQr.accountName,
    accountNumber: settings.bankQr.accountNumber,
    accountInstructions: settings.bankQr.accountInstructions,
    updatedAt: new Date(),
  };

  try {
    await db
      .insert(businessOrderSettings)
      .values(row)
      .onConflictDoUpdate({
        target: businessOrderSettings.businessId,
        set: row,
      });
    return true;
  } catch (error) {
    if (isSettingsSchemaUnavailable(error)) return false;
    throw error;
  }
}

export async function upsertBusinessCustomizationSettings(
  businessId: string,
  settings: BusinessCustomizationSettings,
): Promise<boolean> {
  const row = {
    businessId,
    businessName: settings.businessName,
    logoBlobPath: settings.logoBlobPath,
    logoContainer: settings.logoContainer,
    logoUrl: settings.logoUrl,
    primaryColor: settings.primaryColor,
    secondaryColor: settings.secondaryColor,
    address: settings.address,
    phone: settings.phone,
    email: settings.email,
    website: settings.website,
    invoiceFooterNote: settings.invoiceFooterNote,
    updatedAt: new Date(),
  };

  try {
    await db
      .insert(businessCustomizationSettings)
      .values(row)
      .onConflictDoUpdate({
        target: businessCustomizationSettings.businessId,
        set: row,
      });
    return true;
  } catch (error) {
    if (isSettingsSchemaUnavailable(error)) return false;
    throw error;
  }
}

export async function upsertBusinessTimezone(businessId: string, timezone: string): Promise<boolean> {
  const row = {
    businessId,
    timezone: timezone.trim() || "UTC",
    updatedAt: new Date(),
  };

  try {
    await db
      .insert(businessPreferences)
      .values(row)
      .onConflictDoUpdate({
        target: businessPreferences.businessId,
        set: row,
      });
    return true;
  } catch (error) {
    if (isSettingsSchemaUnavailable(error)) return false;
    throw error;
  }
}

export async function upsertBusinessWebsiteWidgetSettings(
  businessId: string,
  settings: WebsiteWidgetSettings,
): Promise<boolean> {
  const row = {
    businessId,
    enabled: settings.enabled,
    widgetKey: settings.key,
    title: settings.title,
    accentColor: settings.accentColor,
    updatedAt: new Date(),
  };

  try {
    await db
      .insert(businessWebsiteWidgetSettings)
      .values(row)
      .onConflictDoUpdate({
        target: businessWebsiteWidgetSettings.businessId,
        set: row,
      });
    return true;
  } catch (error) {
    if (isSettingsSchemaUnavailable(error)) return false;
    throw error;
  }
}
