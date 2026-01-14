"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/utils/trpc";

function formatTimestamp(d: Date | null | undefined) {
  if (!d) return "";
  return new Date(d).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(d: Date | null | undefined) {
  if (!d) return "";
  return new Date(d).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ProfileIcon({ name, size = 40 }: { name?: string | null; size?: number }) {
  const initials = name
    ? name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "";
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)",
        border: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {initials ? (
        <span style={{ fontSize: size * 0.35, fontWeight: 600, color: "var(--muted)" }}>{initials}</span>
      ) : (
        <svg
          width={size * 0.5}
          height={size * 0.5}
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="1.5"
        >
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      )}
    </div>
  );
}

export default function MessagesPage() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const recentThreadsQuery = trpc.messages.listRecentThreads.useQuery({ limit: 50 });

  const filteredThreads = useMemo(() => {
    const threads = recentThreadsQuery.data ?? [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => {
      const name = (t.customerName ?? "").toLowerCase();
      const phone = (t.customerPhone ?? "").toLowerCase();
      const extId = (t.customerExternalId ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q) || extId.includes(q);
    });
  }, [recentThreadsQuery.data, searchQuery]);

  const activeThreadId = useMemo(() => {
    if (selectedThreadId && filteredThreads.some((t) => t.threadId === selectedThreadId)) {
      return selectedThreadId;
    }
    return null; // Don't auto-select, show empty state
  }, [selectedThreadId, filteredThreads]);

  const messagesQuery = trpc.messages.listMessages.useQuery(
    { threadId: activeThreadId ?? "", limit: 200 },
    { enabled: !!activeThreadId },
  );

  const selectedThread = useMemo(() => {
    if (!activeThreadId) return null;
    return filteredThreads.find((t) => t.threadId === activeThreadId) ?? null;
  }, [activeThreadId, filteredThreads]);

  return (
    <main
      style={{
        height: "calc(100vh - 72px - 48px)",
        minHeight: 520,
        display: "flex",
        background: "var(--background)",
      }}
    >
      {/* Left: Contact list */}
      <div
        style={{
          width: 380,
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {/* Search */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search or start new chat"
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                color: "var(--foreground)",
                outline: "none",
                fontSize: 14,
              }}
            />
          </div>
        </div>

        {/* Contact list */}
        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          {recentThreadsQuery.isLoading ? (
            <div style={{ color: "var(--muted)", padding: 20, fontSize: 13, textAlign: "center" }}>
              Loading conversations…
            </div>
          ) : !filteredThreads.length ? (
            <div style={{ color: "var(--muted)", padding: 20, fontSize: 13, textAlign: "center" }}>
              {searchQuery.trim() ? "No conversations match your search" : "No conversations yet"}
            </div>
          ) : (
            filteredThreads.map((t) => {
              const isSelected = t.threadId === activeThreadId;
              const displayName = t.customerName;
              const phone = t.customerPhone ? `+${t.customerPhone}` : t.customerExternalId;
              return (
                <div
                  key={t.threadId}
                  onClick={() => setSelectedThreadId(t.threadId)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    cursor: "pointer",
                    background: isSelected ? "rgba(255,255,255,0.05)" : "transparent",
                    borderBottom: "1px solid var(--border)",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <ProfileIcon name={t.customerName} size={48} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 500,
                          color: displayName ? "#c9a962" : "var(--foreground)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {displayName || phone}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>
                        {formatTime(t.lastMessageAt)}
                      </div>
                    </div>
                    {displayName && (
                      <div
                        style={{
                          fontSize: 13,
                          color: "var(--muted)",
                          marginTop: 2,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {phone}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right: Messages or empty state */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          background: "var(--background)",
        }}
      >
        {!activeThreadId ? (
          /* WhatsApp-like empty state */
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 40,
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 280,
                height: 200,
                marginBottom: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="200" height="180" viewBox="0 0 200 180" fill="none">
                {/* Laptop */}
                <rect x="30" y="40" width="140" height="90" rx="6" fill="#1a1a1a" stroke="var(--border)" strokeWidth="2" />
                <rect x="38" y="48" width="124" height="74" rx="2" fill="#0a0a0a" />
                {/* Laptop base */}
                <path d="M20 130 L30 130 L30 134 C30 137 33 140 36 140 L164 140 C167 140 170 137 170 134 L170 130 L180 130 L180 134 C180 142 173 150 165 150 L35 150 C27 150 20 142 20 134 Z" fill="#1a1a1a" stroke="var(--border)" strokeWidth="1.5" />
                {/* Phone */}
                <rect x="130" y="60" width="50" height="80" rx="6" fill="#1a1a1a" stroke="var(--border)" strokeWidth="2" />
                <rect x="136" y="68" width="38" height="60" rx="2" fill="#0a0a0a" />
                {/* Checkmark circle */}
                <circle cx="155" cy="98" r="16" fill="#1a472a" stroke="#25d366" strokeWidth="2" />
                <path d="M147 98 L152 103 L163 92" stroke="#25d366" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                {/* Connection dots */}
                <circle cx="100" cy="85" r="3" fill="var(--muted)" opacity="0.5" />
                <circle cx="115" cy="85" r="3" fill="var(--muted)" opacity="0.5" />
              </svg>
            </div>
            <h2
              style={{
                fontSize: 28,
                fontWeight: 300,
                color: "var(--foreground)",
                marginBottom: 12,
                letterSpacing: "-0.5px",
              }}
            >
              Escl8 Messages
            </h2>
            <p style={{ fontSize: 14, color: "var(--muted)", maxWidth: 400, lineHeight: 1.6 }}>
              View and monitor your WhatsApp conversations with customers.
              <br />
              Select a conversation to see the message history.
            </p>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 16px",
                borderBottom: "1px solid var(--border)",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <ProfileIcon name={selectedThread?.customerName} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 500,
                    color: selectedThread?.customerName ? "#c9a962" : "var(--foreground)",
                  }}
                >
                  {selectedThread?.customerName ||
                    (selectedThread?.customerPhone ? `+${selectedThread.customerPhone}` : selectedThread?.customerExternalId)}
                </div>
                {selectedThread?.customerName && selectedThread?.customerPhone && (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>
                    +{selectedThread.customerPhone}
                  </div>
                )}
              </div>
            </div>

            {/* Messages area */}
            <div
              style={{
                flex: 1,
                overflow: "auto",
                padding: "16px 60px",
                minHeight: 0,
                background: "linear-gradient(180deg, rgba(0,0,0,0.1) 0%, transparent 100%)",
              }}
            >
              {messagesQuery.isLoading ? (
                <div style={{ color: "var(--muted)", padding: 20, fontSize: 13, textAlign: "center" }}>
                  Loading messages…
                </div>
              ) : !messagesQuery.data?.length ? (
                <div style={{ color: "var(--muted)", padding: 20, fontSize: 13, textAlign: "center" }}>
                  No messages in this conversation yet.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {messagesQuery.data.map((m) => {
                    const inbound = m.direction === "inbound";
                    return (
                      <div
                        key={m.id}
                        style={{
                          display: "flex",
                          justifyContent: inbound ? "flex-start" : "flex-end",
                        }}
                      >
                        <div
                          style={{
                            maxWidth: 520,
                            padding: "8px 12px",
                            borderRadius: inbound ? "0 8px 8px 8px" : "8px 0 8px 8px",
                            background: inbound
                              ? "rgba(100, 120, 140, 0.15)"
                              : "linear-gradient(135deg, rgba(201, 169, 98, 0.25) 0%, rgba(180, 150, 80, 0.18) 100%)",
                            border: inbound ? "1px solid rgba(100, 120, 140, 0.2)" : "1px solid rgba(201, 169, 98, 0.4)",
                            position: "relative",
                          }}
                        >
                          <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.45 }}>
                            {m.textBody || "(non-text message)"}
                          </div>
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 11,
                              color: "var(--muted)",
                              textAlign: "right",
                            }}
                          >
                            {formatTimestamp(m.createdAt)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
