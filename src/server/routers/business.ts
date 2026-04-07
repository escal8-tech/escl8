import { z } from "zod";
import { randomBytes } from "node:crypto";
import { router, businessProcedure } from "../trpc";
import { db } from "../db/client";
import { businesses, users, whatsappIdentities } from "../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { mergeOrderFlowSettings, normalizeOrderFlowSettings } from "@/lib/order-settings";
import { mergeWebsiteWidgetSettings, normalizeWebsiteWidgetSettings } from "@/lib/website-widget";
import { getBusinessAiCreditsUsed } from "@/server/services/aiUsage";

export const businessRouter = router({
  listPhoneNumbers: businessProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        phoneNumberId: whatsappIdentities.phoneNumberId,
        displayPhoneNumber: whatsappIdentities.displayPhoneNumber,
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

      const creditsUsed = await getBusinessAiCreditsUsed(ctx.businessId);

      return {
        ...biz,
        orderSettings: normalizeOrderFlowSettings(biz.settings),
        gmailConnected: Boolean(biz.gmailConnected),
        gmailEmail: biz.gmailEmail ?? null,
        gmailConnectedAt: biz.gmailConnectedAt ?? null,
        gmailError: biz.gmailError ?? null,
        responseUsage: {
          used: creditsUsed,
          max: 50_000,
        },
      };
    }),

  updateBookingConfig: businessProcedure
    .input(z.object({
      email: z.string().email(),
      businessId: z.string().min(1),
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
        ticketToOrderEnabled: z.boolean(),
        paymentMethod: z.enum(["manual", "cod", "bank_qr"]),
        currency: z.string().min(1).max(10),
        bankQr: z.object({
          showQr: z.boolean(),
          showBankDetails: z.boolean(),
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

      const normalized = normalizeOrderFlowSettings({
        orderFlow: {
          ticketToOrderEnabled: input.ticketToOrderEnabled,
          paymentMethod: input.paymentMethod,
          currency: input.currency,
          bankQr: input.bankQr,
        },
      });

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

      const current = normalizeWebsiteWidgetSettings(biz.settings);
      const key = current.key || `ww_${randomBytes(18).toString("base64url")}`;
      const nextSettings = mergeWebsiteWidgetSettings(biz.settings, {
        enabled: true,
        key,
        title: current.title,
        accentColor: current.accentColor,
      });

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

      const widget = normalizeWebsiteWidgetSettings(updated.settings);
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
        status: widget.enabled ? "enabled" : "disabled",
      });

      return {
        enabled: widget.enabled,
        key: widget.key,
        title: widget.title,
        accentColor: widget.accentColor,
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
});
