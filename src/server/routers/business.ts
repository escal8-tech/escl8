import { z } from "zod";
import { randomBytes } from "node:crypto";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { businesses, channelIdentities, whatsappIdentityDetails, agents } from "../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { withStatsCache } from "@/server/lib/statsCache";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import {
  upsertBusinessWebsiteWidgetSettings,
  upsertBusinessTimezone,
  getBusinessWebsiteWidgetSettingsRecord,
  upsertBusinessCustomizationSettings,
} from "@/server/services/businessSettingsStore";
import {
  mergeWebsiteWidgetSettings,
  normalizeWebsiteWidgetSettings,
} from "@/lib/website-widget";
import {
  normalizeCustomizationSettings,
  mergeCustomizationSettings,
} from "@/lib/customization-settings";
import * as support from "@/server/services/businessLifecycleSupport";

export const businessRouter = router({
  listPhoneNumbers: businessProcedure.query(async ({ ctx }) => {
    return withStatsCache(`business:phone_numbers:${ctx.businessId}`, 60, async () => {
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
    });
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

      recordBusinessEvent({
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
      recordBusinessEvent({
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
      return support.getBusinessMine({
        businessId: ctx.businessId,
        userEmail: ctx.userEmail,
        inputEmail: input.email,
      });
    }),

  getCustomizationPreview: businessProcedure.query(async ({ ctx }) => {
    return support.getBusinessCustomizationPreview({ businessId: ctx.businessId });
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
      return support.updateBusinessBookingConfig({
        businessId: ctx.businessId,
        userId: ctx.userId,
        firebaseUid: ctx.firebaseUid,
        userEmail: ctx.userEmail,
        inputEmail: input.email,
        inputBusinessId: input.businessId,
        bookingsEnabled: input.bookingsEnabled,
        unitCapacity: input.unitCapacity,
        timeslotMinutes: input.timeslotMinutes,
        openTime: input.openTime,
        closeTime: input.closeTime,
      });
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

      const tz = input.timezone.trim();
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid IANA timezone" });
      }

      const [biz] = await db.select().from(businesses).where(eq(businesses.id, input.businessId));
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
        .where(eq(businesses.id, input.businessId))
        .returning();
      await upsertBusinessTimezone(input.businessId, tz);
      if (updated) {
        recordBusinessEvent({
          event: "business.timezone_updated",
          action: "updateTimezone",
          area: "business",
          businessId: ctx.businessId,
          entity: "business",
          entityId: updated.id,
          userId: ctx.userId,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
          actorType: "user",
          outcome: "success",
          attributes: {
            timezone: tz,
          },
        });
      }
      return updated;
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
      return support.updateBusinessOrderSettings({
        businessId: ctx.businessId,
        userId: ctx.userId,
        firebaseUid: ctx.firebaseUid,
        userEmail: ctx.userEmail,
        inputEmail: input.email,
        inputBusinessId: input.businessId,
        ticketToOrderEnabled: input.ticketToOrderEnabled,
        paymentMethod: input.paymentMethod,
        paymentProofAiEnabled: input.paymentProofAiEnabled,
        paymentSlipRequired: input.paymentSlipRequired,
        currency: input.currency,
        deliveryCharge: input.deliveryCharge,
        bankQr: input.bankQr,
      });
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
      return support.updateBusinessCustomizationSettings({
        businessId: ctx.businessId,
        userId: ctx.userId,
        firebaseUid: ctx.firebaseUid,
        userEmail: ctx.userEmail,
        inputEmail: input.email,
        inputBusinessId: input.businessId,
        businessName: input.businessName,
        logoBlobPath: input.logoBlobPath,
        logoContainer: input.logoContainer,
        logoUrl: input.logoUrl,
        primaryColor: input.primaryColor,
        secondaryColor: input.secondaryColor,
        address: input.address,
        phone: input.phone,
        emailAddress: input.emailAddress,
        website: input.website,
        invoiceFooterNote: input.invoiceFooterNote,
      });
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

      const [biz] = await db.select().from(businesses).where(eq(businesses.id, input.businessId)).limit(1);
      if (!biz) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
      }

      const current = await getBusinessWebsiteWidgetSettingsRecord(input.businessId, biz.settings);
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
        .where(eq(businesses.id, input.businessId))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save website widget settings" });
      }
      await upsertBusinessWebsiteWidgetSettings(input.businessId, normalizedWidget);

      recordBusinessEvent({
        event: current.key ? "business.website_widget_accessed" : "business.website_widget_enabled",
        action: "ensureWebsiteWidget",
        area: "business",
        businessId: ctx.businessId,
        entity: "business",
        entityId: updated.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
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
        .where(eq(businesses.id, input.businessId))
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
        businessId: ctx.businessId,
        entity: "business",
        entityId: input.businessId,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
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
      const [biz] = await db.select().from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1);
      if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

      const timezone = input.timezone.trim();
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid IANA timezone" });
      }

      const customization = await support.getBusinessCustomizationSettingsRecord(ctx.businessId, biz.settings);
      const normalized = normalizeCustomizationSettings({
        customization: {
          ...customization,
          businessName: input.businessName.trim(),
          address: input.address?.trim() || customization.address || "",
          phone: input.phone?.trim() || customization.phone || "",
          email: ctx.userEmail || customization.email || "",
          website: input.website?.trim() || customization.website || "",
        },
      });
      await upsertBusinessCustomizationSettings(ctx.businessId, normalized);
      await upsertBusinessTimezone(ctx.businessId, timezone);

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
        .where(eq(businesses.id, ctx.businessId))
        .returning();

      return updated ?? null;
    }),

  getSubscription: businessProcedure.query(async ({ ctx }) => {
    return support.getBusinessSubscription({ businessId: ctx.businessId });
  }),

  updateMessageUsageTier: businessProcedure
    .input(
      z.object({
        email: z.string().email(),
        businessId: z.string().min(1),
        messageUsageTier: z.enum(["minimum", "standard", "enterprise"]),
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
});
