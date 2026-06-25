"use client";

import { useState } from "react";
import { trpc } from "@/utils/trpc";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";

import { useToast } from "@/components/ToastProvider";

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: 24,
    background: "var(--settings-page-bg)",
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

import { WhatsAppEmbeddedSignupButton } from "@/components/WhatsAppEmbeddedSignup";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ConnectionsTab(props: any) {
  const {
    email,
    whatsappConnected,
    openWebsiteWidgetModal,
    websiteWidget,
  } = props;
  const toast = useToast();
  const channelsQuery = trpc.channels.listChannels.useQuery();
  const agentsQuery = trpc.agents.listAgents.useQuery();
  const updateChannel = trpc.channels.updateChannel.useMutation();
  const [showAddModal, setShowAddModal] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editingChannel, setEditingChannel] = useState<any>(null);

  const handleToggleAi = async (id: string, current: boolean) => {
    try {
      await updateChannel.mutateAsync({ id, aiEnabled: !current });
      showSuccessToast(toast, { title: "Success", message: "AI status updated" });
      channelsQuery.refetch();
    } catch {
      showErrorToast(toast, { title: "Error", message: "Failed to update AI status" });
    }
  };

  const handleToggleAutoReply = async (id: string, current: boolean) => {
    try {
      await updateChannel.mutateAsync({ id, autoReplyPaused: !current });
      showSuccessToast(toast, { title: "Success", message: "Auto-reply status updated" });
      channelsQuery.refetch();
    } catch {
      showErrorToast(toast, { title: "Error", message: "Failed to update auto-reply status" });
    }
  };

  const handleAssignAgent = async (id: string, agentId: string) => {
    try {
      await updateChannel.mutateAsync({ id, agentId });
      showSuccessToast(toast, { title: "Success", message: "Agent assigned" });
      channelsQuery.refetch();
    } catch {
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
    } catch {
      showErrorToast(toast, { title: "Error", message: "Failed to update credit limit" });
    }
  };

  const channels = channelsQuery.data?.channels || [];
  const agents = agentsQuery.data || [];
  const businessCreditPool = channelsQuery.data?.businessCreditPool || 0;
  const totalAllocated = channels.reduce((sum, ch) => sum + (ch.useSharedPool ? 0 : (ch.monthlyCreditLimit || 0)), 0);

  const integrationCards = [
    {
      key: "whatsapp",
      title: "WhatsApp",
      description: "Connect WhatsApp Business so the bot can receive and reply in the main staff workflow.",
      accent: "linear-gradient(135deg, #22c55e, #128c7e)",
      connected: whatsappConnected,
    },
    {
      key: "website",
      title: "Website Widget",
      description: "Generate the one-line widget snippet for your site or Wix custom code block.",
      accent: "linear-gradient(135deg, #2563eb, #0ea5e9)",
      connected: Boolean(websiteWidget?.key),
    },
    {
      key: "telegram",
      title: "Telegram",
      description: "Telegram inbox syncing will be added here next.",
      accent: "linear-gradient(135deg, #229ed9, #38bdf8)",
      connected: false,
    },
    {
      key: "shopee",
      title: "Shopee",
      description: "Shopee order and catalog syncing will land here when ready.",
      accent: "linear-gradient(135deg, #f97316, #fb923c)",
      connected: false,
    },
    {
      key: "lazada",
      title: "Lazada",
      description: "Lazada order syncing will be managed from the same integrations area.",
      accent: "linear-gradient(135deg, #7c3aed, #a855f7)",
      connected: false,
    },
    {
      key: "tiktok",
      title: "TikTok Shop",
      description: "TikTok Shop operations will be plugged in here later.",
      accent: "linear-gradient(135deg, #111827, #ec4899)",
      connected: false,
    },
    {
      key: "instagram",
      title: "Instagram",
      description: "Instagram messaging support will appear here once available.",
      accent: "linear-gradient(135deg, #f97316, #ec4899)",
      connected: false,
    },
  ] as const;


  return (
    <div style={styles.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, flexWrap: "wrap" }}>
        <div style={styles.header}>
          <h1 style={styles.title}>Connections</h1>
          <p style={styles.subtitle}>
            Manage all your connected channels, unified routing settings, and monthly AI credit allocations.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginLeft: "auto", flexWrap: "wrap" }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#d8b45a", whiteSpace: "nowrap" }}>{businessCreditPool} credits</span>
          <button
            onClick={() => setShowAddModal(true)}
            style={{
              height: 42,
              padding: "0 20px",
              background: "#1656d8",
              color: "white",
              border: "none",
              borderRadius: 10,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Add New Connection
          </button>
        </div>
      </div>

      {channelsQuery.isLoading ? (
        <div>Loading connections...</div>
      ) : channels.length === 0 ? (
        <div style={{ ...styles.emptyState, background: "#1c2839", border: "1px dashed rgba(148, 163, 184, 0.18)", color: "#94a3b8" }}>
          No channels connected yet. Click &quot;Add New Connection&quot; to connect your first account.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, background: "#1c2839", border: "1px solid rgba(148, 163, 184, 0.14)", borderRadius: 16, padding: 16, boxShadow: "0 12px 28px rgba(2,6,23,0.16)" }}>
          {channels.map(channel => {
            const isWhatsapp = channel.provider === "whatsapp";
            const isInstagram = channel.provider === "instagram";
            const badgeStyle = isWhatsapp ? styles.whatsappBadge : isInstagram ? styles.instagramBadge : styles.defaultBadge;
            const assignedAgent = agents.find(a => a.id === channel.agentId);

            return (
              <div key={channel.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#20324a", border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: 12, padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                  <span style={{ ...styles.providerBadge, ...badgeStyle, width: 90, textAlign: "center" }}>
                    {channel.provider}
                  </span>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 4px 0", color: "var(--foreground)" }}>{channel.displayName || "Unknown Account"}</h3>
                    <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>{channel.displayHandle || channel.externalAccountId}</p>
                  </div>
                </div>
                
                <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 500 }}>Agent</span>
                    <span style={{ fontSize: 14, color: "#f8fafc", fontWeight: 500 }}>{assignedAgent?.name || "None"}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 500 }}>Status</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: channel.isActive ? "#10b981" : "#ef4444" }} />
                      <span style={{ fontSize: 14, color: channel.isActive ? "#10b981" : "#ef4444", fontWeight: 500 }}>{channel.status}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setEditingChannel(channel)}
                    style={{
                      padding: "8px 16px",
                      background: "transparent",
                      color: "#f8fafc",
                      border: "1px solid rgba(148, 163, 184, 0.16)",
                      borderRadius: 10,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Connection Modal */}
      {showAddModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--background)", borderRadius: 16, border: "1px solid var(--border)", width: "100%", maxWidth: 800, maxHeight: "90vh", overflowY: "auto", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: 24, borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "var(--background)", zIndex: 10 }}>
              <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Add New Connection</h2>
              <button onClick={() => setShowAddModal(false)} style={{ background: "transparent", border: "none", fontSize: 24, color: "var(--muted)", cursor: "pointer" }}>&times;</button>
            </div>
            <div style={{ padding: 24 }}>
              <div style={styles.grid}>
                {integrationCards.map(card => (
                  <div key={card.key} style={{ ...styles.card, padding: 20 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                      <div style={{ width: 48, height: 48, borderRadius: 12, background: card.accent, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: "bold", fontSize: 20, flexShrink: 0 }}>
                        {card.title.charAt(0)}
                      </div>
                      <div style={{ flex: 1 }}>
                        <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 4px 0", color: "var(--foreground)" }}>{card.title}</h3>
                        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>{card.description}</p>
                      </div>
                    </div>
                    <div style={{ marginTop: "auto", paddingTop: 16, display: "flex", justifyContent: "flex-end" }}>
                      {card.key === "whatsapp" ? (
                        <WhatsAppEmbeddedSignupButton
                          email={email}
                          onConnected={() => {
                            toast.show({ type: "success", title: "Connected", message: "WhatsApp connected" });
                            channelsQuery.refetch();
                            setShowAddModal(false);
                          }}
                        />
                      ) : card.key === "website" ? (
                        <button
                          type="button"
                          style={{
                            padding: "8px 16px",
                            borderRadius: 8,
                            background: "transparent",
                            color: "var(--foreground)",
                            border: "1px solid var(--border)",
                            fontWeight: 500,
                            cursor: "pointer",
                          }}
                          onClick={() => {
                            setShowAddModal(false);
                            void openWebsiteWidgetModal();
                          }}
                        >
                          Generate Snippet
                        </button>
                      ) : (
                        <button type="button" style={{ padding: "8px 16px", borderRadius: 8, background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", fontWeight: 500 }} disabled>
                          Coming Soon
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Connection Modal */}
      {editingChannel && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--card)", borderRadius: 16, border: "1px solid var(--border)", width: "100%", maxWidth: 500, padding: 32 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px 0" }}>Edit Connection</h2>
                <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>{editingChannel.displayName}</p>
              </div>
              <button onClick={() => setEditingChannel(null)} style={{ background: "transparent", border: "none", fontSize: 24, color: "var(--muted)", cursor: "pointer" }}>&times;</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <label style={{ fontSize: 14, fontWeight: 500, color: "var(--foreground)" }}>Assigned Agent</label>
                <select
                  style={{ ...styles.input, width: "100%", textAlign: "left" }}
                  value={editingChannel.agentId || ""}
                  onChange={async (e) => {
                    await handleAssignAgent(editingChannel.id, e.target.value);
                    setEditingChannel({ ...editingChannel, agentId: e.target.value });
                  }}
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
                  style={{ ...styles.toggle, background: editingChannel.aiEnabled ? "var(--primary)" : "var(--border)" }}
                  onClick={async () => {
                    await handleToggleAi(editingChannel.id, editingChannel.aiEnabled);
                    setEditingChannel({ ...editingChannel, aiEnabled: !editingChannel.aiEnabled });
                  }}
                >
                  <div style={{ ...styles.toggleKnob, transform: editingChannel.aiEnabled ? "translateX(20px)" : "translateX(0)" }} />
                </div>
              </div>

              <div style={styles.controlRow}>
                <div style={styles.controlLabel}>
                  <span style={styles.controlTitle}>Auto-reply Paused</span>
                  <span style={styles.controlHint}>Temporarily halt bot replies</span>
                </div>
                <div 
                  style={{ ...styles.toggle, background: editingChannel.autoReplyPaused ? "var(--warning, #f59e0b)" : "var(--border)" }}
                  onClick={async () => {
                    await handleToggleAutoReply(editingChannel.id, editingChannel.autoReplyPaused);
                    setEditingChannel({ ...editingChannel, autoReplyPaused: !editingChannel.autoReplyPaused });
                  }}
                >
                  <div style={{ ...styles.toggleKnob, transform: editingChannel.autoReplyPaused ? "translateX(20px)" : "translateX(0)" }} />
                </div>
              </div>

              <div style={styles.controlRow}>
                <div style={styles.controlLabel}>
                  <span style={styles.controlTitle}>Share Business Pool</span>
                  <span style={styles.controlHint}>Draw credits directly from main pool</span>
                </div>
                <div 
                  style={{ ...styles.toggle, background: editingChannel.useSharedPool ? "var(--primary)" : "var(--border)" }}
                  onClick={async () => {
                    try {
                      await updateChannel.mutateAsync({ id: editingChannel.id, useSharedPool: !editingChannel.useSharedPool });
                      showSuccessToast(toast, { title: "Success", message: "Shared pool setting updated" });
                      setEditingChannel({ ...editingChannel, useSharedPool: !editingChannel.useSharedPool });
                      channelsQuery.refetch();
                    } catch {
                      showErrorToast(toast, { title: "Error", message: "Failed to update setting" });
                    }
                  }}
                >
                  <div style={{ ...styles.toggleKnob, transform: editingChannel.useSharedPool ? "translateX(20px)" : "translateX(0)" }} />
                </div>
              </div>

              {!editingChannel.useSharedPool && (
                <div style={styles.controlRow}>
                  <div style={styles.controlLabel}>
                    <span style={styles.controlTitle}>Monthly AI Credit Cap</span>
                  </div>
                  <input 
                    type="number" 
                    style={styles.input}
                    defaultValue={editingChannel.monthlyCreditLimit || 0}
                    onBlur={(e) => {
                      if (e.target.value !== String(editingChannel.monthlyCreditLimit)) {
                        handleCreditLimitChange(editingChannel.id, e.target.value, editingChannel.monthlyCreditLimit || 0, totalAllocated, businessCreditPool);
                      }
                    }}
                  />
                </div>
              )}
            </div>
            
            <div style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setEditingChannel(null)}
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
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
