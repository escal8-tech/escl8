import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { agents } from "@/../drizzle/schema";
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

function buildScopedAgent(input: { botType: string | null; agentName: string | null; agentId: string; }): FlowAgentManifest {
  const baseAgent = flowBuilderAgents.find((agent) => agent.id === mapTemplateAgentId(input.botType)) ?? flowBuilderAgents[0];
  const numberLabel = String(input.agentName || "").trim() || input.agentId;
  const botLabel = relabelBotType(input.botType);
  return {
    ...baseAgent,
    channel: "WhatsApp",
    botType: normalizeFlowBotType(input.botType),
    owned: 1,
    health: "Business scoped",
    name: `${botLabel} Flow`,
    description: `Edit the ${botLabel.toLowerCase()} runtime for ${numberLabel}. Changes stay scoped to this Agent.`,
    runtimeGraph: `${baseAgent.runtimeGraph}.${input.agentId.slice(-6)}`,
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
    .input(z.object({ agentId: z.string().min(1).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const dbAgents = await db
        .select()
        .from(agents)
        .where(and(eq(agents.businessId, ctx.businessId), eq(agents.isActive, true)))
        .orderBy(agents.createdAt);

      if (!dbAgents.length) {
        return {
          identities: [],
          selectedIdentity: null,
          agent: null,
          modules: [],
          lastSavedAt: null,
          storageScope: null,
        };
      }

      const selectedDbAgent =
        dbAgents.find((a) => a.id === input?.agentId) ?? dbAgents[0];
      if (!selectedDbAgent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found for this business." });
      }

      const settings = asRecord(selectedDbAgent.settings);
      const savedDraft = asRecord(settings["flowBuilderDraft"]);
      const savedModulesResult = z.array(flowModuleSchema).safeParse(savedDraft.modules);
      const agent = buildScopedAgent({
        botType: selectedDbAgent.botType,
        agentName: selectedDbAgent.name,
        agentId: selectedDbAgent.id,
      });

      // Map dbAgents to the expected identities format for the frontend dropdown
      const identities = dbAgents.map(a => ({
        phoneNumberId: a.id,
        displayPhoneNumber: a.name,
        botType: a.botType,
      }));

      return {
        identities,
        selectedIdentity: identities.find(i => i.phoneNumberId === selectedDbAgent.id)!,
        agent,
        modules: savedModulesResult.success ? savedModulesResult.data : agent.modules,
        lastSavedAt: typeof savedDraft.updatedAt === "string" ? savedDraft.updatedAt : null,
        storageScope: `business:${ctx.businessId}:agent:${selectedDbAgent.id}`,
      };
    }),

  saveDraft: businessProcedure
    .input(
      z.object({
        phoneNumberId: z.string().min(1), // frontend still calls it phoneNumberId, but it's agentId now
        modules: z.array(flowModuleSchema).min(1).max(24),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [dbAgent] = await db
        .select()
        .from(agents)
        .where(and(
          eq(agents.businessId, ctx.businessId),
          eq(agents.id, input.phoneNumberId),
          eq(agents.isActive, true)
        ))
        .limit(1);

      if (!dbAgent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found for this business." });
      }

      const now = new Date();
      const settings = asRecord(dbAgent.settings);
      const nextSettings = {
        ...settings,
        flowBuilderDraft: {
          botType: dbAgent.botType,
          modules: input.modules,
          updatedAt: now.toISOString(),
        },
      };

      await db
        .update(agents)
        .set({
          settings: nextSettings,
          updatedAt: now,
        })
        .where(eq(agents.id, dbAgent.id));

      recordBusinessEvent({
        event: "flow_builder.draft_saved",
        action: "saveDraft",
        area: "flow_builder",
        businessId: ctx.businessId,
        entity: "agent",
        entityId: dbAgent.id,
        userId: ctx.userId,
        actorId: ctx.firebaseUid ?? ctx.userId ?? null,
        actorType: "user",
        outcome: "success",
        attributes: {
          bot_type: dbAgent.botType,
          agent_name: dbAgent.name,
          module_count: input.modules.length,
        },
      });

      return {
        ok: true,
        updatedAt: now.toISOString(),
      };
    }),
});
