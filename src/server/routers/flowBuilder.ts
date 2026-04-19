import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { businesses, whatsappIdentities } from "@/../drizzle/schema";
import { cloneFlowModules, flowBuilderAgents, type FlowAgentManifest } from "@/lib/flow-builder/registry";
import { recordBusinessEvent } from "@/lib/business-monitoring";
import { db } from "../db/client";
import { businessProcedure, router } from "../trpc";
import { TRPCError } from "@trpc/server";

const flowModuleSettingSchema = z.object({
  label: z.string().min(1).max(120),
  value: z.string().max(500),
  tone: z.enum(["good", "warn", "muted"]).optional(),
  editable: z.boolean().optional(),
});

const flowModuleSchema = z.object({
  id: z.string().min(1).max(120),
  runtimeKey: z.string().min(1).max(240),
  title: z.string().min(1).max(160),
  type: z.string().min(1).max(120),
  summary: z.string().max(1000),
  status: z.enum(["live", "review", "draft"]),
  position: z.object({
    x: z.number().min(0).max(5000),
    y: z.number().min(0).max(5000),
  }),
  channels: z.array(z.string().min(1).max(80)).max(10),
  integrations: z.array(z.string().min(1).max(120)).max(20),
  settings: z.array(flowModuleSettingSchema).max(20),
  debug: z.object({
    phase: z.string().min(1).max(120),
    llmCalls: z.array(z.string().min(1).max(160)).max(20),
    stateKeys: z.array(z.string().min(1).max(160)).max(30),
    emits: z.array(z.string().min(1).max(160)).max(30),
  }),
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function mapTemplateAgentId(botType: string | null | undefined) {
  const normalized = String(botType || "").trim().toUpperCase();
  if (normalized === "ORDER" || normalized === "AGENT") return "whatsapp-order";
  if (normalized === "BOOKING" || normalized === "RESERVATION") return "booking-desk";
  if (normalized === "CONCIERGE") return "concierge";
  return "whatsapp-order";
}

function normalizeFlowBotType(botType: string | null | undefined): "AGENT" | "ORDER" | "BOOKING" | "CONCIERGE" {
  const normalized = String(botType || "").trim().toUpperCase();
  if (normalized === "ORDER") return "ORDER";
  if (normalized === "BOOKING" || normalized === "RESERVATION") return "BOOKING";
  if (normalized === "CONCIERGE") return "CONCIERGE";
  return "AGENT";
}

function relabelBotType(botType: string | null | undefined): string {
  const normalized = String(botType || "").trim().toUpperCase();
  if (normalized === "RESERVATION") return "Reservation";
  if (normalized === "ORDER") return "Order";
  if (normalized === "CONCIERGE") return "Concierge";
  if (normalized === "BOOKING") return "Booking";
  return "Agent";
}

function swapToWhatsApp(values: string[]): string[] {
  return values.map((value) => (value === "Instagram" ? "WhatsApp" : value));
}

function swapTextToWhatsApp(value: string): string {
  return value
    .replace(/Instagram Inbox/gi, "WhatsApp Inbox")
    .replace(/Instagram DM/gi, "WhatsApp")
    .replace(/\bDMs\b/gi, "messages")
    .replace(/\bDM\b/gi, "message")
    .replace(/messages and comments/gi, "messages")
    .replace(/Instagram/gi, "WhatsApp");
}

function buildScopedAgent(input: {
  botType: string | null;
  displayPhoneNumber: string | null;
  phoneNumberId: string;
}): FlowAgentManifest {
  const baseAgent = flowBuilderAgents.find((agent) => agent.id === mapTemplateAgentId(input.botType)) ?? flowBuilderAgents[0];
  const numberLabel = String(input.displayPhoneNumber || "").trim() || input.phoneNumberId;
  const botLabel = relabelBotType(input.botType);
  return {
    ...baseAgent,
    channel: "WhatsApp",
    botType: normalizeFlowBotType(input.botType),
    owned: 1,
    health: "Business scoped",
    name: `${botLabel} Flow`,
    description: `Edit the ${botLabel.toLowerCase()} runtime for ${numberLabel}. Changes stay scoped to this business and WhatsApp identity.`,
    runtimeGraph: `${baseAgent.runtimeGraph}.${input.phoneNumberId.slice(-6)}`,
    routes: baseAgent.routes.map((route) => ({
      ...route,
      name: swapTextToWhatsApp(route.name),
      from: swapTextToWhatsApp(route.from),
      to: swapTextToWhatsApp(route.to),
      condition: swapTextToWhatsApp(route.condition),
      channel: route.channel === "Instagram" ? "WhatsApp" : route.channel,
    })),
    modules: cloneFlowModules(baseAgent.id).map((module) => ({
      ...module,
      title: swapTextToWhatsApp(module.title),
      summary: swapTextToWhatsApp(module.summary),
      channels: swapToWhatsApp(module.channels),
      integrations: [...module.integrations],
      settings: module.settings.map((setting) => {
        if (setting.label === "Identity") {
          return { ...setting, value: numberLabel, editable: false };
        }
        if (setting.label === "Source" && String(setting.value).trim().toLowerCase() === "instagram dm") {
          return { ...setting, value: "WhatsApp", editable: false };
        }
        if (setting.label === "Connected channel") {
          return { ...setting, value: "WhatsApp", editable: false };
        }
        return {
          ...setting,
          value: swapTextToWhatsApp(setting.value),
        };
      }),
    })),
  };
}

export const flowBuilderRouter = router({
  getWorkspace: businessProcedure
    .input(z.object({ phoneNumberId: z.string().min(1).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const identities = await db
        .select({
          phoneNumberId: whatsappIdentities.phoneNumberId,
          displayPhoneNumber: whatsappIdentities.displayPhoneNumber,
          botType: whatsappIdentities.botType,
          connectedAt: whatsappIdentities.connectedAt,
        })
        .from(whatsappIdentities)
        .where(and(eq(whatsappIdentities.businessId, ctx.businessId), eq(whatsappIdentities.isActive, true)))
        .orderBy(whatsappIdentities.connectedAt);

      if (!identities.length) {
        return {
          identities: [],
          selectedIdentity: null,
          agent: null,
          modules: [],
          lastSavedAt: null,
          storageScope: null,
        };
      }

      const selectedIdentity =
        identities.find((identity) => identity.phoneNumberId === input?.phoneNumberId)
        ?? identities[0];
      if (!selectedIdentity) {
        throw new TRPCError({ code: "NOT_FOUND", message: "WhatsApp identity not found for this business." });
      }

      const [businessRow] = await db
        .select({ settings: businesses.settings })
        .from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .limit(1);

      const settings = asRecord(businessRow?.settings);
      const draftStore = asRecord(settings.flowBuilderDrafts);
      const savedDraft = asRecord(draftStore[selectedIdentity.phoneNumberId]);
      const savedModulesResult = z.array(flowModuleSchema).safeParse(savedDraft.modules);
      const agent = buildScopedAgent({
        botType: selectedIdentity.botType,
        displayPhoneNumber: selectedIdentity.displayPhoneNumber,
        phoneNumberId: selectedIdentity.phoneNumberId,
      });

      return {
        identities,
        selectedIdentity,
        agent,
        modules: savedModulesResult.success ? savedModulesResult.data : agent.modules,
        lastSavedAt: typeof savedDraft.updatedAt === "string" ? savedDraft.updatedAt : null,
        storageScope: `business:${ctx.businessId}:whatsapp:${selectedIdentity.phoneNumberId}`,
      };
    }),

  saveDraft: businessProcedure
    .input(
      z.object({
        phoneNumberId: z.string().min(1),
        modules: z.array(flowModuleSchema).min(1).max(24),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [identity] = await db
        .select({
          phoneNumberId: whatsappIdentities.phoneNumberId,
          displayPhoneNumber: whatsappIdentities.displayPhoneNumber,
          botType: whatsappIdentities.botType,
        })
        .from(whatsappIdentities)
        .where(and(
          eq(whatsappIdentities.businessId, ctx.businessId),
          eq(whatsappIdentities.phoneNumberId, input.phoneNumberId),
          eq(whatsappIdentities.isActive, true),
        ))
        .limit(1);
      if (!identity) {
        throw new TRPCError({ code: "NOT_FOUND", message: "WhatsApp identity not found for this business." });
      }

      const [businessRow] = await db
        .select({ settings: businesses.settings })
        .from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .limit(1);
      if (!businessRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Business not found." });
      }

      const now = new Date();
      const settings = asRecord(businessRow.settings);
      const draftStore = asRecord(settings.flowBuilderDrafts);
      const nextSettings = {
        ...settings,
        flowBuilderDrafts: {
          ...draftStore,
          [input.phoneNumberId]: {
            botType: identity.botType,
            modules: input.modules,
            updatedAt: now.toISOString(),
          },
        },
      };

      await db
        .update(businesses)
        .set({
          settings: nextSettings,
          updatedAt: now,
        })
        .where(eq(businesses.id, ctx.businessId));

      recordBusinessEvent({
        event: "flow_builder.draft_saved",
        action: "saveDraft",
        area: "flow_builder",
        businessId: ctx.businessId,
        entity: "whatsapp_identity",
        entityId: input.phoneNumberId,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: "success",
        attributes: {
          bot_type: identity.botType,
          display_phone_number: identity.displayPhoneNumber ?? null,
          module_count: input.modules.length,
        },
      });

      return {
        ok: true,
        updatedAt: now.toISOString(),
      };
    }),
});
