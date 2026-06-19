import re

with open("src/server/routers/flowBuilder.ts", "r") as f:
    content = f.read()

# Replace getWorkspace and saveDraft entirely

content = re.sub(
r'  getWorkspace: businessProcedure.*?saveDraft: businessProcedure.*?\}\),',
r'''  getWorkspace: businessProcedure
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
      const savedDraft = asRecord(settings.flowBuilderDraft);
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
    }),''',
content,
flags=re.DOTALL
)

# 1. Update buildScopedAgent
content = re.sub(
    r'function buildScopedAgent\(input: \{.*?\}\): FlowAgentManifest \{',
    r'function buildScopedAgent(input: { botType: string | null; agentName: string | null; agentId: string; }): FlowAgentManifest {',
    content,
    flags=re.DOTALL
)

# 2. Update buildScopedAgent body
content = content.replace(
    'const numberLabel = String(input.displayPhoneNumber || "").trim() || input.phoneNumberId;',
    'const numberLabel = String(input.agentName || "").trim() || input.agentId;'
)
content = content.replace(
    'description: `Edit the ${botLabel.toLowerCase()} runtime for ${numberLabel}. Changes stay scoped to this business and WhatsApp identity.`,',
    'description: `Edit the ${botLabel.toLowerCase()} runtime for ${numberLabel}. Changes stay scoped to this Agent.`,',
)
content = content.replace(
    'runtimeGraph: `${baseAgent.runtimeGraph}.${input.phoneNumberId.slice(-6)}`,',
    'runtimeGraph: `${baseAgent.runtimeGraph}.${input.agentId.slice(-6)}`,'
)

with open("src/server/routers/flowBuilder.ts", "w") as f:
    f.write(content)

