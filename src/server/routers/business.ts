import { z } from "zod";
import { router, businessProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import * as readSupport from "../services/businessReadSupport";
import * as lifecycleSupport from "../services/businessLifecycleSupport";
import { withCache, delCached } from "@/lib/redis";

const businessMessageUsageTierSchema = z.enum(["minimum", "standard", "enterprise"]);

export const businessRouter = router({
  listPhoneNumbers: businessProcedure.query(async ({ ctx }) => {
    const cacheKey = `business:listPhoneNumbers:${ctx.businessId}`;
    return withCache(cacheKey, 60, () => readSupport.listPhoneNumbers(ctx.businessId));
  }),

  setWhatsappIdentityAutoReplyPaused: businessProcedure
    .input(z.object({
      phoneNumberId: z.string().min(1),
      autoReplyPaused: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await lifecycleSupport.setWhatsappIdentityAutoReplyPaused(ctx.businessId, ctx.userId, ctx.firebaseUid, input);
      await delCached(`business:listPhoneNumbers:${ctx.businessId}`);
      return result;
    }),

  setWhatsappIdentityAiDisabled: businessProcedure
    .input(z.object({
      phoneNumberId: z.string().min(1),
      aiDisabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await lifecycleSupport.setWhatsappIdentityAiDisabled(ctx.businessId, ctx.userId, ctx.firebaseUid, input);
      await delCached(`business:listPhoneNumbers:${ctx.businessId}`);
      return result;
    }),

  getMine: businessProcedure
    .input(z.object({ email: z.string().email().optional() }).optional().default({}))
    .query(async ({ input, ctx }) => {
      if (ctx.userEmail && input.email && input.email !== ctx.userEmail) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Email mismatch" });
      }
      const cacheKey = `business:getMine:${ctx.businessId}`;
      return withCache(cacheKey, 60, () => readSupport.getMine(ctx.businessId));
    }),

  getCustomizationPreview: businessProcedure.query(async ({ ctx }) => {
    return readSupport.getCustomizationPreview(ctx.businessId);
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
      const result = await lifecycleSupport.updateBookingConfig(ctx.businessId, ctx.userId, ctx.firebaseUid, input);
      await delCached(`business:getMine:${ctx.businessId}`);
      return result;
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
      const result = await lifecycleSupport.updateTimezone(ctx.businessId, ctx.userId, ctx.firebaseUid, input.timezone);
      await delCached(`business:getMine:${ctx.businessId}`);
      return result;
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
      const result = await lifecycleSupport.updateOrderSettings(ctx.businessId, ctx.userId, ctx.firebaseUid, input);
      await delCached(`business:getMine:${ctx.businessId}`);
      return result;
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
      const result = await lifecycleSupport.updateCustomizationSettings(ctx.businessId, ctx.userId, ctx.firebaseUid, input);
      await delCached(`business:getMine:${ctx.businessId}`);
      return result;
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
      const result = await lifecycleSupport.ensureWebsiteWidget(ctx.businessId, ctx.userId, ctx.firebaseUid);
      await delCached(`business:getMine:${ctx.businessId}`);
      return result;
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
      const result = await lifecycleSupport.disconnectGmailConnection(ctx.businessId, ctx.userId, ctx.firebaseUid);
      await delCached(`business:getMine:${ctx.businessId}`);
      return result;
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
      const result = await lifecycleSupport.completeOnboardingSetup(ctx.businessId, ctx.userEmail, input);
      await delCached(`business:getMine:${ctx.businessId}`);
      return result;
    }),

  getSubscription: businessProcedure.query(async ({ ctx }) => {
    const cacheKey = `business:getSubscription:${ctx.businessId}`;
    return withCache(cacheKey, 60, () => readSupport.getSubscription(ctx.businessId));
  }),
});
