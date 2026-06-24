"use client";

import { useMemo, useState } from "react";
import { readMediaInfo } from "@/app/portal/messages/mediaInfo";
import {
  enrichInboundInteractive,
  isInteractivePlaceholderText,
  isOutboundDirection,
  parseOutboundInteractive,
  type ThreadMessageLike,
} from "@/app/portal/messages/interactiveMessage";
import { InteractiveListPanel } from "@/app/portal/messages/components/InteractiveListModal";

type ThreadMessageBubbleProps = {
  message: ThreadMessageLike;
  allMessages?: ThreadMessageLike[];
  messageIndex?: number;
  timestamp: string;
  variant?: "inline" | "inbox";
  isMobile?: boolean;
};

export function ThreadMessageBubble({
  message,
  allMessages = [],
  messageIndex = -1,
  timestamp,
  variant = "inbox",
  isMobile = false,
}: ThreadMessageBubbleProps) {
  const [listExpanded, setListExpanded] = useState(false);
  const outbound = isOutboundDirection(message.direction);

  const media = readMediaInfo(message);
  const isImageMessage = media.messageType === "image" && Boolean(media.imageUrl);
  const isDocumentMessage = media.messageType === "document" && Boolean(media.documentUrl);
  const isMediaMessage = isImageMessage || isDocumentMessage;

  const outboundInteractive = useMemo(
    () => (outbound ? parseOutboundInteractive(message) : null),
    [message, outbound],
  );

  const inboundInteractive = useMemo(() => {
    if (outbound) return null;
    if (messageIndex >= 0 && allMessages.length) {
      return enrichInboundInteractive(message, allMessages, messageIndex);
    }
    return enrichInboundInteractive(message, [message], 0);
  }, [allMessages, message, messageIndex, outbound]);

  const plainText = useMemo(() => {
    const body = String(message.textBody || "").trim();
    if (!body) return "";
    if (isInteractivePlaceholderText(body)) return "";
    if (inboundInteractive) return "";
    if (outboundInteractive?.bodyText) return outboundInteractive.bodyText;
    return body;
  }, [inboundInteractive, message.textBody, outboundInteractive]);

  const priorOutboundList = useMemo(() => {
    if (!inboundInteractive || inboundInteractive.replyKind !== "list_reply" || messageIndex < 1) return null;
    for (let index = messageIndex - 1; index >= 0; index -= 1) {
      const candidate = allMessages[index];
      if (!candidate || !isOutboundDirection(candidate.direction)) continue;
      const parsed = parseOutboundInteractive(candidate);
      if (parsed?.kind === "list" && parsed.sections.length) return parsed;
    }
    return null;
  }, [allMessages, inboundInteractive, messageIndex]);

  const rowClass = `wa-thread-message${outbound ? " is-outbound" : " is-inbound"}${variant === "inline" ? " is-inline" : " is-inbox"}`;
  const maxWidth = isMobile ? "86%" : variant === "inline" ? "min(88%, 440px)" : "520px";

  if (isMediaMessage) {
    return (
      <div className={rowClass} style={{ maxWidth }}>
        <MediaBubble
          outbound={outbound}
          isImageMessage={isImageMessage}
          isDocumentMessage={isDocumentMessage}
          media={media}
          timestamp={timestamp}
        />
      </div>
    );
  }

  if (outboundInteractive) {
    const hasButtonOptions =
      outboundInteractive.kind === "button" && outboundInteractive.buttons.length > 0;
    const hasListOptions = outboundInteractive.kind === "list" && outboundInteractive.sections.length > 0;
    const hasAttachedOptions = hasButtonOptions || hasListOptions;

    const showBodyBubble = Boolean(outboundInteractive.bodyText) || (!hasButtonOptions && !hasListOptions);

    return (
      <div className={rowClass} style={{ maxWidth }}>
        {showBodyBubble ? (
          <div
            className={`wa-thread-message__bubble${outbound ? " is-outbound" : ""}${hasAttachedOptions ? " has-attached-options" : ""}`}
          >
            {outboundInteractive.bodyText ? (
              <div className="wa-thread-message__text">{outboundInteractive.bodyText}</div>
            ) : null}
            <div className="wa-thread-message__time">{timestamp}</div>
          </div>
        ) : null}

        {hasButtonOptions ? (
          <div
            className={`wa-thread-message__interactive-stack${showBodyBubble ? " is-attached" : " is-standalone"}`}
            aria-label="Message options"
          >
            {outboundInteractive.buttons.map((button) => (
              <div key={button.id} className="wa-thread-message__interactive-option" aria-disabled="true">
                <span className="wa-thread-message__interactive-option-icon" aria-hidden="true">
                  ↩
                </span>
                <span>{button.title}</span>
              </div>
            ))}
          </div>
        ) : null}

        {hasListOptions ? (
          <>
            <button
              type="button"
              className={`wa-thread-message__list-trigger${showBodyBubble ? " is-attached" : " is-standalone"}${listExpanded ? " is-open" : ""}`}
              onClick={() => setListExpanded((open) => !open)}
              aria-expanded={listExpanded}
            >
              <span className="wa-thread-message__list-trigger-label">
                {outboundInteractive.listButtonLabel || "View list options"}
              </span>
              <span className="wa-thread-message__list-trigger-meta">
                {outboundInteractive.sections.reduce((count, section) => count + section.rows.length, 0)} options
              </span>
            </button>
            {listExpanded ? (
              <InteractiveListPanel
                title={outboundInteractive.listButtonLabel || "Select an option"}
                subtitle={outboundInteractive.bodyText || undefined}
                sections={outboundInteractive.sections}
              />
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  if (inboundInteractive) {
    return (
      <div className={rowClass} style={{ maxWidth }}>
        {inboundInteractive.promptText ? (
          <div className="wa-thread-message__reply-context">
            <div className="wa-thread-message__reply-context-label">Replied to</div>
            <div className="wa-thread-message__reply-context-text">{inboundInteractive.promptText}</div>
          </div>
        ) : null}

        <div className="wa-thread-message__bubble is-inbound is-selection">
          <div className="wa-thread-message__selection-label">Customer selected</div>
          <div className="wa-thread-message__selection-value">{inboundInteractive.replyTitle}</div>
          <div className="wa-thread-message__time">{timestamp}</div>
        </div>

        {inboundInteractive.replyKind === "list_reply" && priorOutboundList ? (
          <>
            <button
              type="button"
              className={`wa-thread-message__list-trigger is-inbound is-attached${listExpanded ? " is-open" : ""}`}
              onClick={() => setListExpanded((open) => !open)}
              aria-expanded={listExpanded}
            >
              <span className="wa-thread-message__list-trigger-label">View all list options</span>
            </button>
            {listExpanded ? (
              <InteractiveListPanel
                title={priorOutboundList.listButtonLabel || "Select an option"}
                subtitle={priorOutboundList.bodyText || inboundInteractive.promptText}
                sections={priorOutboundList.sections}
                selectedReplyId={inboundInteractive.replyId}
              />
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className={rowClass} style={{ maxWidth }}>
      <div className={`wa-thread-message__bubble${outbound ? " is-outbound" : ""}`}>
        <div className="wa-thread-message__text">{plainText || "(non-text message)"}</div>
        <div className="wa-thread-message__time">{timestamp}</div>
      </div>
    </div>
  );
}

function MediaBubble({
  outbound,
  isImageMessage,
  isDocumentMessage,
  media,
  timestamp,
}: {
  outbound: boolean;
  isImageMessage: boolean;
  isDocumentMessage: boolean;
  media: ReturnType<typeof readMediaInfo>;
  timestamp: string;
}) {
  const captionText =
    media.caption && media.caption !== "[image]"
      ? media.caption
      : isDocumentMessage
        ? media.filename || ""
        : "";
  const documentBadge = media.filename?.includes(".")
    ? String(media.filename.split(".").pop() || "DOC").slice(0, 5).toUpperCase()
    : "DOC";

  return (
    <div className={`wa-thread-message__media${outbound ? " is-outbound" : ""}`}>
      {isImageMessage ? (
        <a href={media.imageUrl!} target="_blank" rel="noreferrer" className="wa-thread-message__media-link">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={media.imageUrl!} alt={captionText || "Message image"} className="wa-thread-message__image" />
        </a>
      ) : (
        <a href={media.documentUrl!} target="_blank" rel="noreferrer" className="wa-thread-message__document-card">
          <div className="wa-thread-message__document-badge">{documentBadge}</div>
          <div className="wa-thread-message__document-copy">
            <div className="wa-thread-message__document-title">{media.filename || "Document"}</div>
            <div className="wa-thread-message__document-hint">Tap to open</div>
          </div>
        </a>
      )}

      {captionText ? <div className="wa-thread-message__text">{captionText}</div> : null}
      <div className="wa-thread-message__time">{timestamp}</div>
    </div>
  );
}