"use client";

import { useState } from "react";
import { trpc } from "@/utils/trpc";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";

import { useToast } from "@/components/ToastProvider";

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: "24px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 32,
    background: "var(--background)",
    minHeight: "100vh",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: "var(--foreground)",
    margin: 0,
    letterSpacing: "-0.025em",
  },
  subtitle: {
    fontSize: 15,
    color: "var(--muted)",
    margin: 0,
    maxWidth: 600,
    lineHeight: 1.5,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    gap: 24,
  },
  card: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 20,
    boxShadow: "var(--shadow-sm)",
    transition: "transform 0.2s, box-shadow 0.2s",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  providerBadge: {
    padding: "6px 12px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  whatsappBadge: {
    background: "rgba(34, 197, 94, 0.1)",
    color: "#16a34a",
  },
  instagramBadge: {
    background: "rgba(236, 72, 153, 0.1)",
    color: "#db2777",
  },
  defaultBadge: {
    background: "rgba(100, 116, 139, 0.1)",
    color: "#64748b",
  },
  statusIndicator: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    fontWeight: 500,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
  },
  activeDot: {
    background: "#10b981",
    boxShadow: "0 0 0 2px rgba(16, 185, 129, 0.2)",
  },
  inactiveDot: {
    background: "#ef4444",
  },
  accountInfo: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  accountName: {
    fontSize: 18,
    fontWeight: 600,
    color: "var(--foreground)",
    margin: 0,
  },
  accountHandle: {
    fontSize: 14,
    color: "var(--muted)",
    margin: 0,
  },
  controls: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    paddingTop: 16,
    borderTop: "1px solid var(--border)",
  },
  controlRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  controlLabel: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  controlTitle: {
    fontSize: 14,
    fontWeight: 500,
    color: "var(--foreground)",
  },
  controlHint: {
    fontSize: 12,
    color: "var(--muted)",
  },
  toggle: {
    position: "relative",
    width: 44,
    height: 24,
    borderRadius: 12,
    cursor: "pointer",
    transition: "background 0.3s",
  },
  toggleKnob: {
    position: "absolute",
    top: 2,
    left: 2,
    width: 20,
    height: 20,
    borderRadius: "50%",
    background: "#fff",
    transition: "transform 0.3s",
    boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
  },
  input: {
    width: 80,
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--background)",
    color: "var(--foreground)",
    fontSize: 14,
    textAlign: "right",
    outline: "none",
  },
  emptyState: {
    padding: 64,
    textAlign: "center",
    background: "var(--card)",
    borderRadius: 16,
    border: "1px dashed var(--border)",
    color: "var(--muted)",
  }
};

export default function ConnectionsPage() {
  const toast = useToast();
  const channelsQuery = trpc.channels.listChannels.useQuery();
  const agentsQuery = trpc.agents.listAgents.useQuery();
  const updateChannel = trpc.channels.updateChannel.useMutation();

  const handleToggleAi = async (id: string, current: boolean) => {
    try {
      await updateChannel.mutateAsync({ id, aiEnabled: !current });
      showSuccessToast(toast, { title: "Success", message: "AI status updated" });
      channelsQuery.refetch();
    } catch (e) {
      showErrorToast(toast, { title: "Error", message: "Failed to update AI status" });
    }
  };

  const handleToggleAutoReply = async (id: string, current: boolean) => {
    try {
      await updateChannel.mutateAsync({ id, autoReplyPaused: !current });
      showSuccessToast(toast, { title: "Success", message: "Auto-reply status updated" });
      channelsQuery.refetch();
    } catch (e) {
      showErrorToast(toast, { title: "Error", message: "Failed to update auto-reply status" });
    }
  };

  const handleAssignAgent = async (id: string, agentId: string) => {
    try {
      await updateChannel.mutateAsync({ id, agentId });
      showSuccessToast(toast, { title: "Success", message: "Agent assigned" });
      channelsQuery.refetch();
    } catch (e) {
      showErrorToast(toast, { title: "Error", message: "Failed to assign agent" });
    }
  };

  const handleCreditLimitChange = async (id: string, value: string, oldLimit: number, totalAllocated: number, businessPool: number) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) return;
    
    // Check if new allocation exceeds business pool
    if (totalAllocated - oldLimit + num > businessPool) {
      showErrorToast(toast, { title: "Limit Exceeded", message: `Cannot exceed the business credit pool of ${businessPool}` });
      // Force re-render to reset input to old value
      channelsQuery.refetch();
      return;
    }

    try {
      await updateChannel.mutateAsync({ id, monthlyCreditLimit: num });
      showSuccessToast(toast, { title: "Success", message: "Credit limit updated" });
      channelsQuery.refetch();
    } catch (e) {
      showErrorToast(toast, { title: "Error", message: "Failed to update credit limit" });
    }
  };

  const channels = channelsQuery.data?.channels || [];
  const agents = agentsQuery.data || [];
  const businessCreditPool = channelsQuery.data?.businessCreditPool || 0;
  const totalAllocated = channels.reduce((sum, ch) => sum + (ch.useSharedPool ? 0 : (ch.monthlyCreditLimit || 0)), 0);

  return (
    <div style={styles.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={styles.header}>
          <h1 style={styles.title}>Connections</h1>
          <p style={styles.subtitle}>
            Manage all your connected channels, unified routing settings, and monthly AI credit allocations from a single place.
          </p>
        </div>
        <div style={{ background: "var(--card)", padding: "12px 20px", borderRadius: 12, border: "1px solid var(--border)", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Business Pool</span>
          <span style={{ fontSize: 24, fontWeight: 700, color: totalAllocated > businessCreditPool ? "#ef4444" : "var(--foreground)" }}>
            {totalAllocated} / {businessCreditPool}
          </span>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>credits allocated</span>
        </div>
      </div>

      {channelsQuery.isLoading ? (
        <div>Loading connections...</div>
      ) : channels.length === 0 ? (
        <div style={styles.emptyState}>
          No channels connected yet. Go to Settings &gt; Integrations to connect your first account.
        </div>
      ) : (
        <div style={styles.grid}>
          {channels.map(channel => {
            const isWhatsapp = channel.provider === "whatsapp";
            const isInstagram = channel.provider === "instagram";
            const badgeStyle = isWhatsapp ? styles.whatsappBadge : isInstagram ? styles.instagramBadge : styles.defaultBadge;

            return (
              <div key={channel.id} style={styles.card}>
                <div style={styles.cardHeader}>
                  <span style={{ ...styles.providerBadge, ...badgeStyle }}>
                    {channel.provider}
                  </span>
                  <div style={styles.statusIndicator}>
                    <div style={{ ...styles.statusDot, ...(channel.isActive ? styles.activeDot : styles.inactiveDot) }} />
                    <span style={{ color: channel.isActive ? "#10b981" : "#ef4444" }}>
                      {channel.status}
                    </span>
                  </div>
                </div>

                <div style={styles.accountInfo}>
                  <h3 style={styles.accountName}>{channel.displayName || "Unknown Account"}</h3>
                  <p style={styles.accountHandle}>{channel.displayHandle || channel.externalAccountId}</p>
                </div>

                <div style={styles.controls}>
                  <div style={styles.controlRow}>
                    <div style={styles.controlLabel}>
                      <span style={styles.controlTitle}>Assigned Agent</span>
                      <span style={styles.controlHint}>Bot handling this channel</span>
                    </div>
                    <select
                      style={{ ...styles.input, width: "120px" }}
                      value={channel.agentId || ""}
                      onChange={(e) => handleAssignAgent(channel.id, e.target.value)}
                    >
                      <option value="">Select Agent</option>
                      {agents.map((ag) => (
                        <option key={ag.id} value={ag.id}>
                          {ag.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={styles.controlRow}>
                    <div style={styles.controlLabel}>
                      <span style={styles.controlTitle}>AI Copilot Enabled</span>
                      <span style={styles.controlHint}>Let AI draft and handle responses</span>
                    </div>
                    <div 
                      style={{ ...styles.toggle, background: channel.aiEnabled ? "var(--primary)" : "var(--border)" }}
                      onClick={() => handleToggleAi(channel.id, channel.aiEnabled)}
                    >
                      <div style={{ ...styles.toggleKnob, transform: channel.aiEnabled ? "translateX(20px)" : "translateX(0)" }} />
                    </div>
                  </div>

                  <div style={styles.controlRow}>
                    <div style={styles.controlLabel}>
                      <span style={styles.controlTitle}>Auto-reply Paused</span>
                      <span style={styles.controlHint}>Temporarily halt bot replies</span>
                    </div>
                    <div 
                      style={{ ...styles.toggle, background: channel.autoReplyPaused ? "var(--warning, #f59e0b)" : "var(--border)" }}
                      onClick={() => handleToggleAutoReply(channel.id, channel.autoReplyPaused)}
                    >
                      <div style={{ ...styles.toggleKnob, transform: channel.autoReplyPaused ? "translateX(20px)" : "translateX(0)" }} />
                    </div>
                  </div>

                  <div style={styles.controlRow}>
                    <div style={styles.controlLabel}>
                      <span style={styles.controlTitle}>Share Business Pool</span>
                      <span style={styles.controlHint}>Draw credits directly from main pool</span>
                    </div>
                    <div 
                      style={{ ...styles.toggle, background: channel.useSharedPool ? "var(--primary)" : "var(--border)" }}
                      onClick={async () => {
                        try {
                          await updateChannel.mutateAsync({ id: channel.id, useSharedPool: !channel.useSharedPool });
                          showSuccessToast(toast, { title: "Success", message: "Shared pool setting updated" });
                          channelsQuery.refetch();
                        } catch (e) {
                          showErrorToast(toast, { title: "Error", message: "Failed to update setting" });
                        }
                      }}
                    >
                      <div style={{ ...styles.toggleKnob, transform: channel.useSharedPool ? "translateX(20px)" : "translateX(0)" }} />
                    </div>
                  </div>

                  {!channel.useSharedPool && (
                    <div style={styles.controlRow}>
                      <div style={styles.controlLabel}>
                        <span style={styles.controlTitle}>Monthly AI Credit Cap</span>
                        <span style={styles.controlHint}>
                          Used: {channel.totalCreditsConsumed || 0} / {channel.monthlyCreditLimit || 0}
                        </span>
                      </div>
                      <input 
                        type="number" 
                        style={styles.input}
                        defaultValue={channel.monthlyCreditLimit || 0}
                        key={`${channel.id}-${channel.monthlyCreditLimit}`} // Force re-render if reset
                        onBlur={(e) => {
                          if (e.target.value !== String(channel.monthlyCreditLimit)) {
                            handleCreditLimitChange(channel.id, e.target.value, channel.monthlyCreditLimit || 0, totalAllocated, businessCreditPool);
                          }
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
