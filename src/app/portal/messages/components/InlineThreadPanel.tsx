"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";
import { useToast } from "@/components/ToastProvider";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { ThreadMessageBubble } from "@/app/portal/messages/components/ThreadMessageBubble";
import { isOutboundDirection } from "@/app/portal/messages/interactiveMessage";
import { trpc } from "@/utils/trpc";

type InlineMessage = {
  id: string;
  threadId?: string;
  direction: string;
  messageType: string | null;
  textBody: string | null;
  meta: unknown;
  createdAt: string | Date;
};

function formatMessageTime(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatWindow(seconds: number): string {
  if (seconds <= 0) return "Window closed";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${Math.max(1, minutes)}m left`;
}

function mergeMessages(current: InlineMessage[], incoming: InlineMessage[]): InlineMessage[] {
  const byId = new Map<string, InlineMessage>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export function InlineThreadPanel({
  threadId,
  anchorOrderId,
  customerName,
  customerPhone,
  customerHref,
}: {
  threadId?: string | null;
  anchorOrderId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerHref?: string | null;
}) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const normalizedThreadId = String(threadId || "").trim();
  const normalizedAnchorOrderId = String(anchorOrderId || "").trim();
  const useOrderAnchor = Boolean(normalizedAnchorOrderId);

  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const prevScrollHeightRef = useRef(0);
  const didInitialScrollRef = useRef(false);

  const [liveMessages, setLiveMessages] = useState<InlineMessage[]>([]);
  const [allMessages, setAllMessages] = useState<InlineMessage[]>([]);
  const [anchorMessageId, setAnchorMessageId] = useState<string | null>(null);
  const [hasMoreBefore, setHasMoreBefore] = useState(false);
  const [hasMoreAfter, setHasMoreAfter] = useState(false);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [newerCursor, setNewerCursor] = useState<string | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isLoadingNewer, setIsLoadingNewer] = useState(false);

  const anchorQuery = trpc.messages.getOrderThreadAnchor.useQuery(
    { orderId: normalizedAnchorOrderId },
    { enabled: useOrderAnchor },
  );

  const resolvedAnchorMessageId = useOrderAnchor ? anchorQuery.data?.anchorMessageId ?? undefined : undefined;
  const windowReady = Boolean(normalizedThreadId) && (!useOrderAnchor || anchorQuery.isFetched);

  const windowQuery = trpc.messages.listThreadWindow.useQuery(
    {
      threadId: normalizedThreadId,
      anchorMessageId: resolvedAnchorMessageId,
      beforeLimit: 24,
      afterLimit: 6,
    },
    { enabled: windowReady && !olderCursor && !newerCursor },
  );

  const olderWindowQuery = trpc.messages.listThreadWindow.useQuery(
    {
      threadId: normalizedThreadId,
      anchorMessageId: anchorMessageId ?? resolvedAnchorMessageId,
      beforeLimit: 20,
      olderCursor: olderCursor ?? undefined,
    },
    { enabled: Boolean(normalizedThreadId) && isLoadingOlder && Boolean(olderCursor) },
  );

  const newerWindowQuery = trpc.messages.listThreadWindow.useQuery(
    {
      threadId: normalizedThreadId,
      anchorMessageId: anchorMessageId ?? resolvedAnchorMessageId,
      afterLimit: 12,
      newerCursor: newerCursor ?? undefined,
    },
    { enabled: Boolean(normalizedThreadId) && isLoadingNewer && Boolean(newerCursor) },
  );

  const sessionQuery = trpc.messages.getThreadSessionWindow.useQuery(
    { threadId: normalizedThreadId },
    { enabled: Boolean(normalizedThreadId) },
  );
  const sendText = trpc.messages.sendText.useMutation();

  const resetThreadState = useCallback(() => {
    setLiveMessages([]);
    setAllMessages([]);
    setAnchorMessageId(null);
    setHasMoreBefore(false);
    setHasMoreAfter(false);
    setOlderCursor(null);
    setNewerCursor(null);
    setIsLoadingOlder(false);
    setIsLoadingNewer(false);
    didInitialScrollRef.current = false;
  }, []);

  useEffect(() => {
    const data = windowQuery.data;
    if (!data || olderCursor || newerCursor) return;
    queueMicrotask(() => {
      const nextMessages = data.messages.map((message) => ({ ...message, threadId: normalizedThreadId }));
      setAllMessages(nextMessages);
      setAnchorMessageId(data.anchorMessageId);
      setHasMoreBefore(data.hasMoreBefore);
      setHasMoreAfter(data.hasMoreAfter);
    });
  }, [windowQuery.data, normalizedThreadId, olderCursor, newerCursor]);

  useEffect(() => {
    const data = olderWindowQuery.data;
    if (!isLoadingOlder || !data) return;
    const container = messagesContainerRef.current;
    if (container) prevScrollHeightRef.current = container.scrollHeight;
    queueMicrotask(() => {
      setAllMessages((current) =>
        mergeMessages(
          current,
          data.messages.map((message) => ({ ...message, threadId: normalizedThreadId })),
        ),
      );
      setHasMoreBefore(data.hasMoreBefore);
      setOlderCursor(null);
      setIsLoadingOlder(false);
      setTimeout(() => {
        if (!container) return;
        container.scrollTop = container.scrollHeight - prevScrollHeightRef.current;
      }, 10);
    });
  }, [isLoadingOlder, normalizedThreadId, olderWindowQuery.data]);

  useEffect(() => {
    const data = newerWindowQuery.data;
    if (!isLoadingNewer || !data) return;
    queueMicrotask(() => {
      setAllMessages((current) =>
        mergeMessages(
          current,
          data.messages.map((message) => ({ ...message, threadId: normalizedThreadId })),
        ),
      );
      setHasMoreAfter(data.hasMoreAfter);
      setNewerCursor(null);
      setIsLoadingNewer(false);
    });
  }, [isLoadingNewer, normalizedThreadId, newerWindowQuery.data]);

  const messages = useMemo(
    () => mergeMessages(allMessages, liveMessages.filter((message) => message.threadId === normalizedThreadId)),
    [allMessages, liveMessages, normalizedThreadId],
  );

  const scrollToAnchorOrBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (anchorMessageId) {
      const anchorElement = container.querySelector<HTMLElement>(`[data-thread-anchor="${anchorMessageId}"]`);
      if (anchorElement) {
        anchorElement.scrollIntoView({ block: "end" });
        return;
      }
    }

    container.scrollTop = container.scrollHeight;
  }, [anchorMessageId]);

  useEffect(() => {
    if (!messages.length || didInitialScrollRef.current) return;
    didInitialScrollRef.current = true;
    setTimeout(() => scrollToAnchorOrBottom(), 50);
  }, [messages.length, scrollToAnchorOrBottom]);

  const appendMessage = useCallback((message: InlineMessage) => {
    if (!normalizedThreadId || message.threadId !== normalizedThreadId) return;
    setLiveMessages((current) => {
      if (current.some((existing) => existing.id === message.id)) return current;
      return [...current, message];
    });
    setTimeout(() => {
      const container = messagesContainerRef.current;
      if (!container) return;
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceFromBottom < 120) scrollToAnchorOrBottom();
    }, 30);
  }, [normalizedThreadId, scrollToAnchorOrBottom]);

  useLivePortalEvents({
    activeThreadId: normalizedThreadId || null,
    activeThreadPageSize: 24,
    onThreadMessage: appendMessage,
    onCatchup: async () => {
      if (!normalizedThreadId) return;
      resetThreadState();
      await Promise.all([
        utils.messages.listThreadWindow.invalidate(),
        utils.messages.getOrderThreadAnchor.invalidate(),
        utils.messages.getThreadSessionWindow.invalidate({ threadId: normalizedThreadId }),
      ]);
    },
  });

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (!isLoadingOlder && hasMoreBefore && container.scrollTop < 120 && messages.length > 0) {
      setIsLoadingOlder(true);
      setOlderCursor(messages[0]?.id ?? null);
    }

    if (!isLoadingNewer && hasMoreAfter) {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceFromBottom < 120) {
        setIsLoadingNewer(true);
        setNewerCursor(messages[messages.length - 1]?.id ?? null);
      }
    }
  }, [hasMoreAfter, hasMoreBefore, isLoadingNewer, isLoadingOlder, messages]);

  const session = sessionQuery.data;
  const canSend = Boolean(normalizedThreadId && session?.channel === "whatsapp" && session.isOpen && draft.trim());
  const displayName = customerName?.trim() || customerPhone?.trim() || "Customer";
  const displayPhone = customerPhone?.trim() || "No phone linked";
  const isLoading =
    !normalizedThreadId ||
    (useOrderAnchor && anchorQuery.isLoading) ||
    (windowReady && windowQuery.isLoading && !messages.length);

  const handleSend = async () => {
    const text = draft.trim();
    if (!normalizedThreadId || !text) return;
    try {
      const saved = await sendText.mutateAsync({ threadId: normalizedThreadId, text });
      appendMessage({ ...saved, threadId: normalizedThreadId });
      setDraft("");
      await sessionQuery.refetch();
      showSuccessToast(toast, { title: "Message sent", message: "The customer thread was updated." });
    } catch (error) {
      showErrorToast(toast, {
        title: "Send failed",
        message: error instanceof Error ? error.message : "Could not send this message.",
      });
    }
  };

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
  }, [draft]);

  const statusLabel = useMemo(() => {
    if (!normalizedThreadId) return "No thread linked";
    if (sessionQuery.isLoading) return "Checking window";
    if (!session) return "Thread ready";
    if (session.channel !== "whatsapp") return "Read only";
    return session.isOpen ? formatWindow(session.secondsRemaining) : "Window closed";
  }, [normalizedThreadId, session, sessionQuery.isLoading]);

  return (
    <section className="portal-inline-thread">
      <div className="portal-inline-thread__phone">
        <div className="portal-inline-thread__topbar">
          <div className="portal-inline-thread__avatar">{displayName.slice(0, 1).toUpperCase()}</div>
          <div className="portal-inline-thread__identity">
            {customerHref ? (
              <Link href={customerHref} className="portal-inline-thread__title" title="Open customer details">
                {displayName}
              </Link>
            ) : (
              <div className="portal-inline-thread__title">{displayName}</div>
            )}
            <div className="portal-inline-thread__subtitle">{displayPhone}</div>
          </div>
          <span className={`portal-inline-thread__status${session?.isOpen ? " is-open" : ""}`}>{statusLabel}</span>
        </div>

        <div
          ref={messagesContainerRef}
          className="portal-inline-thread__messages"
          onScroll={handleScroll}
        >
          {!normalizedThreadId ? (
            <div className="portal-inline-thread__empty">
              No customer conversation is linked to this record yet.
            </div>
          ) : isLoading ? (
            <div className="portal-inline-thread__empty">Loading conversation...</div>
          ) : !messages.length ? (
            <div className="portal-inline-thread__empty">No messages in this thread yet.</div>
          ) : (
            <>
              {hasMoreBefore ? (
                <div className="portal-inline-thread__load-hint">
                  {isLoadingOlder ? "Loading earlier messages..." : "Scroll up for earlier messages"}
                </div>
              ) : null}
              {messages.map((message, index) => {
                const outbound = isOutboundDirection(message.direction);
                const isAnchor = Boolean(anchorMessageId && message.id === anchorMessageId);
                return (
                  <div
                    key={message.id}
                    data-thread-anchor={isAnchor ? message.id : undefined}
                    className={`wa-thread-message-row${outbound ? " is-outbound" : " is-inbound"}${isAnchor ? " is-order-anchor" : ""}`}
                  >
                    {isAnchor ? <div className="portal-inline-thread__anchor-label">Order end</div> : null}
                    <ThreadMessageBubble
                      message={message}
                      allMessages={messages}
                      messageIndex={index}
                      timestamp={formatMessageTime(message.createdAt)}
                      variant="inline"
                    />
                  </div>
                );
              })}
              {hasMoreAfter ? (
                <div className="portal-inline-thread__load-hint">
                  {isLoadingNewer ? "Loading later messages..." : "Later messages available below"}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="portal-inline-thread__composer">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={normalizedThreadId ? "Type a WhatsApp reply..." : "No thread linked"}
            disabled={!normalizedThreadId || session?.channel !== "whatsapp" || session?.isOpen === false || sendText.isPending}
            rows={2}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (canSend) void handleSend();
              }
            }}
          />
          <button
            type="button"
            className="portal-inline-thread__send"
            disabled={!canSend || sendText.isPending}
            onClick={() => void handleSend()}
            aria-label="Send WhatsApp reply"
            title="Send"
          >
            <InlineSendIcon />
          </button>
        </div>
      </div>
    </section>
  );
}

function InlineSendIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}