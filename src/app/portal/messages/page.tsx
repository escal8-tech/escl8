"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/utils/trpc";
import { usePhoneFilter } from "@/components/PhoneFilterContext";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import Link from "next/link";

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

function formatWindowRemaining(totalSeconds: number) {
  const seconds = Math.max(0, totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

function isWhatsAppThread(thread: { customerSource?: string | null; whatsappIdentityId?: string | null } | null | undefined) {
  if (!thread) return false;
  const source = String(thread.customerSource || "").toLowerCase();
  return source === "whatsapp" || Boolean(thread.whatsappIdentityId);
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatTicketStatus(status: string): string {
  const low = status.toLowerCase();
  if (low === "in_progress") return "In Progress";
  if (low === "resolved" || low === "closed") return "Resolved";
  return "Open";
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
  const { selectedPhoneNumberId } = usePhoneFilter();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [latestTicketNotice, setLatestTicketNotice] = useState<{
    id: string;
    typeKey: string;
    status: string;
    summary: string;
  } | null>(null);

  // Message pagination state
  const [allMessages, setAllMessages] = useState<Array<{
    id: string;
    direction: string;
    messageType: string | null;
    textBody: string | null;
    meta: unknown;
    createdAt: Date;
  }>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef<number>(0);

  const threadListInput = useMemo(
    () => ({
      limit: 50,
      ...(selectedPhoneNumberId ? { whatsappIdentityId: selectedPhoneNumberId } : {}),
    }),
    [selectedPhoneNumberId],
  );
  const recentThreadsQuery = trpc.messages.listRecentThreads.useQuery(threadListInput);
  const sendTextMutation = trpc.messages.sendText.useMutation();

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
    return null;
  }, [selectedThreadId, filteredThreads]);
  const selectedThread = useMemo(() => {
    if (!activeThreadId) return null;
    return filteredThreads.find((t) => t.threadId === activeThreadId) ?? null;
  }, [activeThreadId, filteredThreads]);

  const sessionWindowQuery = trpc.messages.getThreadSessionWindow.useQuery(
    { threadId: activeThreadId ?? "" },
    {
      enabled: !!activeThreadId,
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    },
  );

  const handleLiveThreadMessage = useCallback((message: {
    id: string;
    threadId?: string;
    direction: string;
    messageType: string | null;
    textBody: string | null;
    meta: unknown;
    createdAt: string | Date;
  }) => {
    if (!activeThreadId || message.threadId !== activeThreadId) return;
    setAllMessages((prev) => {
      if (prev.some((m) => m.id === message.id)) return prev;
      const next = [...prev, { ...message, createdAt: new Date(message.createdAt) }];
      next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return next;
    });
  }, [activeThreadId]);

  const handleTicketEvent = useCallback((event: {
    entity?: string;
    payload?: Record<string, unknown>;
  }) => {
    if (!activeThreadId) return;
    if ((event.entity || "").toLowerCase() !== "ticket") return;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const ticket = (payload.ticket ?? {}) as Record<string, unknown>;
    const ticketThreadId = String(ticket.threadId ?? ticket.thread_id ?? "");
    const ticketCustomerId = String(ticket.customerId ?? ticket.customer_id ?? "");
    const selectedCustomerId = String(selectedThread?.customerId ?? "");
    const matchesThread = ticketThreadId && ticketThreadId === activeThreadId;
    const matchesCustomer = ticketCustomerId && selectedCustomerId && ticketCustomerId === selectedCustomerId;
    if (!matchesThread && !matchesCustomer) return;

    const id = String(ticket.id ?? "");
    if (!id) return;
    const typeKey = String(ticket.ticketTypeKey ?? ticket.ticket_type_key ?? "untyped");
    const status = String(ticket.status ?? "open");
    const summary = String(ticket.summary ?? ticket.title ?? "").trim();
    setLatestTicketNotice({ id, typeKey, status, summary });
  }, [activeThreadId, selectedThread]);

  useLivePortalEvents({
    messagesThreadListInput: threadListInput,
    activeThreadId,
    activeThreadPageSize: 20,
    onThreadMessage: handleLiveThreadMessage,
    onEvent: handleTicketEvent,
  });

  // Initial messages query (newest messages first load)
  const messagesQuery = trpc.messages.listMessages.useQuery(
    { threadId: activeThreadId ?? "", limit: 20 },
    { enabled: !!activeThreadId },
  );

  // Load older messages query
  const olderMessagesQuery = trpc.messages.listMessages.useQuery(
    { threadId: activeThreadId ?? "", limit: 20, cursor: cursor ?? undefined },
    { enabled: !!activeThreadId && !!cursor && isLoadingMore },
  );

  // Reset messages when thread changes
  useEffect(() => {
    setAllMessages([]);
    setCursor(null);
    setHasMore(false);
    setIsLoadingMore(false);
    setLatestTicketNotice(null);
  }, [activeThreadId]);

  // Clear selected thread when phone filter changes
  useEffect(() => {
    setSelectedThreadId(null);
  }, [selectedPhoneNumberId]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Handle initial load
  useEffect(() => {
    if (messagesQuery.data && !cursor) {
      setAllMessages(messagesQuery.data.messages);
      setHasMore(messagesQuery.data.hasMore);
      setCursor(null);
      // Scroll to bottom on initial load
      setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
      }, 50);
    }
  }, [messagesQuery.data, cursor]);

  // Handle loading older messages
  useEffect(() => {
    if (olderMessagesQuery.data && isLoadingMore) {
      const container = messagesContainerRef.current;
      if (container) {
        prevScrollHeightRef.current = container.scrollHeight;
      }
      
      setAllMessages((prev) => [...olderMessagesQuery.data.messages, ...prev]);
      setHasMore(olderMessagesQuery.data.hasMore);
      setIsLoadingMore(false);
      
      // Maintain scroll position after prepending
      setTimeout(() => {
        if (container) {
          const newScrollHeight = container.scrollHeight;
          container.scrollTop = newScrollHeight - prevScrollHeightRef.current;
        }
      }, 10);
    }
  }, [olderMessagesQuery.data, isLoadingMore]);

  // Load more when scrolling near top (trigger ~3 messages before reaching oldest)
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container || isLoadingMore || !hasMore) return;

    // Trigger load when within ~200px of top (roughly 3 messages before oldest)
    if (container.scrollTop < 200 && allMessages.length > 0) {
      setIsLoadingMore(true);
      setCursor(allMessages[0].id);
    }
  }, [isLoadingMore, hasMore, allMessages]);

  const sessionWindow = useMemo(() => {
    const data = sessionWindowQuery.data;
    if (!data || data.channel !== "whatsapp" || !data.closesAt) {
      return {
        isOpen: false,
        label: "24h unavailable",
        helper: "24-hour free-form status unavailable.",
      };
    }
    const closesAtMs = new Date(data.closesAt).getTime();
    const remainingSeconds = Math.max(0, Math.floor((closesAtMs - nowMs) / 1000));
    const isOpen = remainingSeconds > 0;
    return {
      isOpen,
      label: isOpen ? "24h open" : "24h closed",
      helper: isOpen
        ? `Free-form messaging is open (${formatWindowRemaining(remainingSeconds)}).`
        : "Free-form window expired. Use a WhatsApp template to re-open the conversation.",
    };
  }, [sessionWindowQuery.data, nowMs]);

  const handleSend = useCallback(async () => {
    if (!activeThreadId) return;
    if (!isWhatsAppThread(selectedThread)) return;
    if (!sessionWindow.isOpen) return;
    const text = draft.trim();
    if (!text) return;
    setSendError(null);
    try {
      const saved = await sendTextMutation.mutateAsync({ threadId: activeThreadId, text });
      setAllMessages((prev) => [
        ...prev,
        {
          id: saved.id,
          direction: saved.direction,
          messageType: saved.messageType,
          textBody: saved.textBody,
          meta: saved.meta,
          createdAt: new Date(saved.createdAt),
        },
      ]);
      setDraft("");
      setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
      }, 20);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to send message.";
      setSendError(msg);
    }
  }, [activeThreadId, draft, sendTextMutation, selectedThread, sessionWindow.isOpen]);

  return (
    <main
      style={{
        height: "100%",
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
              minHeight: 44,
              padding: "10px 12px",
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
                boxShadow: "none",
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
              {isWhatsAppThread(selectedThread) && (
                <div
                  title={sessionWindow.helper}
                  style={{
                    fontSize: 12,
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: `1px solid ${sessionWindow.isOpen ? "rgba(16,185,129,0.45)" : "rgba(239,68,68,0.45)"}`,
                    color: sessionWindow.isOpen ? "#10b981" : "#ef4444",
                    background: sessionWindow.isOpen ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {sessionWindow.label}
                </div>
              )}
            </div>
            {latestTicketNotice ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--border)",
                  background: "rgba(201, 169, 98, 0.10)",
                }}
              >
                <div style={{ fontSize: 12, color: "var(--foreground)", minWidth: 0 }}>
                  <strong>Ticket #{shortId(latestTicketNotice.id)}</strong> created/updated for this conversation.
                  {" "}
                  {formatTicketStatus(latestTicketNotice.status)}.
                  {latestTicketNotice.summary ? ` ${latestTicketNotice.summary}` : ""}
                </div>
                <Link
                  href={`/portal/tickets?type=${encodeURIComponent(latestTicketNotice.typeKey)}`}
                  style={{
                    flexShrink: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#D4A84B",
                    textDecoration: "none",
                  }}
                >
                  Open ticket list
                </Link>
              </div>
            ) : null}

            {/* Messages area */}
            <div
              ref={messagesContainerRef}
              onScroll={handleScroll}
              style={{
                flex: 1,
                overflow: "auto",
                padding: "16px 60px",
                minHeight: 0,
                background: "linear-gradient(180deg, rgba(0,0,0,0.1) 0%, transparent 100%)",
              }}
            >
              {/* Load more indicator */}
              {(isLoadingMore || (hasMore && allMessages.length > 0)) && (
                <div style={{ textAlign: "center", padding: "12px 0", marginBottom: 8 }}>
                  {isLoadingMore ? (
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>Loading older messages…</div>
                  ) : (
                    <button
                      onClick={() => {
                        if (allMessages.length > 0) {
                          setIsLoadingMore(true);
                          setCursor(allMessages[0].id);
                        }
                      }}
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        padding: "6px 12px",
                        fontSize: 12,
                        color: "var(--muted)",
                        cursor: "pointer",
                      }}
                    >
                      Load older messages
                    </button>
                  )}
                </div>
              )}
              
              {messagesQuery.isLoading ? (
                <div style={{ color: "var(--muted)", padding: 20, fontSize: 13, textAlign: "center" }}>
                  Loading messages…
                </div>
              ) : !allMessages.length ? (
                <div style={{ color: "var(--muted)", padding: 20, fontSize: 13, textAlign: "center" }}>
                  No messages in this conversation yet.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {allMessages.map((m) => {
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

            {/* Composer */}
            <div
              style={{
                borderTop: "1px solid var(--border)",
                padding: "10px 14px",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              {isWhatsAppThread(selectedThread) ? (
                <div style={{ marginBottom: 8, fontSize: 12, color: sessionWindow.isOpen ? "#10b981" : "#ef4444" }}>
                  {sessionWindow.helper}
                </div>
              ) : (
                <div style={{ marginBottom: 8, fontSize: 12, color: "var(--muted)" }}>
                  Manual sending is currently supported only for WhatsApp threads.
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={
                    isWhatsAppThread(selectedThread) && !sessionWindow.isOpen
                      ? "24-hour window is closed"
                      : "Type a message"
                  }
                  disabled={
                    !activeThreadId ||
                    sendTextMutation.isPending ||
                    !isWhatsAppThread(selectedThread) ||
                    (isWhatsAppThread(selectedThread) && !sessionWindow.isOpen)
                  }
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "rgba(255,255,255,0.03)",
                    color: "var(--foreground)",
                    padding: "0 12px",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void handleSend()}
                  disabled={
                    !draft.trim() ||
                    sendTextMutation.isPending ||
                    !isWhatsAppThread(selectedThread) ||
                    (isWhatsAppThread(selectedThread) && !sessionWindow.isOpen)
                  }
                >
                  {sendTextMutation.isPending ? "Sending…" : "Send"}
                </button>
              </div>
              {sendError && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#ef4444" }}>
                  {sendError}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
