import { db } from "../db/client";
import { businesses, whatsappIdentityDetails, channelIdentities, agents } from "../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { getBusinessAiCreditsUsedThisMonth } from "@/server/services/aiUsage";
import { getTenantModuleAccess } from "@/server/control/access";
import {
  getBusinessCustomizationSettingsRecord,
  getBusinessOrderSettingsRecord,
  getBusinessPreferencesRecord,
  getBusinessWebsiteWidgetSettingsRecord,
} from "@/server/services/businessSettingsStore";
import { buildPrivateBlobReadUrl } from "@/lib/storage";
import { getBusinessMessageUsageLimit, normalizeBusinessMessageUsageTier } from "@/lib/business-usage";
import { createOrderInvoicePreviewArtifact } from "@/server/services/orderInvoice";
import { TRPCError } from "@trpc/server";

export function numberLimit(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function listPhoneNumbers(businessId: string) {
  const rows = await db
    .select({
      phoneNumberId: whatsappIdentityDetails.phoneNumberId,
      displayPhoneNumber: whatsappIdentityDetails.displayPhoneNumber,
      botType: agents.botType,
      isActive: channelIdentities.isActive,
      autoReplyPaused: channelIdentities.autoReplyPaused,
      aiEnabled: channelIdentities.aiEnabled,
      connectedAt: channelIdentities.connectedAt,
    })
    .from(channelIdentities)
    .innerJoin(whatsappIdentityDetails, eq(channelIdentities.id, whatsappIdentityDetails.channelIdentityId))
    .innerJoin(agents, eq(channelIdentities.agentId, agents.id))
    .where(
      and(
        eq(channelIdentities.businessId, businessId),
        eq(channelIdentities.isActive, true),
      ),
    )
    .orderBy(channelIdentities.connectedAt);

  return rows.map(r => ({
    phoneNumberId: r.phoneNumberId,
    displayPhoneNumber: r.displayPhoneNumber,
    botType: r.botType,
    isActive: r.isActive,
    autoReplyPaused: r.autoReplyPaused,
    aiDisabled: !r.aiEnabled,
    connectedAt: r.connectedAt,
  }));
}

export async function getMine(businessId: string) {
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!biz) return null;

  const creditsUsedPromise = getBusinessAiCreditsUsedThisMonth(businessId);
  const accessPromise = biz.suiteTenantId ? getTenantModuleAccess(biz.suiteTenantId, "agent") : Promise.resolve(null);

  const [creditsUsed, access, orderSettings, customizationSettings, preferences, websiteWidgetSettings] = await Promise.all([
    creditsUsedPromise,
    accessPromise,
    getBusinessOrderSettingsRecord(businessId, biz.settings),
    getBusinessCustomizationSettingsRecord(businessId, biz.settings),
    getBusinessPreferencesRecord(businessId, biz.settings),
    getBusinessWebsiteWidgetSettingsRecord(businessId, biz.settings),
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

export async function getCustomizationPreview(businessId: string) {
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
  }

  const [customizationSettings, orderSettings] = await Promise.all([
    getBusinessCustomizationSettingsRecord(businessId, biz.settings),
    getBusinessOrderSettingsRecord(businessId, biz.settings),
  ]);

  const previewBase = String(process.env.CONCIERGE_PUBLIC_URL || "https://concierge.escal8.tech").replace(/\/+$/, "");
  const trackingPreviewUrl = `${previewBase}/track/orders/preview/${encodeURIComponent(businessId)}`;

  const invoicePreview = await createOrderInvoicePreviewArtifact({
    businessId: businessId,
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

export async function getSubscription(businessId: string) {
    const [biz] = await db
      .select({
        suiteTenantId: businesses.suiteTenantId,
        creditPool: businesses.creditPool,
      })
      .from(businesses)
      .where(eq(businesses.id, businessId))
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
      const creditsUsed = await getBusinessAiCreditsUsedThisMonth(businessId);

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
