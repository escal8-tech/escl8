import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db/client";
import {
  channelIdentities,
  whatsappIdentityDetails,
  agents,
} from "@/../drizzle/schema";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { withCache, delCached } from "@/lib/redis";

export async function listPhoneNumbersForBusiness(businessId: string) {
  return withCache(`biz:listPhoneNumbers:${businessId}`, 60, async () => {
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
  });
}

async function invalidatePhoneNumberCache(businessId: string) {
  await delCached(`biz:listPhoneNumbers:${businessId}`);
}

export async function setWhatsappIdentityAutoReplyPaused(args: {
  businessId: string;
  userId?: string;
  firebaseUid?: string | null;
  phoneNumberId: string;
  autoReplyPaused: boolean;
}) {
  const details = await db
    .select({
      channelIdentityId: whatsappIdentityDetails.channelIdentityId,
      displayPhoneNumber: whatsappIdentityDetails.displayPhoneNumber,
      phoneNumberId: whatsappIdentityDetails.phoneNumberId,
    })
    .from(whatsappIdentityDetails)
    .innerJoin(channelIdentities, eq(whatsappIdentityDetails.channelIdentityId, channelIdentities.id))
    .where(and(
      eq(whatsappIdentityDetails.phoneNumberId, args.phoneNumberId),
      eq(channelIdentities.businessId, args.businessId),
    ))
    .limit(1)
    .then(r => r[0]);

  if (!details) {
    throw new TRPCError({ code: "NOT_FOUND", message: "WhatsApp identity not found for this business." });
  }

  const [row] = await db
    .update(channelIdentities)
    .set({
      autoReplyPaused: args.autoReplyPaused,
      updatedAt: new Date(),
    })
    .where(and(
      eq(channelIdentities.businessId, args.businessId),
      eq(channelIdentities.id, details.channelIdentityId),
    ))
    .returning();

  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "WhatsApp identity not found for this business." });
  }

  await invalidatePhoneNumberCache(args.businessId);

  recordBusinessEvent({
    event: args.autoReplyPaused ? "whatsapp_identity.auto_reply_paused" : "whatsapp_identity.auto_reply_resumed",
    action: "setWhatsappIdentityAutoReplyPaused",
    area: "whatsapp_identity",
    businessId: args.businessId,
    entity: "whatsapp_identity",
    entityId: details.phoneNumberId,
    userId: args.userId,
    actorId: args.firebaseUid ?? args.userId ?? null,
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

export async function setWhatsappIdentityAiDisabled(args: {
  businessId: string;
  userId?: string;
  firebaseUid?: string | null;
  phoneNumberId: string;
  aiDisabled: boolean;
}) {
  const details = await db
    .select({
      channelIdentityId: whatsappIdentityDetails.channelIdentityId,
      displayPhoneNumber: whatsappIdentityDetails.displayPhoneNumber,
      phoneNumberId: whatsappIdentityDetails.phoneNumberId,
    })
    .from(whatsappIdentityDetails)
    .innerJoin(channelIdentities, eq(whatsappIdentityDetails.channelIdentityId, channelIdentities.id))
    .where(and(
      eq(whatsappIdentityDetails.phoneNumberId, args.phoneNumberId),
      eq(channelIdentities.businessId, args.businessId),
    ))
    .limit(1)
    .then(r => r[0]);

  if (!details) {
    throw new TRPCError({ code: "NOT_FOUND", message: "WhatsApp identity not found for this business." });
  }

  const [row] = await db
    .update(channelIdentities)
    .set({
      aiEnabled: !args.aiDisabled,
      ...(args.aiDisabled ? { autoReplyPaused: false } : {}),
      updatedAt: new Date(),
    })
    .where(and(
      eq(channelIdentities.businessId, args.businessId),
      eq(channelIdentities.id, details.channelIdentityId),
    ))
    .returning();

  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "WhatsApp identity not found for this business." });
  }

  await invalidatePhoneNumberCache(args.businessId);

  recordBusinessEvent({
    event: args.aiDisabled ? "whatsapp_identity.ai_disabled" : "whatsapp_identity.ai_enabled",
    action: "setWhatsappIdentityAiDisabled",
    area: "whatsapp_identity",
    businessId: args.businessId,
    entity: "whatsapp_identity",
    entityId: details.phoneNumberId,
    userId: args.userId,
    actorId: args.firebaseUid ?? args.userId ?? null,
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
