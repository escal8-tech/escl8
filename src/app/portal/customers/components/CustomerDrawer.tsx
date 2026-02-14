"use client";

import { useState } from "react";
import type { CustomerRow, Source } from "../types";
import { SOURCE_CONFIG } from "../types";
import { trpc } from "@/utils/trpc";
import { PortalSelect } from "@/app/portal/components/PortalSelect";

type Props = {
  customer: CustomerRow | null;
  onClose: () => void;
};

export function CustomerDrawer({ customer, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<"overview" | "requests" | "notes">(
    "overview"
  );
  const [notes, setNotes] = useState(customer?.notes ?? "");
  const [tags, setTags] = useState<string[]>(customer?.tags ?? []);
  const [newTag, setNewTag] = useState("");

  const utils = trpc.useUtils();

  const updateMutation = trpc.customers.update.useMutation({
    onSuccess: () => {
      utils.customers.list.invalidate();
    },
  });

  // Fetch requests for this customer by ID
  const { data: requests } = trpc.customers.getRequests.useQuery(
    { customerId: customer?.id ?? "" },
    { enabled: !!customer }
  );

  if (!customer) return null;

  const sourceConfig = SOURCE_CONFIG[customer.source as Source];

  const formatDate = (date: Date | null) => {
    if (!date) return "—";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  };

  const formatCurrency = (value: string | null) => {
    if (!value) return "—";
    const num = parseFloat(value);
    if (num === 0) return "—";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "MYR",
    }).format(num);
  };

  const getSentimentColor = (sentiment: string | null) => {
    switch (sentiment) {
      case "positive":
        return "#22c55e";
      case "negative":
        return "#ef4444";
      default:
        return "var(--muted)";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "resolved":
      case "completed":
        return "#22c55e";
      case "pending":
      case "needs_followup":
        return "var(--gold)";
      case "requires_assistance":
      case "failed":
        return "#ef4444";
      default:
        return "var(--muted)";
    }
  };

  const getSourceBadge = (source: string) => {
    const config = SOURCE_CONFIG[source as Source];
    if (!config) return null;
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 8px",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 500,
          background: `${config.color}20`,
          color: config.color,
        }}
      >
        {config.icon} {config.label}
      </span>
    );
  };

  const handleSaveNotes = () => {
    updateMutation.mutate({
      id: customer.id,
      notes,
      tags,
    });
  };

  const handleAddTag = () => {
    if (newTag && !tags.includes(newTag)) {
      const newTags = [...tags, newTag];
      setTags(newTags);
      setNewTag("");
      updateMutation.mutate({
        id: customer.id,
        tags: newTags,
      });
    }
  };

  const handleRemoveTag = (tag: string) => {
    const newTags = tags.filter((t) => t !== tag);
    setTags(newTags);
    updateMutation.mutate({
      id: customer.id,
      tags: newTags,
    });
  };

  const handleStatusChange = (status: string) => {
    updateMutation.mutate({
      id: customer.id,
      status,
    });
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 16px",
    border: "none",
    background: active ? "rgba(184, 134, 11, 0.2)" : "transparent",
    color: active ? "var(--gold-light)" : "var(--muted)",
    cursor: "pointer",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
  });

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.5)",
          zIndex: 999,
        }}
      />

      {/* Drawer */}
      <aside
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 500,
          maxWidth: "90vw",
          background: "var(--glass-bg)",
          backdropFilter: "blur(20px)",
          borderLeft: "1px solid var(--border)",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <header
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background:
                "linear-gradient(135deg, var(--gold), var(--gold-light))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              fontWeight: 600,
              color: "#000",
              flexShrink: 0,
            }}
          >
            {customer.name?.[0]?.toUpperCase() ?? customer.externalId.slice(-2)}
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 2 }}>
              {customer.name || "Unknown Customer"}
              {customer.isHighIntent && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 10,
                    padding: "2px 6px",
                    background: "rgba(184, 134, 11, 0.2)",
                    color: "var(--gold-light)",
                    borderRadius: 4,
                    verticalAlign: "middle",
                  }}
                >
                  HIGH INTENT
                </span>
              )}
            </h2>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>
              {customer.phone ? `+${customer.phone}` : customer.externalId}
              {customer.email && (
                <span style={{ marginLeft: 8 }}>• {customer.email}</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  padding: "2px 6px",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 500,
                  background: `${sourceConfig?.color ?? "#94A3B8"}20`,
                  color: sourceConfig?.color ?? "#94A3B8",
                }}
              >
                {sourceConfig?.icon ?? "📱"} {sourceConfig?.label ?? customer.source}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 24,
              padding: 4,
            }}
          >
            ×
          </button>
        </header>

        {/* Tabs */}
        <div
          style={{
            padding: "12px 24px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 8,
          }}
        >
          <button
            style={tabStyle(activeTab === "overview")}
            onClick={() => setActiveTab("overview")}
          >
            Overview
          </button>
          <button
            style={tabStyle(activeTab === "requests")}
            onClick={() => setActiveTab("requests")}
          >
            Requests ({customer.totalRequests})
          </button>
          <button
            style={tabStyle(activeTab === "notes")}
            onClick={() => setActiveTab("notes")}
          >
            Notes & Tags
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          {activeTab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Status Selector */}
              <div>
                <label
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--muted)",
                    display: "block",
                    marginBottom: 8,
                  }}
                >
                  Status
                </label>
                <PortalSelect
                  value={customer.status}
                  onValueChange={handleStatusChange}
                  options={[
                    { value: "active", label: "Active" },
                    { value: "vip", label: "VIP" },
                    { value: "blocked", label: "Blocked" },
                    { value: "archived", label: "Archived" },
                  ]}
                  style={{ width: "100%" }}
                  ariaLabel="Customer status"
                />
              </div>

              {/* Stats Grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                <StatCard
                  label="Total Revenue"
                  value={formatCurrency(customer.totalRevenue)}
                  color="#22c55e"
                />
                <StatCard
                  label="Total Requests"
                  value={customer.totalRequests.toString()}
                />
                <StatCard
                  label="Successful"
                  value={customer.successfulRequests.toString()}
                  color="#22c55e"
                />
                <StatCard
                  label="Lead Score"
                  value={`${customer.leadScore}/100`}
                  color={
                    customer.leadScore > 70
                      ? "#22c55e"
                      : customer.leadScore > 40
                      ? "var(--gold)"
                      : "var(--muted)"
                  }
                />
              </div>

              {/* Activity */}
              <div>
                <label
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--muted)",
                    display: "block",
                    marginBottom: 8,
                  }}
                >
                  Activity
                </label>
                <div
                  style={{
                    background: "rgba(0, 0, 0, 0.2)",
                    borderRadius: 8,
                    padding: 12,
                    fontSize: 13,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ color: "var(--muted)" }}>First message</span>
                    <span>{formatDate(customer.firstMessageAt)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--muted)" }}>Last message</span>
                    <span>{formatDate(customer.lastMessageAt)}</span>
                  </div>
                </div>
              </div>

              {/* Last Sentiment */}
              <div>
                <label
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--muted)",
                    display: "block",
                    marginBottom: 8,
                  }}
                >
                  Last Sentiment
                </label>
                <span
                  style={{
                    color: getSentimentColor(customer.lastSentiment),
                    textTransform: "capitalize",
                    fontWeight: 500,
                  }}
                >
                  {customer.lastSentiment || "Unknown"}
                </span>
              </div>
            </div>
          )}

          {activeTab === "requests" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {!requests?.length ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: 40,
                    color: "var(--muted)",
                  }}
                >
                  No requests found
                </div>
              ) : (
                requests.map((req: {
                  id: string;
                  sentiment: string;
                  status?: string | null;
                  type?: string | null;
                  source: string;
                  price: string | null;
                  paid: boolean;
                  summary: string | null;
                  createdAt: Date;
                }) => (
                  <div
                    key={req.id}
                    style={{
                      background: "rgba(0, 0, 0, 0.2)",
                      borderRadius: 8,
                      padding: 14,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: 8,
                        gap: 8,
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        {getSourceBadge(req.source)}
                        <span
                          style={{
                            fontSize: 11,
                            color: getStatusColor(req.status ?? "ongoing"),
                            textTransform: "capitalize",
                            fontWeight: 500,
                          }}
                        >
                          {(req.status ?? "ongoing").replace("_", " ")}
                        </span>
                      </div>
                      <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {formatDate(req.createdAt)}
                      </span>
                    </div>
                    {req.summary && (
                      <p
                        style={{
                          fontSize: 13,
                          color: "var(--foreground)",
                          lineHeight: 1.5,
                          marginBottom: 8,
                        }}
                      >
                        {req.summary.length > 150
                          ? req.summary.slice(0, 150) + "..."
                          : req.summary}
                      </p>
                    )}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          color: getSentimentColor(req.sentiment),
                          textTransform: "capitalize",
                        }}
                      >
                        {req.sentiment}
                      </span>
                      {req.paid && (
                        <span
                          style={{
                            fontSize: 13,
                            color: "#22c55e",
                            fontWeight: 500,
                          }}
                        >
                          {formatCurrency(req.price)}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "notes" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Tags */}
              <div>
                <label
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--muted)",
                    display: "block",
                    marginBottom: 8,
                  }}
                >
                  Tags
                </label>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        padding: "4px 10px",
                        background: "rgba(184, 134, 11, 0.2)",
                        borderRadius: 999,
                        fontSize: 12,
                        color: "var(--gold-light)",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "var(--gold-light)",
                          cursor: "pointer",
                          padding: 0,
                          fontSize: 14,
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Add a tag..."
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "var(--glass-bg)",
                      color: "var(--foreground)",
                      fontSize: 13,
                    }}
                  />
                  <button
                    onClick={handleAddTag}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 6,
                      border: "none",
                      background: "var(--gold)",
                      color: "#000",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--muted)",
                    display: "block",
                    marginBottom: 8,
                  }}
                >
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes about this customer..."
                  rows={6}
                  style={{
                    width: "100%",
                    padding: 12,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "rgba(0, 0, 0, 0.2)",
                    color: "var(--foreground)",
                    fontSize: 14,
                    resize: "vertical",
                    lineHeight: 1.6,
                  }}
                />
                <button
                  onClick={handleSaveNotes}
                  disabled={updateMutation.isPending}
                  style={{
                    marginTop: 12,
                    padding: "10px 20px",
                    borderRadius: 6,
                    border: "none",
                    background: "var(--gold)",
                    color: "#000",
                    cursor: updateMutation.isPending ? "not-allowed" : "pointer",
                    fontSize: 14,
                    fontWeight: 500,
                    opacity: updateMutation.isPending ? 0.6 : 1,
                  }}
                >
                  {updateMutation.isPending ? "Saving..." : "Save Notes"}
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: "rgba(0, 0, 0, 0.2)",
        borderRadius: 8,
        padding: 14,
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--muted)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, color: color ?? "inherit" }}>
        {value}
      </div>
    </div>
  );
}
