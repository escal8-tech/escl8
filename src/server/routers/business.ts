import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { businesses, channelIdentities, whatsappIdentityDetails, agents } from "../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  getBusinessMessageUsageLimit,
  normalizeBusinessMessageUsageTier,
} from "@/lib/business-usage";
import { buildPrivateBlobReadUrl } from "@/lib/storage";
import { getBusinessAiCreditsUsedThisMonth } from "@/server/services/aiUsage";
import { getTenantModuleAccess } from "@/server/control/access";
import { withStatsCache } from "@/server/lib/statsCache";
import { createOrderInvoicePreviewArtifact } from "@/server/services/orderInvoice";
import {
  getBusinessCustomizationSettingsRecord,
  getBusinessOrderSettingsRecord,
  getBusinessPreferencesRecord,
  getBusinessWebsiteWidgetSettingsRecord,
} from "@/server/services/businessSettingsStore";
import * as support from "@/server/services/businessLifecycleSupport";

const businessMessageUsageTierSchema = z.enum(["minimum", "standard", "enterprise"]);

export const businessRouter = router({
  listPhoneNumbers: businessProcedure.query(async ({ ctx }) => {
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
          eq(channelIdentities.businessId, ctx.businessId),
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
  }),

  setWhatsappIdentityAutoReplyPaused: businessProcedure
    .input(z.object({
      phoneNumberId: z.string().min(1),
      autoReplyPaused: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
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
          eq(channelIdentities.businessId, ctx.businessId),
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
          eq(channelIdentities.businessId, ctx.businessId),
          eq(channelIdentities.id, details.channelIdentityId),
        ))
        .returning();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "WhatsApp identity not found for this business." });
      }

      support.recordBusinessEvent({
        event: input.autoReplyPaused ? "whatsapp_identity.auto_reply_paused" : "whatsapp_identity.auto_reply_resumed",
        action: "setWhatsappIdentityAutoReplyPaused",
        area: "whatsapp_identity",
        businessId: ctx.businessId,
        entity: "whatsapp_identity",
        entityId: details.phoneNumberId,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
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
    }),

  setWhatsappIdentityAiDisabled: businessProcedure
    .input(z.object({
      phoneNumberId: z.string().min(1),
      aiDisabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
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
          eq(channelIdentities.businessId, ctx.businessId),
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
          eq(channelIdentities.businessId, ctx.businessId),
          eq(channelIdentities.id, details.channelIdentityId),
        ))
        .returning();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "WhatsApp identity not found for this business." });
      }
      support.recordBusinessEvent({
        event: input.aiDisabled ? "whatsapp_identity.ai_disabled" : "whatsapp_identity.ai_enabled",
        action: "setWhatsappIdentityAiDisabled",
        area: "whatsapp_identity",
        businessId: ctx.businessId,
        entity: "whatsapp_identity",
        entityId: details.phoneNumberId,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
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
    }),

  getMine: businessProcedure
    .input(z.object({ email: z.string().email().optional() }).optional().default({}))
    .query(async ({ input, ctx }) => {
      if (ctx.userEmail && input.email && input.email !== ctx.userEmail) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }

      return withStatsCache(`business:getMine:${ctx.businessId}`, 60, async () => {
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
            max: support.numberLimit(access?.limits?.["agent.messages.monthly"], getBusinessMessageUsageLimit(biz.messageUsageTier)),
            tier: normalizeBusinessMessageUsageTier(biz.messageUsageTier),
          },
        };
      });
    }),

  getCustomizationPreview: businessProcedure.query(async ({ ctx }) => {
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
  }),

  updateMessageUsageTier: businessProcedure
    .input(
      z.object({
        email: z.string().email(),
        businessId: z.string().min(1),
        messageUsageTier: businessMessageUsageTierSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.userEmail && input.email !== ctx.userEmail) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }
      if (input.businessId !== ctx.businessId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Business mismatch" });
      }
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Usage tiers are managed administratively.",
      });
    }),

  updateBookingConfig: businessProcedure
    .input(z.object({
      email: z.string().email(),
      businessId: z.string().min(1),
      bookingsEnabled: z.boolean(),
      unitCapacity: z.number().int().min(1),
      timeslotMinutes: z.number().int().min(5).max(600),
      openTime: z.string().regex(/^\d{2}:\d{2}$/),
      closeTime: z.string().regex(/^\d{2}:\d{2}$/),
    }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.userEmail && input.email !== ctx.userEmail) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }
      if (input.businessId !== ctx.businessId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Business mismatch" });
      }

      return support.updateBusinessBookingConfig(ctx, input);
    }),

  updateTimezone: businessProcedure
    .input(
      z.object({
        email: z.string().email(),
        businessId: z.string().min(1),
        timezone: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.userEmail && input.email !== ctx.userEmail) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }
      if (input.businessId !== ctx.businessId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Business mismatch" });
      }

      return support.updateBusinessTimezone(ctx, input.timezone);
    }),

  updateOrderSettings: businessProcedure
    .input(
      z.object({
        email: z.string().email(),
        businessId: z.string().min(1),
        ticketToOrderEnabled: z.boolean().optional(),
        paymentMethod: z.enum(["manual", "cod", "bank_qr"]),
        paymentProofAiEnabled: z.boolean().optional(),
        paymentSlipRequired: z.boolean().optional(),
        currency: z.string().min(1).max(10),
        deliveryCharge: z.object({
          enabled: z.boolean(),
          type: z.enum(["fixed", "percentage"]),
          value: z.string().max(40),
        }),
        bankQr: z.object({
          showQr: z.boolean(),
          showBankDetails: z.boolean(),
          qrBlobPath: z.string().optional(),
          qrImageUrl: z.string().optional(),
          bankName: z.string().optional(),
          accountName: z.string().optional(),
          accountNumber: z.string().optional(),
          accountInstructions: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.userEmail && input.email !== ctx.userEmail) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }
      if (input.businessId !== ctx.businessId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Business mismatch" });
      }

      return support.updateBusinessOrderSettings(ctx, input);
    }),

  updateCustomizationSettings: businessProcedure
    .input(
      z.object({
        email: z.string().email(),
        businessId: z.string().min(1),
        businessName: z.string().max(160).optional(),
        logoBlobPath: z.string().max(1024).optional(),
        logoContainer: z.string().max(80).optional(),
        logoUrl: z.string().max(1200).optional(),
        primaryColor: z.string().max(20),
        secondaryColor: z.string().max(20),
        address: z.string().max(500).optional(),
        phone: z.string().max(120).optional(),
        emailAddress: z.string().max(180).optional(),
        website: z.string().max(240).optional(),
        invoiceFooterNote: z.string().max(300).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.userEmail && input.email !== ctx.userEmail) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }
      if (input.businessId !== ctx.businessId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Business mismatch" });
      }

      return support.updateBusinessCustomizationSettings(ctx, input);
    }),

  ensureWebsiteWidget: businessProcedure
    .input(
      z.object({
        email: z.string().email(),
        businessId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.userEmail && input.email !== ctx.userEmail) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }
      if (input.businessId !== ctx.businessId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Business mismatch" });
      }

      return support.ensureBusinessWebsiteWidget(ctx);
    }),

  disconnectGmailConnection: businessProcedure
    .input(
      z.object({
        email: z.string().email(),
        businessId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.userEmail && input.email !== ctx.userEmail) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }
      if (input.businessId !== ctx.businessId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Business mismatch" });
      }

      return support.disconnectBusinessGmailConnection(ctx);
    }),

  getSetupStatus: businessProcedure.query(async ({ ctx }) => {
    return support.assembleBusinessSetupStatus(ctx.businessId);
  }),

  completeOnboardingSetup: businessProcedure
    .input(z.object({
      businessName: z.string().min(1).max(160),
      website: z.string().max(240).optional(),
      phone: z.string().max(120).optional(),
      address: z.string().max(500).optional(),
      timezone: z.string().min(1),
      primaryCategory: z.string().max(80).optional(),
      categories: z.array(z.string().max(80)).max(8).default([]),
      serviceTypes: z.array(z.string().max(80)).max(12).default([]),
      resourceTypes: z.array(z.string().max(80)).max(12).default([]),
    }))
    .mutation(async ({ input, ctx }) => {
      return support.completeBusinessOnboardingSetup(ctx, input);
    }),

  getSubscription: businessProcedure.query(async ({ ctx }) => {
    return withStatsCache(`business:getSubscription:${ctx.businessId}`, 300, async () => {
      const [biz] = await db
        .select({
          suiteTenantId: businesses.suiteTenantId,
          creditPool: businesses.creditPool,
          messageUsageTier: businesses.messageUsageTier,
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
          features: support.filterSubscriptionRecord(access.features, "agent."),
          limits: support.filterSubscriptionRecord(access.limits, "agent."),
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
  }),
});
