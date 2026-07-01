import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  businesses,
  channelIdentities,
  whatsappIdentityDetails,
  users,
} from "../../../drizzle/schema";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import {
  getBusinessMessageUsageLimit,
  normalizeBusinessMessageUsageTier,
} from "@/lib/business-usage";
import {
  mergeCustomizationSettings,
  normalizeCustomizationSettings,
} from "@/lib/customization-settings";
import {
  mergeOrderFlowSettings,
  normalizeOrderFlowSettings,
} from "@/lib/order-settings";
import { publishEvent } from "@/lib/eventgrid";
import { buildPrivateBlobReadUrl } from "@/lib/storage";
import { getBusinessAiCreditsUsedThisMonth } from "@/server/services/aiUsage";
import { getTenantModuleAccess, tenantHasFeature } from "@/server/control/access";
import { SUITE_FEATURES } from "@/server/control/subscription-features";
import { createOrderInvoicePreviewArtifact } from "@/server/services/orderInvoice";
import {
  getBusinessCustomizationSettingsRecord,
  getBusinessOrderSettingsRecord,
  getBusinessPreferencesRecord,
  getBusinessWebsiteWidgetSettingsRecord,
  upsertBusinessCustomizationSettings,
  upsertBusinessOrderSettings,
  upsertBusinessTimezone,
} from "@/server/services/businessSettingsStore";

export {
  getBusinessCustomizationSettingsRecord,
  getBusinessOrderSettingsRecord,
  getBusinessPreferencesRecord,
  getBusinessWebsiteWidgetSettingsRecord,
  upsertBusinessCustomizationSettings,
  upsertBusinessOrderSettings,
  upsertBusinessTimezone,
} from "@/server/services/businessSettingsStore";

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

export async function getBusinessMine(args: {
  businessId: string;
  userEmail?: string;
  inputEmail?: string;
}) {
  if (args.userEmail && args.inputEmail && args.inputEmail !== args.userEmail) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
  }

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, args.businessId));
  if (!biz) return null;

  const creditsUsed = await getBusinessAiCreditsUsedThisMonth(args.businessId);
  const access = biz.suiteTenantId ? await getTenantModuleAccess(biz.suiteTenantId, "agent") : null;

  const [orderSettings, customizationSettings, preferences, websiteWidgetSettings] = await Promise.all([
    getBusinessOrderSettingsRecord(args.businessId, biz.settings),
    getBusinessCustomizationSettingsRecord(args.businessId, biz.settings),
    getBusinessPreferencesRecord(args.businessId, biz.settings),
    getBusinessWebsiteWidgetSettingsRecord(args.businessId, biz.settings),
  ]);
  const qrPreviewUrl = orderSettings.bankQr.qrBlobPath
    ? buildPrivateBlobReadUrl(orderSettings.bankQr.qrBlobPath, 24 * 30)
    : null;
  const logoPreviewUrl = customizationSettings.logoBlobPath
    ? buildPrivateBlobReadUrl(
        customizationSettings.logoBlobPath,
        24 * 30,
        customizationSettings.logoContainer || undefined,
      )
    : null;

  return {
    ...biz,
    timezone: preferences.timezone,
    websiteWidgetSettings,
    orderSettings: {
      ...orderSettings,
      ticketToOrderEnabled: true,
      bankQr: {
        ...orderSettings.bankQr,
        qrImageUrl: qrPreviewUrl || orderSettings.bankQr.qrImageUrl,
      },
    },
    customizationSettings: {
      ...customizationSettings,
      logoUrl: logoPreviewUrl || customizationSettings.logoUrl,
    },
    gmailConnected: Boolean(biz.gmailConnected),
    gmailEmail: biz.gmailEmail ?? null,
    gmailConnectedAt: biz.gmailConnectedAt ?? null,
    gmailError: biz.gmailError ?? null,
    subscriptionAccess: access,
    responseUsage: {
      used: creditsUsed,
      max: numberLimit(access?.limits?.["agent.messages.monthly"], getBusinessMessageUsageLimit(biz.messageUsageTier)),
      tier: normalizeBusinessMessageUsageTier(biz.messageUsageTier),
    },
  };
}

export async function getBusinessCustomizationPreview(args: {
  businessId: string;
}) {
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, args.businessId)).limit(1);
  if (!biz) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
  }

  const [customizationSettings, orderSettings] = await Promise.all([
    getBusinessCustomizationSettingsRecord(args.businessId, biz.settings),
    getBusinessOrderSettingsRecord(args.businessId, biz.settings),
  ]);

  const previewBase = String(process.env.CONCIERGE_PUBLIC_URL || "https://concierge.escal8.tech").replace(/\/+$/, "");
  const trackingPreviewUrl = `${previewBase}/track/orders/preview/${encodeURIComponent(args.businessId)}`;

  const invoicePreview = await createOrderInvoicePreviewArtifact({
    businessId: args.businessId,
    business: {
      id: biz.id,
      name: biz.name,
      settings: {
        ...((biz.settings ?? {}) as Record<string, unknown>),
        customization: customizationSettings ?? {},
      },
    },
    currency: orderSettings.currency,
    trackingUrl: trackingPreviewUrl,
  });

  return {
    invoicePreviewUrl: invoicePreview.url,
    invoicePreviewFileName: invoicePreview.fileName,
    trackingPreviewUrl,
    generatedAt: invoicePreview.generatedAt,
  };
}

export async function updateBusinessBookingConfig(args: {
  businessId: string;
  userId: string;
  firebaseUid?: string | null;
  userEmail?: string;
  inputEmail: string;
  inputBusinessId: string;
  bookingsEnabled: boolean;
  unitCapacity: number;
  timeslotMinutes: number;
  openTime: string;
  closeTime: string;
}) {
  if (args.userEmail && args.inputEmail !== args.userEmail) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
  }
  if (args.inputBusinessId !== args.businessId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Business mismatch" });
  }

  const user = await db.select().from(users).where(eq(users.firebaseUid, args.firebaseUid ?? "")).then(r => r[0]);
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }
  if (user.businessId !== args.inputBusinessId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "User not in this business" });
  }

  const [updated] = await db
    .update(businesses)
    .set({
      bookingsEnabled: args.bookingsEnabled,
      bookingUnitCapacity: args.unitCapacity,
      bookingTimeslotMinutes: args.timeslotMinutes,
      bookingOpenTime: args.openTime,
      bookingCloseTime: args.closeTime,
      updatedAt: new Date(),
    })
    .where(eq(businesses.id, args.inputBusinessId))
    .returning();

  if (updated) {
    recordBusinessEvent({
      event: "business.booking_config_updated",
      action: "updateBookingConfig",
      area: "business",
      businessId: args.businessId,
      entity: "business",
      entityId: updated.id,
      userId: args.userId,
      actorId: args.firebaseUid ?? args.userId ?? null,
      actorType: "user",
      outcome: "success",
      attributes: {
        booking_close_time: args.closeTime,
        booking_open_time: args.openTime,
        timeslot_minutes: args.timeslotMinutes,
        unit_capacity: args.unitCapacity,
      },
    });
  }
  return updated;
}

export async function updateBusinessOrderSettings(args: {
  businessId: string;
  userId: string;
  firebaseUid?: string | null;
  userEmail?: string;
  inputEmail: string;
  inputBusinessId: string;
  ticketToOrderEnabled?: boolean;
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
  if (args.userEmail && args.inputEmail !== args.userEmail) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
  }
  if (args.inputBusinessId !== args.businessId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Business mismatch" });
  }

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, args.inputBusinessId)).limit(1);
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
      paymentMethod: args.paymentMethod,
      paymentProofAiEnabled: args.paymentProofAiEnabled ?? true,
      paymentSlipRequired: args.paymentSlipRequired ?? true,
      currency: args.currency,
      deliveryCharge: args.deliveryCharge,
      bankQr: args.bankQr,
    },
  });

  await upsertBusinessOrderSettings(args.inputBusinessId, normalized);

  const [updated] = await db
    .update(businesses)
    .set({
      settings: mergeOrderFlowSettings((biz.settings ?? {}) as Record<string, unknown>, normalized),
      updatedAt: new Date(),
    })
    .where(eq(businesses.id, args.inputBusinessId))
    .returning();

  if (updated) {
    recordBusinessEvent({
      event: "business.order_settings_updated",
      action: "updateOrderSettings",
      area: "business",
      businessId: args.businessId,
      entity: "business",
      entityId: updated.id,
      userId: args.userId,
      actorId: args.firebaseUid ?? args.userId ?? null,
      actorType: "user",
      outcome: "success",
      attributes: {
        currency: normalized.currency,
        payment_method: normalized.paymentMethod,
        ticket_to_order_enabled: normalized.ticketToOrderEnabled,
      },
    });
    await publishEvent("settings.updated", `business_${args.businessId}`, {
      businessId: args.businessId,
      type: "order_settings",
      settings: normalized,
    });
  }

  return updated ?? null;
}

export async function updateBusinessCustomizationSettings(args: {
  businessId: string;
  userId: string;
  firebaseUid?: string | null;
  userEmail?: string;
  inputEmail: string;
  inputBusinessId: string;
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
  if (args.userEmail && args.inputEmail !== args.userEmail) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
  }
  if (args.inputBusinessId !== args.businessId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Business mismatch" });
  }

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, args.inputBusinessId)).limit(1);
  if (!biz) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
  }
  const access = biz.suiteTenantId ? await getTenantModuleAccess(biz.suiteTenantId, "agent") : null;
  if (!tenantHasFeature(access, SUITE_FEATURES.AGENT_SETTINGS_BASIC)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Settings are locked for this subscription." });
  }

  const normalized = normalizeCustomizationSettings({
    customization: {
      businessName: args.businessName ?? "",
      logoBlobPath: args.logoBlobPath ?? "",
      logoContainer: args.logoContainer ?? "",
      logoUrl: args.logoUrl ?? "",
      primaryColor: args.primaryColor,
      secondaryColor: args.secondaryColor,
      address: args.address ?? "",
      phone: args.phone ?? "",
      email: args.emailAddress ?? "",
      website: args.website ?? "",
      invoiceFooterNote: args.invoiceFooterNote ?? "",
    },
  });

  await upsertBusinessCustomizationSettings(args.inputBusinessId, normalized);

  const [updated] = await db
    .update(businesses)
    .set({
      settings: mergeCustomizationSettings((biz.settings ?? {}) as Record<string, unknown>, normalized),
      updatedAt: new Date(),
    })
    .where(eq(businesses.id, args.inputBusinessId))
    .returning();

  if (updated) {
    recordBusinessEvent({
      event: "business.customization_settings_updated",
      action: "updateCustomizationSettings",
      area: "business",
      businessId: args.businessId,
      entity: "business",
      entityId: updated.id,
      userId: args.userId,
      actorId: args.firebaseUid ?? args.userId ?? null,
      actorType: "user",
      outcome: "success",
      attributes: {
        has_logo: Boolean(normalized.logoBlobPath || normalized.logoUrl),
        primary_color: normalized.primaryColor,
        secondary_color: normalized.secondaryColor,
      },
    });
    await publishEvent("settings.updated", `business_${args.businessId}`, {
      businessId: args.businessId,
      type: "customization_settings",
      settings: normalized,
    });
  }

  return updated ?? null;
}

export async function getBusinessSubscription(args: {
  businessId: string;
}) {
  const [biz] = await db
    .select({
      suiteTenantId: businesses.suiteTenantId,
      creditPool: businesses.creditPool,
    })
    .from(businesses)
    .where(eq(businesses.id, args.businessId))
    .limit(1);

  if (!biz?.suiteTenantId) {
    return {
      hasSubscription: false,
      status: "none",
      planCode: null,
      planName: null,
      grantKind: null,
      subscriptionStatus: null,
      lastPaidAt: null,
      nextDueAt: null,
      monthlyCredits: 0,
      creditsUsed: 0,
      creditsBalance: 0,
      priceAmount: 0,
      currency: "MYR",
      features: {},
      limits: {},
      isActive: false,
      isSpecialGrant: false,
    };
  }

  try {
    const access = await getTenantModuleAccess(biz.suiteTenantId, "agent");
    if (!access) {
      return {
        hasSubscription: false,
        status: "none",
        planCode: null,
        planName: null,
        grantKind: null,
        subscriptionStatus: null,
        lastPaidAt: null,
        nextDueAt: null,
        monthlyCredits: 0,
        creditsUsed: 0,
        creditsBalance: 0,
        priceAmount: 0,
        currency: "MYR",
        features: {},
        limits: {},
        isActive: false,
        isSpecialGrant: false,
      };
    }

    const planCode = access.planCode;
    const planName = access.planName;
    const isActive = access.workspaceMode === "full";
    const isSpecialGrant = access.grantKind === "partner" || access.grantKind === "demo";

    const monthlyCredits = Number(access.limits["agent.messages.monthly"] || 0);
    const creditsUsed = await getBusinessAiCreditsUsedThisMonth(args.businessId);

    return {
      hasSubscription: true,
      status: access.subscriptionStatus || "none",
      planCode,
      planName,
      grantKind: access.grantKind,
      subscriptionStatus: access.subscriptionStatus,
      lastPaidAt: access.lastPaidAt,
      nextDueAt: access.nextDueAt,
      monthlyCredits,
      creditsUsed,
      creditsBalance: Math.max(0, biz.creditPool ?? (monthlyCredits - creditsUsed)),
      priceAmount: 0,
      currency: "MYR",
      features: filterSubscriptionRecord(access.features, "agent."),
      limits: filterSubscriptionRecord(access.limits, "agent."),
      isActive,
      isSpecialGrant,
    };
  } catch (error) {
    console.error("Error fetching subscription:", error);
    return {
      hasSubscription: false,
      status: "error",
      planCode: null,
      planName: null,
      grantKind: null,
      subscriptionStatus: null,
      lastPaidAt: null,
      nextDueAt: null,
      monthlyCredits: 0,
      creditsUsed: 0,
      creditsBalance: 0,
      priceAmount: 0,
      currency: "MYR",
      features: {},
      limits: {},
      isActive: false,
      isSpecialGrant: false,
    };
  }
}

function filterSubscriptionRecord<T>(record: Record<string, T>, prefix: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key.startsWith(prefix)));
}
