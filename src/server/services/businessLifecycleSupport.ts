import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { businesses, channelIdentities, whatsappIdentityDetails, users } from "../../../drizzle/schema";
import {
  getBusinessCustomizationSettingsRecord,
  getBusinessPreferencesRecord,
  getBusinessWebsiteWidgetSettingsRecord,
  upsertBusinessTimezone,
  upsertBusinessOrderSettings,
  upsertBusinessCustomizationSettings,
  upsertBusinessWebsiteWidgetSettings,
} from "@/server/services/businessSettingsStore";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { normalizeOrderFlowSettings, mergeOrderFlowSettings } from "@/lib/order-settings";
import { getTenantModuleAccess, tenantHasFeature } from "@/server/control/access";
import { SUITE_FEATURES } from "@/server/control/subscription-features";
import { publishEvent } from "@/lib/eventgrid";
import { normalizeCustomizationSettings, mergeCustomizationSettings } from "@/lib/customization-settings";
import { randomBytes } from "node:crypto";
import { mergeWebsiteWidgetSettings, normalizeWebsiteWidgetSettings } from "@/lib/website-widget";

export function numberLimit(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function assembleBusinessSetupStatus(businessId: string) {
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

  const [customization, preferences, websiteWidgetSettings, phoneNumbers] = await Promise.all([
    getBusinessCustomizationSettingsRecord(businessId, biz.settings),
    getBusinessPreferencesRecord(businessId, biz.settings),
    getBusinessWebsiteWidgetSettingsRecord(businessId, biz.settings),
    db
      .select({ phoneNumberId: whatsappIdentityDetails.phoneNumberId })
      .from(channelIdentities)
      .innerJoin(whatsappIdentityDetails, eq(channelIdentities.id, whatsappIdentityDetails.channelIdentityId))
      .where(and(eq(channelIdentities.businessId, businessId), eq(channelIdentities.status, "active"))),
  ]);

  const settings = (biz.settings ?? {}) as Record<string, unknown>;
  const onboarding = settings.onboarding && typeof settings.onboarding === "object" ? settings.onboarding as Record<string, unknown> : {};
  const businessName = String(customization.businessName || biz.name || "").trim();
  const hasRealName = Boolean(businessName) && !/^Business\s*\(|^Business Demo|^Business\s*$/i.test(businessName);
  const onboardingLocation = onboarding.location && typeof onboarding.location === "object" ? onboarding.location as Record<string, unknown> : {};
  const hasLocation = Boolean(String(customization.address || "").trim() || String(onboardingLocation.address || "").trim());
  const hasTimezone = Boolean(preferences.timezone && preferences.timezone !== "UTC");
  const required = [
    { id: "profile", label: "Complete business profile", detail: "Business name, contact details, and brand identity.", complete: hasRealName },
    { id: "location", label: "Set location and timezone", detail: "Needed for customer widgets, schedules, receipts, and due times.", complete: hasLocation && hasTimezone },
    { id: "whatsapp", label: "Connect WhatsApp", detail: "Required before live customer messaging and automation.", complete: phoneNumbers.length > 0 },
    { id: "gmail", label: "Connect Gmail", detail: "Required for invite emails, order emails, and payment instructions.", complete: Boolean(biz.gmailConnected) },
    { id: "widget", label: "Prepare customer widget", detail: "Enable and preview the public customer entry point.", complete: Boolean(websiteWidgetSettings.enabled || websiteWidgetSettings.key) },
  ];
  const completed = required.filter((item) => item.complete).length;

  return {
    completed,
    total: required.length,
    percent: Math.round((completed / required.length) * 100),
    required,
    thingsToTry: [
      { id: "invite", label: "Invite teammates", detail: "Add staff from Users & Permissions when you are ready." },
      { id: "catalog", label: "Upload documents or stock", detail: "Give the AI and operations screens real business data." },
      { id: "first-order", label: "Create a test order or appointment", detail: "Run one internal flow before going live." },
    ],
    onboarding,
  };
}

export async function setWhatsappIdentityAutoReplyPaused(businessId: string, userId: string | null, firebaseUid: string | null, input: {
  phoneNumberId: string;
  autoReplyPaused: boolean;
}) {
  const details = await db
    .select({
      channelIdentityId: whatsappIdentityDetails.channelIdentityId,
      displayPhoneNumber: whatsappIdentityDetails.displayPhoneNumber,
      phoneNumberId: whatsappIdentityDetails.phoneNumberId,
    })
    .from(whatsappIdentityDetails)
    .innerJoin(channelIdentities, eq(whatsappIdentityDetails.channelIdentityId, channelIdentities.id))
    .where(and(
      eq(whatsappIdentityDetails.phoneNumberId, input.phoneNumberId),
      eq(channelIdentities.businessId, businessId),
    ))
    .limit(1)
    .then(r => r[0]);

  if (!details) {
    throw new TRPCError({ code: "NOT_FOUND", message: "WhatsApp identity not found for this business." });
  }

  const [row] = await db
    .update(channelIdentities)
    .set({
      autoReplyPaused: input.autoReplyPaused,
      updatedAt: new Date(),
    })
    .where(and(
      eq(channelIdentities.businessId, businessId),
      eq(channelIdentities.id, details.channelIdentityId),
    ))
    .returning();

  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "WhatsApp identity not found for this business." });
  }

  recordBusinessEvent({
    event: input.autoReplyPaused ? "whatsapp_identity.auto_reply_paused" : "whatsapp_identity.auto_reply_resumed",
    action: "setWhatsappIdentityAutoReplyPaused",
    area: "whatsapp_identity",
    businessId,
    entity: "whatsapp_identity",
    entityId: details.phoneNumberId,
    userId,
    actorId: firebaseUid ?? userId ?? null,
    actorType: "user",
    outcome: "success",
    attributes: {
      display_phone_number: details.displayPhoneNumber ?? null,
    },
  });

  return {
    phoneNumberId: details.phoneNumberId,
    displayPhoneNumber: details.displayPhoneNumber,
    autoReplyPaused: row.autoReplyPaused,
    isActive: row.isActive,
    connectedAt: row.connectedAt,
  };
}

export async function setWhatsappIdentityAiDisabled(businessId: string, userId: string | null, firebaseUid: string | null, input: {
  phoneNumberId: string;
  aiDisabled: boolean;
}) {
  const details = await db
    .select({
      channelIdentityId: whatsappIdentityDetails.channelIdentityId,
      displayPhoneNumber: whatsappIdentityDetails.displayPhoneNumber,
      phoneNumberId: whatsappIdentityDetails.phoneNumberId,
    })
    .from(whatsappIdentityDetails)
    .innerJoin(channelIdentities, eq(whatsappIdentityDetails.channelIdentityId, channelIdentities.id))
    .where(and(
      eq(whatsappIdentityDetails.phoneNumberId, input.phoneNumberId),
      eq(channelIdentities.businessId, businessId),
    ))
    .limit(1)
    .then(r => r[0]);

  if (!details) {
    throw new TRPCError({ code: "NOT_FOUND", message: "WhatsApp identity not found for this business." });
  }

  const [row] = await db
    .update(channelIdentities)
    .set({
      aiEnabled: !input.aiDisabled,
      ...(input.aiDisabled ? { autoReplyPaused: false } : {}),
      updatedAt: new Date(),
    })
    .where(and(
      eq(channelIdentities.businessId, businessId),
      eq(channelIdentities.id, details.channelIdentityId),
    ))
    .returning();

  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "WhatsApp identity not found for this business." });
  }
  recordBusinessEvent({
    event: input.aiDisabled ? "whatsapp_identity.ai_disabled" : "whatsapp_identity.ai_enabled",
    action: "setWhatsappIdentityAiDisabled",
    area: "whatsapp_identity",
    businessId,
    entity: "whatsapp_identity",
    entityId: details.phoneNumberId,
    userId,
    actorId: firebaseUid ?? userId ?? null,
    actorType: "user",
    outcome: "success",
    attributes: {
      display_phone_number: details.displayPhoneNumber ?? null,
    },
  });

  return {
    phoneNumberId: details.phoneNumberId,
    displayPhoneNumber: details.displayPhoneNumber,
    autoReplyPaused: row.autoReplyPaused,
    aiDisabled: !row.aiEnabled,
    isActive: row.isActive,
    connectedAt: row.connectedAt,
  };
}

export async function updateBookingConfig(businessId: string, userId: string | null, firebaseUid: string | null, input: {
  bookingsEnabled: boolean;
  unitCapacity: number;
  timeslotMinutes: number;
  openTime: string;
  closeTime: string;
}) {
  const user = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid!)).then(r => r[0]);
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }
  if (user.businessId !== businessId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "User not in this business" });
  }

  const [updated] = await db
    .update(businesses)
    .set({
      bookingsEnabled: input.bookingsEnabled,
      bookingUnitCapacity: input.unitCapacity,
      bookingTimeslotMinutes: input.timeslotMinutes,
      bookingOpenTime: input.openTime,
      bookingCloseTime: input.closeTime,
      updatedAt: new Date(),
    })
    .where(eq(businesses.id, businessId))
    .returning();
  if (updated) {
    recordBusinessEvent({
      event: "business.booking_config_updated",
      action: "updateBookingConfig",
      area: "business",
      businessId: businessId,
      entity: "business",
      entityId: updated.id,
      userId,
      actorId: firebaseUid ?? userId ?? null,
      actorType: "user",
      outcome: "success",
      attributes: {
        booking_close_time: input.closeTime,
        booking_open_time: input.openTime,
        timeslot_minutes: input.timeslotMinutes,
        unit_capacity: input.unitCapacity,
      },
    });
  }
  return updated;
}

export async function updateTimezone(businessId: string, userId: string | null, firebaseUid: string | null, timezone: string) {
  const tz = timezone.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid IANA timezone" });
  }

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!biz) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
  }

  const existingSettings = (biz.settings ?? {}) as Record<string, unknown>;
  const nextSettings = { ...existingSettings, timezone: tz };

  const [updated] = await db
    .update(businesses)
    .set({
      settings: nextSettings,
      updatedAt: new Date(),
    })
    .where(eq(businesses.id, businessId))
    .returning();
  await upsertBusinessTimezone(businessId, tz);
  if (updated) {
    recordBusinessEvent({
      event: "business.timezone_updated",
      action: "updateTimezone",
      area: "business",
      businessId,
      entity: "business",
      entityId: updated.id,
      userId,
      actorId: firebaseUid ?? userId ?? null,
      actorType: "user",
      outcome: "success",
      attributes: {
        timezone: tz,
      },
    });
  }
  return updated;
}

export async function updateOrderSettings(businessId: string, userId: string | null, firebaseUid: string | null, input: {
  paymentMethod: "manual" | "cod" | "bank_qr";
  paymentProofAiEnabled?: boolean;
  paymentSlipRequired?: boolean;
  currency: string;
  deliveryCharge: {
    enabled: boolean;
    type: "fixed" | "percentage";
    value: string;
  };
  bankQr: {
    showQr: boolean;
    showBankDetails: boolean;
    qrBlobPath?: string;
    qrImageUrl?: string;
    bankName?: string;
    accountName?: string;
    accountNumber?: string;
    accountInstructions?: string;
  };
}) {
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
  }
  const access = biz.suiteTenantId ? await getTenantModuleAccess(biz.suiteTenantId, "agent") : null;
  if (!tenantHasFeature(access, SUITE_FEATURES.AGENT_WIDGET_MANAGE)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Website widget is locked for this subscription." });
  }

  const normalized = normalizeOrderFlowSettings({
    orderFlow: {
      ticketToOrderEnabled: true,
      paymentMethod: input.paymentMethod,
      paymentProofAiEnabled: input.paymentProofAiEnabled ?? true,
      paymentSlipRequired: input.paymentSlipRequired ?? true,
      currency: input.currency,
      deliveryCharge: input.deliveryCharge,
      bankQr: input.bankQr,
    },
  });

  await upsertBusinessOrderSettings(businessId, normalized);

  const [updated] = await db
    .update(businesses)
    .set({
      settings: mergeOrderFlowSettings((biz.settings ?? {}) as Record<string, unknown>, normalized),
      updatedAt: new Date(),
    })
    .where(eq(businesses.id, businessId))
    .returning();

  if (updated) {
    recordBusinessEvent({
      event: "business.order_settings_updated",
      action: "updateOrderSettings",
      area: "business",
      businessId,
      entity: "business",
      entityId: updated.id,
      userId,
      actorId: firebaseUid ?? userId ?? null,
      actorType: "user",
      outcome: "success",
      attributes: {
        currency: normalized.currency,
        payment_method: normalized.paymentMethod,
        ticket_to_order_enabled: normalized.ticketToOrderEnabled,
      },
    });
    await publishEvent("settings.updated", `business_${businessId}`, {
      businessId,
      type: "order_settings",
      settings: normalized,
    });
  }

  return updated ?? null;
}

export async function updateCustomizationSettings(businessId: string, userId: string | null, firebaseUid: string | null, input: {
  businessName?: string;
  logoBlobPath?: string;
  logoContainer?: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  address?: string;
  phone?: string;
  emailAddress?: string;
  website?: string;
  invoiceFooterNote?: string;
}) {
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
  }
  const access = biz.suiteTenantId ? await getTenantModuleAccess(biz.suiteTenantId, "agent") : null;
  if (!tenantHasFeature(access, SUITE_FEATURES.AGENT_SETTINGS_BASIC)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Settings are locked for this subscription." });
  }

  const normalized = normalizeCustomizationSettings({
    customization: {
      businessName: input.businessName ?? "",
      logoBlobPath: input.logoBlobPath ?? "",
      logoContainer: input.logoContainer ?? "",
      logoUrl: input.logoUrl ?? "",
      primaryColor: input.primaryColor,
      secondaryColor: input.secondaryColor,
      address: input.address ?? "",
      phone: input.phone ?? "",
      email: input.emailAddress ?? "",
      website: input.website ?? "",
      invoiceFooterNote: input.invoiceFooterNote ?? "",
    },
  });

  await upsertBusinessCustomizationSettings(businessId, normalized);

  const [updated] = await db
    .update(businesses)
    .set({
      settings: mergeCustomizationSettings((biz.settings ?? {}) as Record<string, unknown>, normalized),
      updatedAt: new Date(),
    })
    .where(eq(businesses.id, businessId))
    .returning();

  if (updated) {
    recordBusinessEvent({
      event: "business.customization_settings_updated",
      action: "updateCustomizationSettings",
      area: "business",
      businessId,
      entity: "business",
      entityId: updated.id,
      userId,
      actorId: firebaseUid ?? userId ?? null,
      actorType: "user",
      outcome: "success",
      attributes: {
        has_logo: Boolean(normalized.logoBlobPath || normalized.logoUrl),
        primary_color: normalized.primaryColor,
        secondary_color: normalized.secondaryColor,
      },
    });
    await publishEvent("settings.updated", `business_${businessId}`, {
      businessId,
      type: "customization_settings",
      settings: normalized,
    });
  }

  return updated ?? null;
}

export async function ensureWebsiteWidget(businessId: string, userId: string | null, firebaseUid: string | null) {
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
  }

  const current = await getBusinessWebsiteWidgetSettingsRecord(businessId, biz.settings);
  const key = current.key || `ww_${randomBytes(18).toString("base64url")}`;
  const nextSettings = mergeWebsiteWidgetSettings(biz.settings, {
    enabled: true,
    key,
    title: current.title,
    accentColor: current.accentColor,
  });
  const normalizedWidget = normalizeWebsiteWidgetSettings(nextSettings);

  const [updated] = await db
    .update(businesses)
    .set({
      settings: nextSettings,
      updatedAt: new Date(),
    })
    .where(eq(businesses.id, businessId))
    .returning();

  if (!updated) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save website widget settings" });
  }
  await upsertBusinessWebsiteWidgetSettings(businessId, normalizedWidget);

  recordBusinessEvent({
    event: current.key ? "business.website_widget_accessed" : "business.website_widget_enabled",
    action: "ensureWebsiteWidget",
    area: "business",
    businessId,
    entity: "business",
    entityId: updated.id,
    userId,
    actorId: firebaseUid ?? userId ?? null,
    actorType: "user",
    outcome: "success",
    status: normalizedWidget.enabled ? "enabled" : "disabled",
  });

  return {
    enabled: normalizedWidget.enabled,
    key: normalizedWidget.key,
    title: normalizedWidget.title,
    accentColor: normalizedWidget.accentColor,
  };
}

export async function disconnectGmailConnection(businessId: string, userId: string | null, firebaseUid: string | null) {
  const now = new Date();
  const [updated] = await db
    .update(businesses)
    .set({
      gmailConnected: false,
      gmailEmail: null,
      gmailRefreshToken: null,
      gmailAccessToken: null,
      gmailAccessTokenExpiresAt: null,
      gmailScope: null,
      gmailConnectedAt: null,
      gmailError: null,
      updatedAt: now,
    })
    .where(eq(businesses.id, businessId))
    .returning({
      gmailConnected: businesses.gmailConnected,
      gmailEmail: businesses.gmailEmail,
      gmailConnectedAt: businesses.gmailConnectedAt,
      gmailError: businesses.gmailError,
    });

  recordBusinessEvent({
    event: "business.gmail_disconnected",
    action: "disconnectGmailConnection",
    area: "business",
    businessId,
    entity: "business",
    entityId: businessId,
    userId,
    actorId: firebaseUid ?? userId ?? null,
    actorType: "user",
    outcome: "success",
    status: "disconnected",
  });

  return {
    gmailConnected: Boolean(updated?.gmailConnected),
    gmailEmail: updated?.gmailEmail ?? null,
    gmailConnectedAt: updated?.gmailConnectedAt ?? null,
    gmailError: updated?.gmailError ?? null,
  };
}

export async function completeOnboardingSetup(businessId: string, userEmail: string | null, input: {
  businessName: string;
  website?: string;
  phone?: string;
  address?: string;
  timezone: string;
  primaryCategory?: string;
  categories: string[];
  serviceTypes: string[];
  resourceTypes: string[];
}) {
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

  const timezone = input.timezone.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid IANA timezone" });
  }

  const customization = await getBusinessCustomizationSettingsRecord(businessId, biz.settings);
  const normalized = normalizeCustomizationSettings({
    customization: {
      ...customization,
      businessName: input.businessName.trim(),
      address: input.address?.trim() || customization.address || "",
      phone: input.phone?.trim() || customization.phone || "",
      email: userEmail || customization.email || "",
      website: input.website?.trim() || customization.website || "",
    },
  });
  await upsertBusinessCustomizationSettings(businessId, normalized);
  await upsertBusinessTimezone(businessId, timezone);

  const settings = (biz.settings ?? {}) as Record<string, unknown>;
  const onboarding = {
    ...(settings.onboarding && typeof settings.onboarding === "object" ? settings.onboarding as Record<string, unknown> : {}),
    completedAt: new Date().toISOString(),
    primaryCategory: input.primaryCategory || null,
    categories: input.categories,
    serviceTypes: input.serviceTypes,
    resourceTypes: input.resourceTypes,
    location: { address: input.address?.trim() || "", timezone },
  };

  const [updated] = await db
    .update(businesses)
    .set({
      name: input.businessName.trim(),
      settings: mergeCustomizationSettings({ ...settings, timezone, onboarding }, normalized),
      updatedAt: new Date(),
    })
    .where(eq(businesses.id, businessId))
    .returning();

  return updated ?? null;
}
