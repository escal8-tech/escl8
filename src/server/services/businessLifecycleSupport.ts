import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { businesses, channelIdentities, whatsappIdentityDetails } from "../../../drizzle/schema";
import {
  getBusinessCustomizationSettingsRecord,
  getBusinessPreferencesRecord,
  getBusinessWebsiteWidgetSettingsRecord,
} from "@/server/services/businessSettingsStore";
import { recordBusinessEvent } from "@/lib/business-monitoring";

export interface BusinessContext {
  businessId: string;
  userId?: string | null;
  firebaseUid?: string | null;
}

export async function setWhatsappIdentityAutoReplyPaused(
  ctx: BusinessContext,
  input: { phoneNumberId: string; autoReplyPaused: boolean }
) {
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
    userId: ctx.userId || null,
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
}

export async function setWhatsappIdentityAiDisabled(
  ctx: BusinessContext,
  input: { phoneNumberId: string; aiDisabled: boolean }
) {
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
    userId: ctx.userId || null,
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
}

export function numberLimit(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
