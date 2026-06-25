"use client";

import { useState } from "react";
import { PortalSelect } from "@/app/portal/components/PortalSelect";
import { UploadContent } from "@/app/portal/upload/components/UploadContent";
import { useToast } from "@/components/ToastProvider";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";
import { trpc } from "@/utils/trpc";
import { StockSettingsPanel } from "./StockSettingsPanel";

const BOT_TYPE_OPTIONS = [
  { value: "AGENT", label: "AGENT" },
  { value: "ORDER2", label: "ORDER2" },
  { value: "RESERVATION2", label: "RESERVATION2" },
  { value: "HOTEL_BOOKING", label: "HOTEL_BOOKING" },
];

function modalSurface(children: React.ReactNode) {
  return (
    <div className="fixed inset-0 z-[5000] grid place-items-center bg-slate-950/65 p-4 backdrop-blur-md">
      {children}
    </div>
  );
}

export function AgentsTab() {
  const toast = useToast();
  const agentsQuery = trpc.agents.listAgents.useQuery();
  const createAgent = trpc.agents.createAgent.useMutation();
  const updateAgent = trpc.agents.updateAgent.useMutation();

  const [newAgentName, setNewAgentName] = useState("");
  const [newBotType, setNewBotType] = useState("AGENT");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [mapColumnsAgentId, setMapColumnsAgentId] = useState<string | null>(null);

  const handleCreateAgent = async () => {
    if (!newAgentName.trim()) return;
    try {
      await createAgent.mutateAsync({ name: newAgentName, botType: newBotType });
      showSuccessToast(toast, { title: "Success", message: "Agent created successfully" });
      setNewAgentName("");
      setNewBotType("AGENT");
      setIsCreateModalOpen(false);
      agentsQuery.refetch();
    } catch {
      showErrorToast(toast, { title: "Error", message: "Failed to create agent" });
    }
  };

  const handleToggleAgent = async (id: string, current: boolean) => {
    try {
      await updateAgent.mutateAsync({ id, isActive: !current });
      showSuccessToast(toast, { title: "Success", message: "Agent status updated" });
      agentsQuery.refetch();
    } catch {
      showErrorToast(toast, { title: "Error", message: "Failed to update agent status" });
    }
  };

  const agents = agentsQuery.data || [];

  return (
    <div className="space-y-6 bg-[var(--settings-page-bg)] p-6">
      <section className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-[#1A2332]/95 p-6 shadow-[0_18px_44px_rgba(2,6,23,0.22)] md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold text-white">Agents</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Manage your AI agents. Create new agents, assign them to channels, and train them with business-specific documents.
          </p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="inline-flex h-12 items-center justify-center rounded-xl bg-[#1656d8] px-5 text-sm font-semibold text-white transition hover:brightness-110"
        >
          Create New Agent
        </button>
      </section>

      {isCreateModalOpen ? modalSurface(
        <div className="w-full max-w-2xl rounded-[28px] border border-white/10 bg-[#1A2332] shadow-[0_24px_80px_rgba(0,0,0,0.4)]">
          <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#d8b45a]">Agents</div>
              <h2 className="mt-2 text-[32px] font-semibold leading-none text-white">Create new agent</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">Set the agent name and choose the bot family before training it.</p>
            </div>
            <button
              onClick={() => setIsCreateModalOpen(false)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#45607d] bg-[#20324a] text-2xl leading-none text-slate-300 transition hover:text-white"
            >
              ×
            </button>
          </div>
          <div className="grid gap-5 p-6">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Agent Name</label>
              <input
                type="text"
                placeholder="e.g. Sales Bot"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                className="h-12 w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Agent Type</label>
              <PortalSelect
                value={newBotType}
                onValueChange={setNewBotType}
                options={BOT_TYPE_OPTIONS}
                ariaLabel="Agent type"
                style={{ minHeight: 48, borderRadius: 14 }}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t border-white/10 px-6 py-5">
            <button
              onClick={() => setIsCreateModalOpen(false)}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateAgent}
              disabled={!newAgentName.trim() || createAgent.isPending}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-[#c7a64f] px-5 text-sm font-semibold text-[#0f172a] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createAgent.isPending ? "Creating..." : "Create Agent"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        {agentsQuery.isLoading ? (
          <div className="rounded-[28px] border border-white/10 bg-[#1A2332]/95 px-6 py-10 text-center text-slate-400">Loading agents...</div>
        ) : agents.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-white/10 bg-[#1A2332]/95 px-6 py-10 text-center text-slate-400">
            No agents found. Create one above.
          </div>
        ) : (
          agents.map((agent) => (
            <section
              key={agent.id}
              className="rounded-[28px] border border-white/10 bg-[#1A2332]/95 p-6 shadow-[0_18px_44px_rgba(2,6,23,0.22)]"
            >
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-xl font-semibold text-white">{agent.name}</h3>
                    <span className={`rounded-full border px-3 py-1 text-xs font-medium ${agent.isActive ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-red-400/20 bg-red-400/10 text-red-300"}`}>
                      {agent.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="mt-4 max-w-[260px]">
                    <PortalSelect
                      value={agent.botType || "AGENT"}
                      onValueChange={async (value) => {
                        try {
                          await updateAgent.mutateAsync({ id: agent.id, botType: value });
                          agentsQuery.refetch();
                          showSuccessToast(toast, { title: "Success", message: "Agent type updated" });
                        } catch {
                          showErrorToast(toast, { title: "Error", message: "Failed to update agent type" });
                        }
                      }}
                      options={BOT_TYPE_OPTIONS}
                      ariaLabel={`Agent type for ${agent.name}`}
                      style={{ minHeight: 44, borderRadius: 14 }}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => {
                      if (selectedAgentId === agent.id) {
                        setSelectedAgentId(null);
                      } else {
                        setSelectedAgentId(agent.id);
                        setMapColumnsAgentId(null);
                      }
                    }}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    {selectedAgentId === agent.id ? "Close Training" : "Train"}
                  </button>
                  <button
                    onClick={() => {
                      if (mapColumnsAgentId === agent.id) {
                        setMapColumnsAgentId(null);
                      } else {
                        setMapColumnsAgentId(agent.id);
                        setSelectedAgentId(null);
                      }
                    }}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    {mapColumnsAgentId === agent.id ? "Close Mapping" : "Map Columns"}
                  </button>
                  <button
                    onClick={() => handleToggleAgent(agent.id, agent.isActive)}
                    className={`inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold transition ${agent.isActive ? "border border-red-400/20 bg-red-400/10 text-red-300 hover:bg-red-400/15" : "border border-emerald-400/20 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/15"}`}
                  >
                    {agent.isActive ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>

              {selectedAgentId === agent.id ? (
                <div className="mt-6 border-t border-white/10 pt-6">
                  <UploadContent
                    agentId={agent.id}
                    onMapColumns={() => {
                      setSelectedAgentId(null);
                      setMapColumnsAgentId(agent.id);
                    }}
                  />
                </div>
              ) : null}

              {mapColumnsAgentId === agent.id ? (
                <div className="mt-6 border-t border-white/10 pt-6">
                  <StockSettingsPanel agentId={agent.id} />
                </div>
              ) : null}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
