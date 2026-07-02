import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import * as readSupport from "../services/businessReadSupport";
import * as lifecycleSupport from "../services/businessLifecycleSupport";
import { withStatsCache } from "../lib/statsCache";

const businessMessageUsageTierSchema = z.enum(["minimum", "standard", "enterprise"]);

export const businessRouter = router({
  listPhoneNumbers: businessProcedure.query(async ({ ctx }) => {
    return withStatsCache(`listPhoneNumbers_${ctx.businessId}`, 60, () =>
      readSupport.listPhoneNumbers(ctx.businessId),
    );
  }),

  setWhatsappIdentityAutoReplyPaused: businessProcedure
    .input(z.object({
      phoneNumberId: z.string().min(1),
      autoReplyPaused: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      return lifecycleSupport.setWhatsappIdentityAutoReplyPaused({
        businessId: ctx.businessId,
        userId: ctx.userId,
        firebaseUid: ctx.firebaseUid,
        phoneNumberId: input.phoneNumberId,
        autoReplyPaused: input.autoReplyPaused,
      });
    }),

  setWhatsappIdentityAiDisabled: businessProcedure
    .input(z.object({
      phoneNumberId: z.string().min(1),
      aiDisabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      return lifecycleSupport.setWhatsappIdentityAiDisabled({
        businessId: ctx.businessId,
        userId: ctx.userId,
        firebaseUid: ctx.firebaseUid,
        phoneNumberId: input.phoneNumberId,
        aiDisabled: input.aiDisabled,
      });
    }),

  getMine: businessProcedure
    .input(z.object({ email: z.string().email().optional() }).optional().default({}))
    .query(async ({ input, ctx }) => {
      if (ctx.userEmail && input.email && input.email !== ctx.userEmail) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }
      return withStatsCache(`getMine_${ctx.businessId}`, 60, () =>
        readSupport.getMine(ctx.businessId),
      );
    }),

  getCustomizationPreview: businessProcedure.query(async ({ ctx }) => {
    return lifecycleSupport.getCustomizationPreview(ctx.businessId);
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

      return lifecycleSupport.updateBookingConfig({
        businessId: ctx.businessId,
        userId: ctx.userId,
        firebaseUid: ctx.firebaseUid,
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

      return lifecycleSupport.updateTimezone({
        businessId: ctx.businessId,
        userId: ctx.userId,
        firebaseUid: ctx.firebaseUid,
        timezone: input.timezone,
      });
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

      return lifecycleSupport.updateOrderSettings({
        businessId: ctx.businessId,
        userId: ctx.userId,
        firebaseUid: ctx.firebaseUid,
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
      if (ctx.userEmail && input.email !== ctx.userEmail) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }
      if (input.businessId !== ctx.businessId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Business mismatch" });
      }

      return lifecycleSupport.updateCustomizationSettings({
        businessId: ctx.businessId,
        userId: ctx.userId,
        firebaseUid: ctx.firebaseUid,
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

      return lifecycleSupport.ensureWebsiteWidget({
        businessId: ctx.businessId,
        userId: ctx.userId,
        firebaseUid: ctx.firebaseUid,
      });
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

      return lifecycleSupport.disconnectGmailConnection({
        businessId: ctx.businessId,
        userId: ctx.userId,
        firebaseUid: ctx.firebaseUid,
      });
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
      return lifecycleSupport.completeOnboardingSetup({
        businessId: ctx.businessId,
        userId: ctx.userId,
        firebaseUid: ctx.firebaseUid,
        userEmail: ctx.userEmail,
        businessName: input.businessName,
        website: input.website,
        phone: input.phone,
        address: input.address,
        timezone: input.timezone,
        primaryCategory: input.primaryCategory,
        categories: input.categories,
        serviceTypes: input.serviceTypes,
        resourceTypes: input.resourceTypes,
      });
    }),

  getSubscription: businessProcedure.query(async ({ ctx }) => {
    return readSupport.getSubscription(ctx.businessId);
  }),
});
