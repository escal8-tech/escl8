"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/utils/trpc";
import { usePhoneFilter } from "@/components/PhoneFilterContext";
import { useToast } from "@/components/ToastProvider";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { useIsMobileViewport } from "@/app/portal/hooks/useIsMobileViewport";
import { readMediaInfo } from "@/app/portal/messages/mediaInfo";
import { fetchWithFirebaseAuth } from "@/lib/client-auth-ops";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

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

type ComposerAttachment = {
  id: string;
  file: File;
  previewUrl: string | null;
  mediaType: "image" | "document";
};

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
  const isMobile = useIsMobileViewport();
  const toast = useToast();
  const utils = trpc.useUtils();
  const { selectedPhoneNumberId } = usePhoneFilter();
  const searchParams = useSearchParams();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "thread" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
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
  const [threadItems, setThreadItems] = useState<Array<{
    threadId: string;
    customerId: string;
    customerName: string | null;
    customerExternalId: string | null;
    customerPhone: string | null;
    customerSource: string | null;
    status: string | null;
    lastMessageAt: Date | null;
    threadCreatedAt: Date;
    whatsappIdentityId: string | null;
    sortAt: Date;
  }>>([]);
  const [threadCursor, setThreadCursor] = useState<{ threadId: string; sortAt: string } | null>(null);
  const [threadHasMore, setThreadHasMore] = useState(false);
  const [isLoadingMoreThreads, setIsLoadingMoreThreads] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef<number>(0);

  const threadListInput = useMemo(
    () => ({
      limit: 50,
      ...(selectedPhoneNumberId ? { whatsappIdentityId: selectedPhoneNumberId } : {}),
    }),
    [selectedPhoneNumberId],
  );
  const threadPageInput = useMemo(
    () => ({
      limit: 50,
      ...(selectedPhoneNumberId ? { whatsappIdentityId: selectedPhoneNumberId } : {}),
      ...(deferredSearchQuery.trim() ? { query: deferredSearchQuery.trim() } : {}),
      ...(threadCursor ? { cursorThreadId: threadCursor.threadId, cursorSortAt: threadCursor.sortAt } : {}),
    }),
    [selectedPhoneNumberId, deferredSearchQuery, threadCursor],
  );
  const threadPageQuery = trpc.messages.listRecentThreadsPage.useQuery(threadPageInput);
  const createEscalatedOrderTicket = trpc.tickets.createTicket.useMutation();
  const sendTextMutation = trpc.messages.sendText.useMutation();
  const sendMediaMutation = trpc.messages.sendMedia.useMutation();
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);

  useEffect(() => {
    setThreadItems([]);
    setThreadCursor(null);
    setThreadHasMore(false);
    setIsLoadingMoreThreads(false);
  }, [selectedPhoneNumberId, deferredSearchQuery]);

  useEffect(() => {
    const data = threadPageQuery.data;
    if (!data) return;
    setThreadItems((prev) => {
      const incoming = data.items.map((item) => ({
        ...item,
        lastMessageAt: item.lastMessageAt ? new Date(item.lastMessageAt) : null,
        threadCreatedAt: new Date(item.threadCreatedAt),
        sortAt: new Date(item.sortAt),
      }));
      if (!prev.length || !threadCursor) return incoming;
      const merged = [...prev];
      for (const item of incoming) {
        const index = merged.findIndex((existing) => existing.threadId === item.threadId);
        if (index >= 0) merged[index] = item;
        else merged.push(item);
      }
      merged.sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime() || b.threadId.localeCompare(a.threadId));
      return merged;
    });
    setThreadHasMore(Boolean(data.hasMore));
    setIsLoadingMoreThreads(false);
  }, [threadPageQuery.data, threadCursor]);

  const filteredThreads = threadItems;

  const deepLinkThreadId = useMemo(() => {
    if (!filteredThreads.length) return null;
    const requestedThreadId = String(searchParams?.get("threadId") || "").trim();
    const requestedCustomerId = String(searchParams?.get("customerId") || "").trim();
    const requestedPhone = String(searchParams?.get("phone") || "").replace(/[^\d]/g, "");
    const match = filteredThreads.find((thread) => {
      if (requestedThreadId && thread.threadId === requestedThreadId) return true;
      if (requestedCustomerId && String(thread.customerId || "") === requestedCustomerId) return true;
      if (requestedPhone) {
        const threadPhone = String(thread.customerPhone || "").replace(/[^\d]/g, "");
        return threadPhone === requestedPhone;
      }
      return false;
    });
    return match?.threadId ?? null;
  }, [filteredThreads, searchParams]);

  const activeThreadId = useMemo(() => {
    const requestedThreadId = String(searchParams?.get("threadId") || "").trim();
    if (requestedThreadId) return requestedThreadId;
    if (deepLinkThreadId && filteredThreads.some((t) => t.threadId === deepLinkThreadId)) {
      return deepLinkThreadId;
    }
    if (selectedThreadId && filteredThreads.some((t) => t.threadId === selectedThreadId)) {
      return selectedThreadId;
    }
    return null;
  }, [selectedThreadId, deepLinkThreadId, filteredThreads, searchParams]);
  const selectedThread = useMemo(() => {
    if (!activeThreadId) return null;
    return filteredThreads.find((t) => t.threadId === activeThreadId) ?? null;
  }, [activeThreadId, filteredThreads]);
  const showThreadPanel = !isMobile || (mobileView === "thread" && Boolean(activeThreadId)) || (mobileView === null && Boolean(deepLinkThreadId));
  const showThreadList = !isMobile || !showThreadPanel;

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

  const resetActiveThreadState = useCallback(() => {
    setAllMessages([]);
    setCursor(null);
    setHasMore(false);
    setIsLoadingMore(false);
    setLatestTicketNotice(null);
  }, []);

  // Initial messages query (newest messages first load)
  const messagesQuery = trpc.messages.listMessages.useQuery(
    { threadId: activeThreadId ?? "", limit: 20 },
    {
      enabled: !!activeThreadId,
    },
  );

  // Load older messages query
  const olderMessagesQuery = trpc.messages.listMessages.useQuery(
    { threadId: activeThreadId ?? "", limit: 20, cursor: cursor ?? undefined },
    {
      enabled: !!activeThreadId && !!cursor && isLoadingMore,
    },
  );

  useEffect(() => {
    const data = messagesQuery.data;
    if (!data || cursor) return;
    queueMicrotask(() => {
      setAllMessages(data.messages);
      setHasMore(data.hasMore);
      setCursor(null);
      setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
      }, 50);
    });
  }, [messagesQuery.data, cursor]);

  useEffect(() => {
    const data = olderMessagesQuery.data;
    if (!isLoadingMore || !data) return;
    const container = messagesContainerRef.current;
    if (container) {
      prevScrollHeightRef.current = container.scrollHeight;
    }
    queueMicrotask(() => {
      setAllMessages((prev) => [...data.messages, ...prev]);
      setHasMore(data.hasMore);
      setIsLoadingMore(false);
      setTimeout(() => {
        if (container) {
          const newScrollHeight = container.scrollHeight;
          container.scrollTop = newScrollHeight - prevScrollHeightRef.current;
        }
      }, 10);
    });
  }, [olderMessagesQuery.data, isLoadingMore]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);


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

  const handleSelectThread = useCallback((threadId: string) => {
    resetActiveThreadState();
    setSelectedThreadId(threadId);
    setMobileView("thread");
  }, [resetActiveThreadState]);

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

  const handleEscalateOrder = useCallback(async () => {
    if (!activeThreadId || !selectedThread) {
      showErrorToast(toast, {
        title: "No thread selected",
        message: "Select a customer conversation before escalating an order.",
      });
      return;
    }
    const customerPhone = String(selectedThread.customerPhone || selectedThread.customerExternalId || "").trim();
    const displayCustomer = String(selectedThread.customerName || customerPhone || "Customer").trim();
    try {
      const ticket = await createEscalatedOrderTicket.mutateAsync({
        ticketTypeKey: "ordercreation",
        title: `Escalated order - ${displayCustomer}`,
        summary: "Manual order escalated from the messages inbox. Staff should fill the order details before approval.",
        priority: "urgent",
        source: "staff_escalation",
        customerId: selectedThread.customerId,
        threadId: activeThreadId,
        whatsappIdentityId: selectedThread.whatsappIdentityId || undefined,
        customerName: selectedThread.customerName || undefined,
        customerPhone: customerPhone || undefined,
        fields: {
          escalated_order: true,
          staff_created: true,
          source: "messages",
          name: displayCustomer,
          customer_name: displayCustomer,
          ...(customerPhone ? { phone: customerPhone, customer_phone: customerPhone } : {}),
          items: [],
          quantity: [],
          line_items: [],
          internal_notes: "Created from Messages using Escalate Order. Fill the order items before approval.",
        },
        notes: "Created from Messages using Escalate Order. Fill the order items before approval.",
        createdBy: "user",
      });
      await Promise.all([
        utils.tickets.listTickets.invalidate(),
        utils.tickets.listTicketLedger.invalidate(),
        utils.tickets.getTicketById.invalidate(),
        utils.tickets.getPerformance.invalidate(),
      ]);
      setLatestTicketNotice({
        id: ticket.id,
        typeKey: "ordercreation",
        status: ticket.status || "open",
        summary: ticket.summary || ticket.title || "",
      });
      showSuccessToast(toast, {
        title: "Order escalated",
        message: "A new order ticket was created in the Orders tab for this customer.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Could not escalate order",
        message: error instanceof Error ? error.message : "Order escalation failed.",
      });
    }
  }, [activeThreadId, createEscalatedOrderTicket, selectedThread, toast, utils]);

  const handleSend = useCallback(async () => {
    if (!activeThreadId) return;
    if (!isWhatsAppThread(selectedThread)) return;
    if (!sessionWindow.isOpen) return;
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    setSendError(null);
    try {
      let savedMessages:
        Array<{
          id: string;
          direction: string;
          messageType: string | null;
          textBody: string | null;
          meta: unknown;
          createdAt: Date | string;
        }> = [];

      if (attachments.length === 0) {
        const saved = await sendTextMutation.mutateAsync({ threadId: activeThreadId, text });
        savedMessages = [saved];
      } else {
        const uploadedParts: Array<
          | { type: "text"; text: string }
          | { type: "image"; imageUrl: string; caption?: string }
          | { type: "document"; documentUrl: string; filename?: string; caption?: string }
        > = [];

        if (attachments.length > 1 && text) {
          uploadedParts.push({ type: "text", text });
        }

        for (let index = 0; index < attachments.length; index += 1) {
          const attachment = attachments[index];
          const form = new FormData();
          form.append("phoneNumberId", String(selectedThread?.whatsappIdentityId || ""));
          form.append("file", attachment.file);
          const uploadResponse = await fetchWithFirebaseAuth(
            "/api/messages/media",
            { method: "POST", body: form },
            {
              action: "messages-upload-media",
              area: "message",
              missingSessionEvent: "messages.upload_session_missing",
              requestFailureEvent: "messages.upload_failed",
              tokenFailureEvent: "messages.upload_failed",
            },
          );
          const uploadJson = await uploadResponse.json().catch(() => ({}));
          if (!uploadResponse.ok || !uploadJson?.success) {
            throw new Error(String(uploadJson?.error || "Failed to upload media."));
          }

          const caption = attachments.length === 1 && text ? text : undefined;
          if (attachment.mediaType === "image") {
            uploadedParts.push({
              type: "image",
              imageUrl: String(uploadJson.mediaUrl || ""),
              ...(caption ? { caption } : {}),
            });
          } else {
            uploadedParts.push({
              type: "document",
              documentUrl: String(uploadJson.mediaUrl || ""),
              filename: String(uploadJson.fileName || attachment.file.name || "").trim() || undefined,
              ...(caption ? { caption } : {}),
            });
          }
        }

        savedMessages = await sendMediaMutation.mutateAsync({
          threadId: activeThreadId,
          messages: uploadedParts,
        });
      }

      setAllMessages((prev) => [
        ...prev,
        ...savedMessages.map((saved) => ({
          id: saved.id,
          direction: saved.direction,
          messageType: saved.messageType,
          textBody: saved.textBody,
          meta: saved.meta,
          createdAt: new Date(saved.createdAt),
        })),
      ]);
      setDraft("");
      setAttachments((prev) => {
        prev.forEach((attachment) => {
          if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
        });
        return [];
      });
      setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
      }, 20);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to send message.";
      setSendError(msg);
    }
  }, [activeThreadId, attachments, draft, selectedThread, sendMediaMutation, sendTextMutation, sessionWindow.isOpen]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
    };
  }, []);

  const handleAttachmentPick = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    const nextItems: ComposerAttachment[] = [];
    Array.from(files).forEach((file) => {
      const mime = String(file.type || "").toLowerCase();
      const mediaType = mime.startsWith("image/") ? "image" : "document";
      nextItems.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: mediaType === "image" ? URL.createObjectURL(file) : null,
        mediaType,
      });
    });
    setAttachments((prev) => [...prev, ...nextItems]);
  }, []);

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((prev) => {
      const match = prev.find((item) => item.id === attachmentId);
      if (match?.previewUrl) URL.revokeObjectURL(match.previewUrl);
      return prev.filter((item) => item.id !== attachmentId);
    });
  }, []);

  return (
    <main
      style={{
        height: "100%",
        minHeight: isMobile ? 0 : 520,
        display: isMobile ? "block" : "flex",
        background: "var(--background)",
      }}
    >
      {/* Left: Contact list */}
      <div
        style={{
          width: isMobile ? "100%" : 380,
          borderRight: isMobile ? "none" : "1px solid var(--border)",
          display: showThreadList ? "flex" : "none",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {/* Search */}
        <div style={{ padding: isMobile ? "12px" : "12px 16px", borderBottom: "1px solid var(--border)" }}>
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
              placeholder={isMobile ? "Search conversations" : "Search or start new chat"}
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
          {threadPageQuery.isLoading && !threadItems.length ? (
            <div style={{ color: "var(--muted)", padding: 20, fontSize: 13, textAlign: "center" }}>
              Loading conversations…
            </div>
          ) : !filteredThreads.length ? (
            <div style={{ color: "var(--muted)", padding: 20, fontSize: 13, textAlign: "center" }}>
              {searchQuery.trim() ? "No conversations match your search" : "No conversations yet"}
            </div>
          ) : (
            <>
            {filteredThreads.map((t) => {
              const isSelected = t.threadId === activeThreadId;
              const displayName = t.customerName;
              const phone = t.customerPhone ? `+${t.customerPhone}` : t.customerExternalId;
              return (
                <div
                  key={t.threadId}
                  onClick={() => handleSelectThread(t.threadId)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: isMobile ? "12px" : "12px 16px",
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
                          fontSize: isMobile ? 14 : 15,
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
            })}
            {threadHasMore ? (
              <div style={{ padding: isMobile ? "12px" : "12px 16px", display: "flex", justifyContent: "center" }}>
                <button
                  type="button"
                  onClick={() => {
                    if (isLoadingMoreThreads || !threadHasMore || !threadItems.length) return;
                    const lastThread = threadItems[threadItems.length - 1];
                    setIsLoadingMoreThreads(true);
                    setThreadCursor({
                      threadId: lastThread.threadId,
                      sortAt: lastThread.sortAt.toISOString(),
                    });
                  }}
                  disabled={isLoadingMoreThreads}
                  style={{
                    minWidth: 148,
                    height: 36,
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "rgba(255,255,255,0.03)",
                    color: "var(--foreground)",
                    fontSize: 13,
                    cursor: isLoadingMoreThreads ? "not-allowed" : "pointer",
                    opacity: isLoadingMoreThreads ? 0.6 : 1,
                  }}
                >
                  {isLoadingMoreThreads ? "Loading…" : "Load More"}
                </button>
              </div>
            ) : null}
            </>
          )}
        </div>
      </div>

      {/* Right: Messages or empty state */}
      <div
        style={{
          flex: 1,
          display: showThreadPanel ? "flex" : "none",
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
                padding: isMobile ? "12px" : "10px 16px",
                borderBottom: "1px solid var(--border)",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              {isMobile ? (
                <button
                  type="button"
                  onClick={() => setMobileView("list")}
                  aria-label="Back to conversations"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "rgba(255,255,255,0.03)",
                    color: "var(--foreground)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    cursor: "pointer",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </button>
              ) : null}
              <ProfileIcon name={selectedThread?.customerName} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: isMobile ? 14 : 15,
                    fontWeight: 500,
                    color: selectedThread?.customerName ? "#c9a962" : "var(--foreground)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
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
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void handleEscalateOrder()}
                  disabled={createEscalatedOrderTicket.isPending}
                  style={{
                    flexShrink: 0,
                    minHeight: 34,
                    whiteSpace: "nowrap",
                  }}
                >
                  {createEscalatedOrderTicket.isPending ? "Escalating..." : "Escalate Order"}
                </button>
              )}
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
                  alignItems: isMobile ? "flex-start" : "center",
                  justifyContent: "space-between",
                  flexDirection: isMobile ? "column" : "row",
                  gap: 12,
                  padding: isMobile ? "10px 12px" : "10px 16px",
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
                  href={
                    latestTicketNotice.typeKey === "ordercreation"
                      ? "/orders"
                      : `/ticket?type=${encodeURIComponent(latestTicketNotice.typeKey)}`
                  }
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
                padding: isMobile ? "12px" : "16px 60px",
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
                        {(() => {
                          const media = readMediaInfo(m);
                          const isImageMessage = media.messageType === "image" && Boolean(media.imageUrl);
                          const isDocumentMessage = media.messageType === "document" && Boolean(media.documentUrl);
                          const isMediaMessage = isImageMessage || isDocumentMessage;
                          const documentBadge = media.filename?.includes(".")
                            ? String(media.filename.split(".").pop() || "DOC").slice(0, 5).toUpperCase()
                            : "DOC";
                          const timestamp = formatTime(m.createdAt);
                          const captionText = media.caption && media.caption !== "[image]"
                            ? media.caption
                            : isDocumentMessage
                              ? media.filename || ""
                              : "";
                          const bubbleBackground = inbound
                            ? "rgba(255,255,255,0.06)"
                            : "linear-gradient(180deg, rgba(214, 248, 197, 0.92) 0%, rgba(190, 235, 172, 0.92) 100%)";
                          const bubbleColor = inbound ? "rgba(255,255,255,0.96)" : "#102114";
                          if (isMediaMessage) {
                            return (
                              <div
                                style={{
                                  maxWidth: isMobile ? "84%" : 360,
                                  padding: 4,
                                  borderRadius: 10,
                                  background: bubbleBackground,
                                  border: inbound ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(155, 193, 141, 0.55)",
                                  boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
                                }}
                              >
                                {isImageMessage ? (
                                  <a
                                    href={media.imageUrl!}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{
                                      display: "block",
                                      textDecoration: "none",
                                      color: "inherit",
                                    }}
                                  >
                                    <img
                                      src={media.imageUrl!}
                                      alt={captionText || "Image"}
                                      style={{
                                        display: "block",
                                        width: "100%",
                                        maxHeight: isMobile ? 320 : 360,
                                        objectFit: "cover",
                                        borderRadius: 8,
                                        background: "rgba(0,0,0,0.12)",
                                      }}
                                    />
                                  </a>
                                ) : (
                                  <a
                                    href={media.documentUrl!}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 12,
                                      textDecoration: "none",
                                      color: bubbleColor,
                                      padding: "10px 12px",
                                      borderRadius: 8,
                                      background: inbound ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.32)",
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: 40,
                                        height: 40,
                                        borderRadius: 8,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: 12,
                                        fontWeight: 700,
                                        letterSpacing: 0.4,
                                        background: inbound ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.72)",
                                        border: "1px solid rgba(0,0,0,0.08)",
                                        flexShrink: 0,
                                      }}
                                    >
                                      {documentBadge}
                                    </div>
                                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                                      <div
                                        style={{
                                          fontSize: 14,
                                          lineHeight: 1.35,
                                          fontWeight: 500,
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        {media.filename || "Document"}
                                      </div>
                                      <div
                                        style={{
                                          fontSize: 11,
                                          opacity: 0.72,
                                          letterSpacing: 0.2,
                                        }}
                                      >
                                        Tap to open
                                      </div>
                                    </div>
                                  </a>
                                )}

                                {captionText ? (
                                  <div
                                    style={{
                                      padding: isImageMessage ? "8px 10px 6px" : "8px 10px 4px",
                                      color: bubbleColor,
                                    }}
                                  >
                                    <div
                                      style={{
                                        whiteSpace: "pre-wrap",
                                        fontSize: 14,
                                        lineHeight: 1.4,
                                        wordBreak: "break-word",
                                      }}
                                    >
                                      {captionText}
                                    </div>
                                    <div
                                      style={{
                                        marginTop: 4,
                                        fontSize: 11,
                                        opacity: 0.62,
                                        textAlign: "right",
                                      }}
                                    >
                                      {timestamp}
                                    </div>
                                  </div>
                                ) : (
                                  <div
                                    style={{
                                      padding: "0 10px 6px",
                                      fontSize: 11,
                                      color: bubbleColor,
                                      opacity: 0.62,
                                      textAlign: "right",
                                    }}
                                  >
                                    {timestamp}
                                  </div>
                                )}
                              </div>
                            );
                          }

                          return (
                            <div
                              style={{
                                maxWidth: isMobile ? "86%" : 520,
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
                          );
                        })()}
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
                padding: isMobile ? "10px 12px 14px" : "10px 14px",
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
              {attachments.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    overflowX: "auto",
                    paddingBottom: 8,
                    marginBottom: 8,
                  }}
                >
                  {attachments.map((attachment) => {
                    const isImage = attachment.mediaType === "image";
                    const extension = attachment.file.name.includes(".")
                      ? String(attachment.file.name.split(".").pop() || "DOC").slice(0, 5).toUpperCase()
                      : "DOC";
                    return (
                      <div
                        key={attachment.id}
                        style={{
                          width: isImage ? 110 : 180,
                          minWidth: isImage ? 110 : 180,
                          borderRadius: 12,
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: "rgba(255,255,255,0.04)",
                          padding: 8,
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                          position: "relative",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => removeAttachment(attachment.id)}
                          style={{
                            position: "absolute",
                            top: 6,
                            right: 6,
                            width: 22,
                            height: 22,
                            borderRadius: 999,
                            border: "1px solid rgba(255,255,255,0.18)",
                            background: "rgba(15,23,42,0.75)",
                            color: "#fff",
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          ×
                        </button>
                        {isImage && attachment.previewUrl ? (
                          <img
                            src={attachment.previewUrl}
                            alt={attachment.file.name}
                            style={{
                              width: "100%",
                              height: 110,
                              objectFit: "cover",
                              borderRadius: 10,
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              height: 72,
                              borderRadius: 10,
                              background: "rgba(255,255,255,0.06)",
                              border: "1px solid rgba(255,255,255,0.08)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 18,
                              fontWeight: 700,
                              color: "var(--foreground)",
                            }}
                          >
                            {extension}
                          </div>
                        )}
                        <div style={{ fontSize: 12, lineHeight: 1.35 }}>
                          <div
                            style={{
                              fontWeight: 500,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {attachment.file.name}
                          </div>
                          <div style={{ color: "var(--muted)", marginTop: 2 }}>
                            {(attachment.file.size / 1024).toFixed(1)} KB
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  ref={attachmentInputRef}
                  type="file"
                  accept="image/*,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    handleAttachmentPick(e.target.files);
                    e.currentTarget.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => attachmentInputRef.current?.click()}
                  disabled={
                    !activeThreadId ||
                    sendTextMutation.isPending ||
                    sendMediaMutation.isPending ||
                    !isWhatsAppThread(selectedThread) ||
                    (isWhatsAppThread(selectedThread) && !sessionWindow.isOpen)
                  }
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "rgba(255,255,255,0.03)",
                    color: "var(--foreground)",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                  title="Attach image or document"
                >
                  +
                </button>
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
                    sendMediaMutation.isPending ||
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
                    minWidth: 0,
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void handleSend()}
                  disabled={
                    (!draft.trim() && attachments.length === 0) ||
                    sendTextMutation.isPending ||
                    sendMediaMutation.isPending ||
                    !isWhatsAppThread(selectedThread) ||
                    (isWhatsAppThread(selectedThread) && !sessionWindow.isOpen)
                  }
                >
                  {sendTextMutation.isPending || sendMediaMutation.isPending ? "Sending…" : "Send"}
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
