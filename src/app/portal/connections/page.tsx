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

  const handleCreditLimitChange = async (id: string, value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) return;
    try {
      await updateChannel.mutateAsync({ id, monthlyCreditLimit: num });
      showSuccessToast(toast, { title: "Success", message: "Credit limit updated" });
      channelsQuery.refetch();
    } catch (e) {
      showErrorToast(toast, { title: "Error", message: "Failed to update credit limit" });
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Connections</h1>
        <p style={styles.subtitle}>
          Manage all your connected channels, unified routing settings, and monthly AI credit allocations from a single place.
        </p>
      </div>

      {channelsQuery.isLoading ? (
        <div>Loading connections...</div>
      ) : channelsQuery.data?.length === 0 ? (
        <div style={styles.emptyState}>
          No channels connected yet. Go to Settings &gt; Integrations to connect your first account.
        </div>
      ) : (
        <div style={styles.grid}>
          {channelsQuery.data?.map(channel => {
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
                      <span style={styles.controlTitle}>Monthly AI Credit Cap</span>
                      <span style={styles.controlHint}>Limit AI usage per channel (0 for unlimited)</span>
                    </div>
                    <input 
                      type="number" 
                      style={styles.input}
                      defaultValue={channel.monthlyCreditLimit || 0}
                      onBlur={(e) => {
                        if (e.target.value !== String(channel.monthlyCreditLimit)) {
                          handleCreditLimitChange(channel.id, e.target.value);
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
