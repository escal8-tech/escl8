"use client";

import { useMemo, useState, type DragEvent } from "react";
import {
  flowBuilderAgents,
  flowModulePalette,
  flowModuleStatusLabel,
  type FlowAgentId,
  type FlowAgentManifest,
  type FlowModuleManifest,
} from "@/lib/flow-builder/registry";
import { trpc } from "@/utils/trpc";
import styles from "./FlowBuilder.module.css";

function cloneModulesFromAgent(agent: FlowAgentManifest | undefined): FlowModuleManifest[] {
  if (!agent) return [];
  return agent.modules.map((module) => ({
    ...module,
    position: { ...module.position },
    channels: [...module.channels],
    integrations: [...module.integrations],
    settings: module.settings.map((setting) => ({ ...setting })),
    debug: {
      ...module.debug,
      llmCalls: [...module.debug.llmCalls],
      stateKeys: [...module.debug.stateKeys],
      emits: [...module.debug.emits],
    },
  }));
}

function FlowBuilderPage() {
  const manifestQuery = trpc.flowBuilder.manifest.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const [selectedAgentId, setSelectedAgentId] = useState<FlowAgentId>("whatsapp-order");
  const [selectedModuleId, setSelectedModuleId] = useState("intent-router");
  const [publishStatus, setPublishStatus] = useState("Draft autosaved");
  const [agentModules, setAgentModules] = useState<Partial<Record<FlowAgentId, FlowModuleManifest[]>>>({});

  const manifestAgents = (manifestQuery.data?.agents?.length ? manifestQuery.data.agents : flowBuilderAgents) as FlowAgentManifest[];
  const manifestVersion = manifestQuery.data?.version || "dashboard-local";
  const manifestSource = manifestQuery.data?.source || "dashboard-fallback-registry";
  const selectedAgent = manifestAgents.find((agent) => agent.id === selectedAgentId) ?? manifestAgents[0] ?? flowBuilderAgents[0];
  const modules = useMemo(
    () => agentModules[selectedAgent.id] ?? cloneModulesFromAgent(selectedAgent),
    [agentModules, selectedAgent],
  );
  const selectedModule = modules.find((module) => module.id === selectedModuleId) ?? modules[0];
  const liveCount = modules.filter((module) => module.status === "live").length;
  const llmCallCount = modules.reduce((total, module) => total + module.debug.llmCalls.length, 0);
  const integrationCount = new Set(modules.flatMap((module) => module.integrations)).size;

  function updateModulePosition(moduleId: string, x: number, y: number) {
    setAgentModules((prev) => ({
      ...prev,
      [selectedAgent.id]: (prev[selectedAgent.id] ?? cloneModulesFromAgent(selectedAgent)).map((module) =>
        module.id === moduleId
          ? {
              ...module,
              position: {
                x: Math.max(20, Math.min(940, x)),
                y: Math.max(34, Math.min(420, y)),
              },
            }
          : module,
      ),
    }));
  }

  function updateModuleSetting(moduleId: string, settingLabel: string, value: string) {
    setAgentModules((prev) => ({
      ...prev,
      [selectedAgent.id]: (prev[selectedAgent.id] ?? cloneModulesFromAgent(selectedAgent)).map((module) =>
        module.id === moduleId
          ? {
              ...module,
              settings: module.settings.map((setting) =>
                setting.label === settingLabel ? { ...setting, value } : setting,
              ),
            }
          : module,
      ),
    }));
    setPublishStatus("Settings changed");
  }

  function handleNodeDragStart(event: DragEvent<HTMLButtonElement>, moduleId: string) {
    event.dataTransfer.setData("text/plain", `module:${moduleId}`);
    event.dataTransfer.effectAllowed = "move";
  }

  function handlePaletteDragStart(event: DragEvent<HTMLButtonElement>, moduleType: string) {
    event.dataTransfer.setData("text/plain", `palette:${moduleType}`);
    event.dataTransfer.effectAllowed = "move";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const payload = event.dataTransfer.getData("text/plain");
    if (!payload) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left - 120;
    const y = event.clientY - bounds.top - 58;

    if (payload.startsWith("module:")) {
      const moduleId = payload.slice("module:".length);
      updateModulePosition(moduleId, x, y);
      setSelectedModuleId(moduleId);
      setPublishStatus("Layout changed");
      return;
    }

    if (payload.startsWith("palette:")) {
      const moduleType = payload.slice("palette:".length);
      const moduleSlug = moduleType.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const nextIndex = (agentModules[selectedAgent.id] ?? []).filter((module) => module.id.startsWith(moduleSlug)).length + 1;
      const newModule: FlowModuleManifest = {
        id: `${moduleSlug}-${nextIndex}`,
        runtimeKey: `custom.${selectedAgent.botType.toLowerCase()}.${moduleSlug}`,
        title: moduleType,
        type: "Custom module",
        summary: "New configurable block. Define behavior, required fields, integrations, and handoff rules before publishing.",
        status: "draft",
        position: { x: Math.max(20, Math.min(940, x)), y: Math.max(34, Math.min(420, y)) },
        channels: [selectedAgent.channel],
        integrations: ["Dashboard"],
        settings: [
          { label: "Behavior", value: "Configure before publishing", tone: "warn", editable: true },
          { label: "Connected channel", value: selectedAgent.channel, editable: true },
          { label: "Owner", value: selectedAgent.name },
        ],
        debug: {
          phase: "custom",
          llmCalls: moduleType.toLowerCase().includes("knowledge") ? ["custom_retrieval_decision"] : [],
          stateKeys: ["custom_module_state"],
          emits: ["custom.module_completed"],
        },
      };
      setAgentModules((prev) => ({
        ...prev,
        [selectedAgent.id]: [...(prev[selectedAgent.id] ?? cloneModulesFromAgent(selectedAgent)), newModule],
      }));
      setSelectedModuleId(newModule.id);
      setPublishStatus("New draft module added");
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Flow Builder / Engine view</p>
          <h1>Agent flow engine</h1>
          <p className={styles.heroCopy}>
            Visualize each bot type as runtime modules, LLM calls, state keys, routes, channels, and editable settings. The page reads from the bot runtime manifest when available, with a dashboard fallback registry for local development.
          </p>
        </div>
        <div className={styles.heroActions}>
          <span className={styles.publishState}>
            {manifestQuery.data?.fallback ? "Fallback manifest" : manifestQuery.isLoading ? "Loading manifest" : "Runtime manifest"}
          </span>
          <span className={styles.publishState}>{manifestVersion}</span>
          <span className={styles.publishState}>{manifestSource}</span>
          <span className={styles.publishState}>{publishStatus}</span>
          <button
            className={styles.primaryButton}
            onClick={() => setPublishStatus("Draft layout saved")}
            type="button"
          >
            Save draft
          </button>
        </div>
      </section>

      <section className={styles.agentStrip} aria-label="Agent selector">
        {manifestAgents.map((agent) => (
          <button
            key={agent.id}
            className={`${styles.agentCard} ${agent.id === selectedAgent.id ? styles.agentCardActive : ""}`}
            onClick={() => {
              setSelectedAgentId(agent.id);
              setSelectedModuleId((agentModules[agent.id] ?? agent.modules)[0]?.id ?? "");
            }}
            type="button"
          >
            <span className={styles.agentTopline}>
              <span>{agent.channel}</span>
              <strong>{agent.botType}</strong>
            </span>
            <span className={styles.agentName}>{agent.name}</span>
            <span className={styles.agentMeta}>{agent.runtimeGraph}</span>
          </button>
        ))}
        <div className={styles.agentSummary}>
          <span>Total agents</span>
          <strong>{selectedAgent.owned}</strong>
          <small>owned on this plan</small>
        </div>
      </section>

      <section className={styles.workspace}>
        <aside className={styles.leftPanel}>
          <div className={styles.panelHeader}>
            <span>Module library</span>
            <small>Manifest blocks</small>
          </div>
          <div className={styles.paletteList}>
            {flowModulePalette.map((item) => (
              <button
                key={item}
                className={styles.paletteItem}
                draggable
                onDragStart={(event) => handlePaletteDragStart(event, item)}
                type="button"
              >
                <span className={styles.paletteDot} />
                {item}
              </button>
            ))}
          </div>
          <div className={styles.panelHeader}>
            <span>Routes</span>
            <small>{selectedAgent.routes.length} active paths</small>
          </div>
          <div className={styles.routeList}>
            {selectedAgent.routes.map((route) => (
              <button key={route.name} className={styles.routeCard} type="button">
                <span>{route.name}</span>
                <strong>{route.from} {"->"} {route.to}</strong>
                <small>{route.condition}</small>
                <em>{route.channel}</em>
              </button>
            ))}
          </div>
        </aside>

        <section className={styles.canvasShell}>
          <div className={styles.canvasToolbar}>
            <div>
              <h2>{selectedAgent.name}</h2>
              <p>{selectedAgent.description}</p>
            </div>
            <div className={styles.metrics}>
              <span><strong>{modules.length}</strong> modules</span>
              <span><strong>{liveCount}</strong> live</span>
              <span><strong>{llmCallCount}</strong> LLM calls</span>
              <span><strong>{integrationCount}</strong> integrations</span>
            </div>
          </div>

          <div className={styles.canvas} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
            <svg className={styles.connectorLayer} viewBox="0 0 1160 520" preserveAspectRatio="none" aria-hidden="true">
              {modules.slice(0, -1).map((module, index) => {
                const next = modules[index + 1];
                return (
                  <path
                    key={`${module.id}-${next.id}`}
                    d={`M ${module.position.x + 244} ${module.position.y + 62} C ${module.position.x + 330} ${module.position.y + 62}, ${next.position.x - 72} ${next.position.y + 62}, ${next.position.x} ${next.position.y + 62}`}
                  />
                );
              })}
            </svg>
            {modules.map((module) => (
              <button
                key={module.id}
                draggable
                onDragStart={(event) => handleNodeDragStart(event, module.id)}
                onClick={() => setSelectedModuleId(module.id)}
                className={`${styles.flowNode} ${module.id === selectedModule?.id ? styles.flowNodeActive : ""}`}
                style={{ transform: `translate(${module.position.x}px, ${module.position.y}px)` }}
                type="button"
              >
                <span className={styles.nodeTop}>
                  <span className={styles.nodeType}>{module.type}</span>
                  <span className={`${styles.statusPill} ${styles[module.status]}`}>{flowModuleStatusLabel[module.status]}</span>
                </span>
                <strong>{module.title}</strong>
                <span>{module.summary}</span>
                <span className={styles.runtimeKey}>{module.runtimeKey}</span>
                <span className={styles.channelRow}>
                  {module.channels.map((channel) => <em key={channel}>{channel}</em>)}
                </span>
              </button>
            ))}
          </div>
        </section>

        <aside className={styles.inspector}>
          {selectedModule ? (
            <>
              <div className={styles.inspectorHeader}>
                <span className={`${styles.statusPill} ${styles[selectedModule.status]}`}>{flowModuleStatusLabel[selectedModule.status]}</span>
                <h2>{selectedModule.title}</h2>
                <p>{selectedModule.summary}</p>
                <code>{selectedModule.runtimeKey}</code>
              </div>
              <div className={styles.sectionBlock}>
                <h3>Runtime debug</h3>
                <div className={styles.debugGrid}>
                  <span>Phase <strong>{selectedModule.debug.phase}</strong></span>
                  <span>LLM calls <strong>{selectedModule.debug.llmCalls.length}</strong></span>
                  <span>State keys <strong>{selectedModule.debug.stateKeys.length}</strong></span>
                </div>
                <div className={styles.debugList}>
                  <small>LLM calls</small>
                  <p>{selectedModule.debug.llmCalls.length ? selectedModule.debug.llmCalls.join(", ") : "No LLM call in this module"}</p>
                  <small>State keys</small>
                  <p>{selectedModule.debug.stateKeys.join(", ")}</p>
                  <small>Emits</small>
                  <p>{selectedModule.debug.emits.join(", ")}</p>
                </div>
              </div>
              <div className={styles.sectionBlock}>
                <h3>Connected channels</h3>
                <div className={styles.badgeGrid}>
                  {selectedModule.channels.map((channel) => <span key={channel}>{channel}</span>)}
                </div>
              </div>
              <div className={styles.sectionBlock}>
                <h3>Integrations used</h3>
                <div className={styles.integrationList}>
                  {selectedModule.integrations.map((integration) => (
                    <div key={integration} className={styles.integrationRow}>
                      <span />
                      <strong>{integration}</strong>
                      <small>Connected</small>
                    </div>
                  ))}
                </div>
              </div>
              <div className={styles.sectionBlock}>
                <h3>Editable settings</h3>
                <div className={styles.settingList}>
                  {selectedModule.settings.map((setting) => (
                    <label key={setting.label} className={styles.settingRow}>
                      <span>{setting.label}{setting.editable ? " · editable" : ""}</span>
                      <input
                        value={setting.value}
                        readOnly={!setting.editable}
                        onChange={(event) => updateModuleSetting(selectedModule.id, setting.label, event.target.value)}
                        className={setting.tone ? styles[setting.tone] : ""}
                      />
                    </label>
                  ))}
                </div>
              </div>
              <button className={styles.primaryButtonWide} type="button">Open module settings</button>
            </>
          ) : (
            <div className={styles.emptyInspector}>Select a module to edit its settings.</div>
          )}
        </aside>
      </section>
    </main>
  );
}

export default FlowBuilderPage;
