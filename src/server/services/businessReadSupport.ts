import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { businesses } from "../../../drizzle/schema";
import { getBusinessAiCreditsUsedThisMonth } from "@/server/services/aiUsage";
import { getTenantModuleAccess } from "@/server/control/access";
import { buildPrivateBlobReadUrl } from "@/lib/storage";
import {
  getBusinessCustomizationSettingsRecord,
  getBusinessOrderSettingsRecord,
  getBusinessPreferencesRecord,
  getBusinessWebsiteWidgetSettingsRecord,
} from "@/server/services/businessSettingsStore";
import {
  getBusinessMessageUsageLimit,
  normalizeBusinessMessageUsageTier,
} from "@/lib/business-usage";
import { withCache } from "@/lib/redis";

function numberLimit(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function getMine(ctx: { businessId: string; userEmail?: string | null }) {
  const cacheKey = `business:getMine:${ctx.businessId}`;
  return withCache(cacheKey, 60, async () => {
    const [biz] = await db.select().from(businesses).where(eq(businesses.id, ctx.businessId));
    if (!biz) return null;

    const [creditsUsed, access, orderSettings, customizationSettings, preferences, websiteWidgetSettings] = await Promise.all([
      getBusinessAiCreditsUsedThisMonth(ctx.businessId),
      biz.suiteTenantId ? getTenantModuleAccess(biz.suiteTenantId, "agent") : Promise.resolve(null),
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

export async function getSubscription(ctx: { businessId: string }) {
  const cacheKey = `business:getSubscription:${ctx.businessId}`;
  return withCache(cacheKey, 300, async () => {
    try {
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

      const filterSubscriptionRecord = <T>(record: Record<string, T>, prefix: string): Record<string, T> => {
        return Object.fromEntries(Object.entries(record).filter(([key]) => key.startsWith(prefix)));
      };

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
