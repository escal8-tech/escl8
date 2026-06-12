import { z } from "zod";
import { randomBytes } from "node:crypto";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { businesses, users, whatsappIdentities } from "../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import {
  getBusinessMessageUsageLimit,
  normalizeBusinessMessageUsageTier,
} from "@/lib/business-usage";
import { mergeCustomizationSettings, normalizeCustomizationSettings } from "@/lib/customization-settings";
import { mergeOrderFlowSettings, normalizeOrderFlowSettings } from "@/lib/order-settings";
import { buildPrivateBlobReadUrl } from "@/lib/storage";
import { mergeWebsiteWidgetSettings, normalizeWebsiteWidgetSettings } from "@/lib/website-widget";
import { getBusinessAiCreditsUsedThisMonth } from "@/server/services/aiUsage";
import { getTenantModuleAccess, tenantHasFeature } from "@/server/control/access";
import { SUITE_FEATURES } from "@/server/control/subscription-features";
import {
  getBusinessCustomizationSettingsRecord,
  getBusinessOrderSettingsRecord,
  getBusinessPreferencesRecord,
  getBusinessWebsiteWidgetSettingsRecord,
  upsertBusinessCustomizationSettings,
  upsertBusinessOrderSettings,
  upsertBusinessTimezone,
  upsertBusinessWebsiteWidgetSettings,
} from "@/server/services/businessSettingsStore";

const businessMessageUsageTierSchema = z.enum(["minimum", "standard", "enterprise"]);

function numberLimit(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const businessRouter = router({
  listPhoneNumbers: businessProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        phoneNumberId: whatsappIdentities.phoneNumberId,
        displayPhoneNumber: whatsappIdentities.displayPhoneNumber,
        botType: whatsappIdentities.botType,
        isActive: whatsappIdentities.isActive,
        autoReplyPaused: whatsappIdentities.autoReplyPaused,
        aiDisabled: whatsappIdentities.aiDisabled,
        connectedAt: whatsappIdentities.connectedAt,
      })
      .from(whatsappIdentities)
      .where(
        and(
          eq(whatsappIdentities.businessId, ctx.businessId),
          eq(whatsappIdentities.isActive, true),
        ),
      )
      .orderBy(whatsappIdentities.connectedAt);

    return rows;
  }),

  setWhatsappIdentityAutoReplyPaused: businessProcedure
    .input(z.object({
      phoneNumberId: z.string().min(1),
      autoReplyPaused: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .update(whatsappIdentities)
        .set({
          autoReplyPaused: input.autoReplyPaused,
          updatedAt: new Date(),
        })
        .where(and(
          eq(whatsappIdentities.businessId, ctx.businessId),
          eq(whatsappIdentities.phoneNumberId, input.phoneNumberId),
        ))
        .returning({
          phoneNumberId: whatsappIdentities.phoneNumberId,
          displayPhoneNumber: whatsappIdentities.displayPhoneNumber,
          autoReplyPaused: whatsappIdentities.autoReplyPaused,
          isActive: whatsappIdentities.isActive,
          connectedAt: whatsappIdentities.connectedAt,
        });
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "WhatsApp identity not found for this business." });
      }
      recordBusinessEvent({
        event: row.autoReplyPaused ? "whatsapp_identity.auto_reply_paused" : "whatsapp_identity.auto_reply_resumed",
        action: "setWhatsappIdentityAutoReplyPaused",
        area: "whatsapp_identity",
        businessId: ctx.businessId,
        entity: "whatsapp_identity",
        entityId: row.phoneNumberId,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: "success",
        attributes: {
          display_phone_number: row.displayPhoneNumber ?? null,
        },
      });
      return row;
    }),

  setWhatsappIdentityAiDisabled: businessProcedure
    .input(z.object({
      phoneNumberId: z.string().min(1),
      aiDisabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .update(whatsappIdentities)
        .set({
          aiDisabled: input.aiDisabled,
          ...(input.aiDisabled ? { autoReplyPaused: false } : {}),
          updatedAt: new Date(),
        })
        .where(and(
          eq(whatsappIdentities.businessId, ctx.businessId),
          eq(whatsappIdentities.phoneNumberId, input.phoneNumberId),
        ))
        .returning({
          phoneNumberId: whatsappIdentities.phoneNumberId,
          displayPhoneNumber: whatsappIdentities.displayPhoneNumber,
          autoReplyPaused: whatsappIdentities.autoReplyPaused,
          aiDisabled: whatsappIdentities.aiDisabled,
          isActive: whatsappIdentities.isActive,
          connectedAt: whatsappIdentities.connectedAt,
        });
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "WhatsApp identity not found for this business." });
      }
      recordBusinessEvent({
        event: row.aiDisabled ? "whatsapp_identity.ai_disabled" : "whatsapp_identity.ai_enabled",
        action: "setWhatsappIdentityAiDisabled",
        area: "whatsapp_identity",
        businessId: ctx.businessId,
        entity: "whatsapp_identity",
        entityId: row.phoneNumberId,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: "success",
        attributes: {
          display_phone_number: row.displayPhoneNumber ?? null,
        },
      });
      return row;
    }),

  getMine: businessProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input, ctx }) => {
      if (ctx.userEmail && input.email !== ctx.userEmail) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }

      const [biz] = await db.select().from(businesses).where(eq(businesses.id, ctx.businessId));
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

      const user = await db.select().from(users).where(eq(users.firebaseUid, ctx.firebaseUid)).then(r => r[0]);
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      if (user.businessId !== input.businessId) {
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
        .where(eq(businesses.id, input.businessId))
        .returning();
      if (updated) {
        recordBusinessEvent({
          event: "business.booking_config_updated",
          action: "updateBookingConfig",
          area: "business",
          businessId: ctx.businessId,
          entity: "business",
          entityId: updated.id,
          userId: ctx.userId,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
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

      await upsertBusinessOrderSettings(input.businessId, normalized);

      const [updated] = await db
        .update(businesses)
        .set({
          settings: mergeOrderFlowSettings((biz.settings ?? {}) as Record<string, unknown>, normalized),
          updatedAt: new Date(),
        })
        .where(eq(businesses.id, input.businessId))
        .returning();

      if (updated) {
        recordBusinessEvent({
          event: "business.order_settings_updated",
          action: "updateOrderSettings",
          area: "business",
          businessId: ctx.businessId,
          entity: "business",
          entityId: updated.id,
          userId: ctx.userId,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
          actorType: "user",
          outcome: "success",
          attributes: {
            currency: normalized.currency,
            payment_method: normalized.paymentMethod,
            ticket_to_order_enabled: normalized.ticketToOrderEnabled,
          },
        });
      }

      return updated ?? null;
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

      const [biz] = await db.select().from(businesses).where(eq(businesses.id, input.businessId)).limit(1);
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

      await upsertBusinessCustomizationSettings(input.businessId, normalized);

      const [updated] = await db
        .update(businesses)
        .set({
          settings: mergeCustomizationSettings((biz.settings ?? {}) as Record<string, unknown>, normalized),
          updatedAt: new Date(),
        })
        .where(eq(businesses.id, input.businessId))
        .returning();

      if (updated) {
        recordBusinessEvent({
          event: "business.customization_settings_updated",
          action: "updateCustomizationSettings",
          area: "business",
          businessId: ctx.businessId,
          entity: "business",
          entityId: updated.id,
          userId: ctx.userId,
          actorId: ctx.firebaseUid ?? ctx.userId ?? null,
          actorType: "user",
          outcome: "success",
          attributes: {
            has_logo: Boolean(normalized.logoBlobPath || normalized.logoUrl),
            primary_color: normalized.primaryColor,
            secondary_color: normalized.secondaryColor,
          },
        });
      }

      return updated ?? null;
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
    const [biz] = await db.select().from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1);
    if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

    const [customization, preferences, websiteWidgetSettings, phoneNumbers] = await Promise.all([
      getBusinessCustomizationSettingsRecord(ctx.businessId, biz.settings),
      getBusinessPreferencesRecord(ctx.businessId, biz.settings),
      getBusinessWebsiteWidgetSettingsRecord(ctx.businessId, biz.settings),
      db
        .select({ phoneNumberId: whatsappIdentities.phoneNumberId })
        .from(whatsappIdentities)
        .where(and(eq(whatsappIdentities.businessId, ctx.businessId), eq(whatsappIdentities.isActive, true))),
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

      const customization = await getBusinessCustomizationSettingsRecord(ctx.businessId, biz.settings);
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
        creditsBalance: Number(biz.creditPool || 0),
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
  }),
});

function filterSubscriptionRecord<T>(record: Record<string, T>, prefix: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key.startsWith(prefix)));
}
