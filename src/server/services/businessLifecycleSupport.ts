import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { businesses, channelIdentities, whatsappIdentityDetails } from "../../../drizzle/schema";
import {
  getBusinessCustomizationSettingsRecord,
  getBusinessOrderSettingsRecord,
  getBusinessPreferencesRecord,
  getBusinessWebsiteWidgetSettingsRecord,
} from "@/server/services/businessSettingsStore";
import { buildPrivateBlobReadUrl } from "@/lib/storage";
import { getBusinessAiCreditsUsedThisMonth } from "@/server/services/aiUsage";
import { getTenantModuleAccess } from "@/server/control/access";
import { getBusinessMessageUsageLimit, normalizeBusinessMessageUsageTier } from "@/lib/business-usage";
import { createOrderInvoicePreviewArtifact } from "@/server/services/orderInvoice";
import { Context } from "@/server/trpc";
import { withStatsCache } from "../lib/statsCache";

export function numberLimit(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function filterSubscriptionRecord<T>(record: Record<string, T>, prefix: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key.startsWith(prefix)));
}

export async function getMine(ctx: Context) {
  const cacheKey = `business:mine:${ctx.businessId}`;
  return withStatsCache(cacheKey, 60, async () => {
    const [biz] = await db.select().from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1);
    if (!biz) return null;

    const creditsUsed = await getBusinessAiCreditsUsedThisMonth(ctx.businessId);
    const access = biz.suiteTenantId ? await getTenantModuleAccess(biz.suiteTenantId, "agent") : null;

    const [orderSettings, customizationSettings, preferences, websiteWidgetSettings] = await Promise.all([
      getBusinessOrderSettingsRecord(ctx.businessId, biz.settings),
      getBusinessCustomizationSettingsRecord(ctx.businessId, biz.settings),
      getBusinessPreferencesRecord(ctx.businessId, biz.settings),
      getBusinessWebsiteWidgetSettingsRecord(ctx.businessId, biz.settings),
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
  });
}

export async function getCustomizationPreview(ctx: Context) {
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1);
  if (!biz) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
  }

  const [customizationSettings, orderSettings] = await Promise.all([
    getBusinessCustomizationSettingsRecord(ctx.businessId, biz.settings),
    getBusinessOrderSettingsRecord(ctx.businessId, biz.settings),
  ]);

  const previewBase = String(process.env.CONCIERGE_PUBLIC_URL || "https://concierge.escal8.tech").replace(/\/+$/, "");
  const trackingPreviewUrl = `${previewBase}/track/orders/preview/${encodeURIComponent(ctx.businessId)}`;

  const invoicePreview = await createOrderInvoicePreviewArtifact({
    businessId: ctx.businessId,
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

export async function getSubscription(ctx: Context) {
  const cacheKey = `business:subscription:${ctx.businessId}`;
  return withStatsCache(cacheKey, 300, async () => {
    const [biz] = await db
      .select({
        suiteTenantId: businesses.suiteTenantId,
        creditPool: businesses.creditPool,
      })
      .from(businesses)
      .where(eq(businesses.id, ctx.businessId))
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
      const creditsUsed = await getBusinessAiCreditsUsedThisMonth(ctx.businessId);

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
  });
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
