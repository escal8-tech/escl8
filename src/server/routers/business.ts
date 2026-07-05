import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { businesses } from "../../../drizzle/schema";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createOrderInvoicePreviewArtifact } from "@/server/services/orderInvoice";
import {
  getBusinessCustomizationSettingsRecord,
  getBusinessOrderSettingsRecord,
} from "@/server/services/businessSettingsStore";
import * as readSupport from "@/server/services/businessReadSupport";
import * as lifecycleSupport from "@/server/services/businessLifecycleSupport";

const businessMessageUsageTierSchema = z.enum(["minimum", "standard", "enterprise"]);

export const businessRouter = router({
  listPhoneNumbers: businessProcedure.query(async ({ ctx }) => {
    return readSupport.listPhoneNumbers(ctx);
  }),

  setWhatsappIdentityAutoReplyPaused: businessProcedure
    .input(z.object({
      phoneNumberId: z.string().min(1),
      autoReplyPaused: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      return lifecycleSupport.setWhatsappIdentityAutoReplyPaused(ctx, input);
    }),

  setWhatsappIdentityAiDisabled: businessProcedure
    .input(z.object({
      phoneNumberId: z.string().min(1),
      aiDisabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      return lifecycleSupport.setWhatsappIdentityAiDisabled(ctx, input);
    }),

  getMine: businessProcedure
    .input(z.object({ email: z.string().email().optional() }).optional().default({}))
    .query(async ({ input, ctx }) => {
      if (ctx.userEmail && input.email && input.email !== ctx.userEmail) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }
      return readSupport.getMine(ctx);
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
      return lifecycleSupport.updateBookingConfig(ctx, input);
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
      return lifecycleSupport.updateTimezone(ctx, input);
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
      return lifecycleSupport.updateOrderSettings(ctx, input);
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
      return lifecycleSupport.updateCustomizationSettings(ctx, input);
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
      return lifecycleSupport.ensureWebsiteWidget(ctx, input);
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
      return lifecycleSupport.disconnectGmailConnection(ctx);
    }),

  getSetupStatus: businessProcedure.query(async ({ ctx }) => {
    return lifecycleSupport.assembleBusinessSetupStatus(ctx.businessId);
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
      return lifecycleSupport.completeOnboardingSetup(ctx, input);
    }),

  getSubscription: businessProcedure.query(async ({ ctx }) => {
    return readSupport.getSubscription(ctx);
  }),
});
