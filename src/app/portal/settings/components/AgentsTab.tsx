"use client";

import { useState } from "react";
import { trpc } from "@/utils/trpc";
import { useToast } from "@/components/ToastProvider";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";
import { UploadContent } from "@/app/portal/upload/components/UploadContent";

export function AgentsTab() {
  const toast = useToast();
  const agentsQuery = trpc.agents.listAgents.useQuery();
  const createAgent = trpc.agents.createAgent.useMutation();
  const updateAgent = trpc.agents.updateAgent.useMutation();
  
  const [newAgentName, setNewAgentName] = useState("");
  const [newBotType, setNewBotType] = useState("AGENT");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const handleCreateAgent = async () => {
    if (!newAgentName.trim()) return;
    try {
      await createAgent.mutateAsync({ name: newAgentName, botType: newBotType });
      showSuccessToast(toast, { title: "Success", message: "Agent created successfully" });
      setNewAgentName("");
      setNewBotType("AGENT");
      agentsQuery.refetch();
    } catch (e) {
      showErrorToast(toast, { title: "Error", message: "Failed to create agent" });
    }
  };

  const handleToggleAgent = async (id: string, current: boolean) => {
    try {
      await updateAgent.mutateAsync({ id, isActive: !current });
      showSuccessToast(toast, { title: "Success", message: "Agent status updated" });
      agentsQuery.refetch();
    } catch (e) {
      showErrorToast(toast, { title: "Error", message: "Failed to update agent status" });
    }
  };

  const agents = agentsQuery.data || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px 0" }}>Agents</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Manage your AI agents. Create new agents, assign them to channels, and train them with specific documents.
        </p>
      </div>

      <div style={{ background: "var(--card)", padding: 24, borderRadius: 16, border: "1px solid var(--border)" }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 16px 0" }}>Create New Agent</h2>
        <div style={{ display: "flex", gap: 12 }}>
          <input
            type="text"
            placeholder="Agent Name (e.g. Sales Bot)"
            value={newAgentName}
            onChange={(e) => setNewAgentName(e.target.value)}
            style={{
              flex: 1,
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--background)",
              color: "var(--foreground)",
            }}
          />
          <select
            value={newBotType}
            onChange={(e) => setNewBotType(e.target.value)}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--background)",
              color: "var(--foreground)",
            }}
          >
            <option value="AGENT">AGENT (Default)</option>
            <option value="ORDER2">ORDER2</option>
            <option value="RESERVATION2">RESERVATION2</option>
            <option value="HOTEL_BOOKING">HOTEL_BOOKING</option>
          </select>
          <button
            onClick={handleCreateAgent}
            disabled={!newAgentName.trim() || createAgent.isPending}
            style={{
              padding: "10px 20px",
              background: "var(--primary)",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {createAgent.isPending ? "Creating..." : "Create Agent"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {agentsQuery.isLoading ? (
          <div>Loading agents...</div>
        ) : agents.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, background: "var(--card)", borderRadius: 16, border: "1px dashed var(--border)" }}>
            <p style={{ color: "var(--muted)" }}>No agents found. Create one above.</p>
          </div>
        ) : (
          agents.map((agent) => (
            <div key={agent.id} style={{
              background: "var(--card)",
              padding: 24,
              borderRadius: 16,
              border: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 4px 0", color: "var(--foreground)" }}>{agent.name}</h3>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: agent.isActive ? "#10b981" : "#ef4444"
                    }} />
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>
                      {agent.isActive ? "Active" : "Inactive"} • {agent.botType || "AGENT"}
                    </span>
                  </div>
                </div>
                
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <button
                    onClick={() => setSelectedAgentId(selectedAgentId === agent.id ? null : agent.id)}
                    style={{
                      padding: "8px 16px",
                      background: "transparent",
                      color: "var(--foreground)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    {selectedAgentId === agent.id ? "Close Training" : "Train"}
                  </button>
                  <button
                    onClick={() => handleToggleAgent(agent.id, agent.isActive)}
                    style={{
                      padding: "8px 16px",
                      background: agent.isActive ? "rgba(239, 68, 68, 0.1)" : "rgba(16, 185, 129, 0.1)",
                      color: agent.isActive ? "#ef4444" : "#10b981",
                      border: "none",
                      borderRadius: 6,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    {agent.isActive ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>

              {selectedAgentId === agent.id && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                  <UploadContent agentId={agent.id} />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
