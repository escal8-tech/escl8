"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";
import { useToast } from "@/components/ToastProvider";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { readMediaInfo } from "@/app/portal/messages/mediaInfo";
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

function isOutbound(direction: string): boolean {
  return ["outbound", "assistant", "bot", "staff", "system_out"].includes(String(direction || "").toLowerCase());
}

export function InlineThreadPanel({
  threadId,
  customerName,
  customerPhone,
  customerHref,
}: {
  threadId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerHref?: string | null;
}) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const normalizedThreadId = String(threadId || "").trim();
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [liveMessages, setLiveMessages] = useState<InlineMessage[]>([]);
  const messagesQuery = trpc.messages.listMessages.useQuery(
    { threadId: normalizedThreadId, limit: 40 },
    { enabled: Boolean(normalizedThreadId) },
  );
  const sessionQuery = trpc.messages.getThreadSessionWindow.useQuery(
    { threadId: normalizedThreadId },
    { enabled: Boolean(normalizedThreadId) },
  );
  const sendText = trpc.messages.sendText.useMutation();

  const messages = useMemo(() => {
    const byId = new Map<string, InlineMessage>();
    for (const message of messagesQuery.data?.messages ?? []) {
      byId.set(message.id, { ...message, threadId: normalizedThreadId });
    }
    for (const message of liveMessages) {
      if (message.threadId === normalizedThreadId) byId.set(message.id, message);
    }
    return Array.from(byId.values()).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [liveMessages, messagesQuery.data?.messages, normalizedThreadId]);

  const appendMessage = useCallback((message: InlineMessage) => {
    if (!normalizedThreadId || message.threadId !== normalizedThreadId) return;
    setLiveMessages((current) => {
      if (current.some((existing) => existing.id === message.id)) return current;
      return [...current, message];
    });
  }, [normalizedThreadId]);

  useLivePortalEvents({
    activeThreadId: normalizedThreadId || null,
    activeThreadPageSize: 40,
    onThreadMessage: appendMessage,
    onCatchup: async () => {
      if (!normalizedThreadId) return;
      await Promise.all([
        utils.messages.listMessages.invalidate({ threadId: normalizedThreadId, limit: 40 }),
        utils.messages.getThreadSessionWindow.invalidate({ threadId: normalizedThreadId }),
      ]);
    },
  });

  const session = sessionQuery.data;
  const canSend = Boolean(normalizedThreadId && session?.channel === "whatsapp" && session.isOpen && draft.trim());
  const displayName = customerName?.trim() || customerPhone?.trim() || "Customer";
  const displayPhone = customerPhone?.trim() || "No phone linked";

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

        <div className="portal-inline-thread__messages">
          {!normalizedThreadId ? (
            <div className="portal-inline-thread__empty">
              No customer conversation is linked to this record yet.
            </div>
          ) : messagesQuery.isLoading ? (
            <div className="portal-inline-thread__empty">Loading conversation...</div>
          ) : !messages.length ? (
            <div className="portal-inline-thread__empty">No messages in this thread yet.</div>
          ) : (
            messages.map((message) => {
              const media = readMediaInfo(message);
              const outbound = isOutbound(message.direction);
              return (
                <div key={message.id} className={`portal-inline-thread__bubble-row${outbound ? " is-outbound" : ""}`}>
                  <div className={`portal-inline-thread__bubble${outbound ? " is-outbound" : ""}`}>
                    {media.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={media.imageUrl} alt={media.caption || "Message image"} className="portal-inline-thread__image" />
                    ) : null}
                    {media.documentUrl ? (
                      <a href={media.documentUrl} target="_blank" rel="noreferrer" className="portal-inline-thread__document">
                        {media.filename || "Open document"}
                      </a>
                    ) : null}
                    {media.caption || message.textBody ? (
                      <div className="portal-inline-thread__text">{media.caption || message.textBody}</div>
                    ) : null}
                    <div className="portal-inline-thread__time">{formatMessageTime(message.createdAt)}</div>
                  </div>
                </div>
              );
            })
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
