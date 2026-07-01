import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { channelIdentities, whatsappIdentityDetails, agents } from "../../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { Context } from "@/server/trpc";

export async function listPhoneNumbers(ctx: Context) {
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
}

export async function setWhatsappIdentityAutoReplyPaused(ctx: Context, input: { phoneNumberId: string; autoReplyPaused: boolean }) {
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
}

export async function setWhatsappIdentityAiDisabled(ctx: Context, input: { phoneNumberId: string; aiDisabled: boolean }) {
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
}
