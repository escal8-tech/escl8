"use client";

import type { ReactNode } from "react";

type PortalBotToggleButtonProps = {
  paused: boolean;
  onToggle?: () => void;
  pending?: boolean;
  disabled?: boolean;
  title?: string;
  available?: boolean;
  fallback?: ReactNode;
  className?: string;
  stopPropagation?: boolean;
};

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1.4" />
      <rect x="14" y="5" width="4" height="14" rx="1.4" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.8a1 1 0 0 1 1.53-.85l8.2 5.2a1 1 0 0 1 0 1.7l-8.2 5.2A1 1 0 0 1 8 16.2z" />
    </svg>
  );
}

export function PortalBotToggleButton({
  paused,
  onToggle,
  pending = false,
  disabled = false,
  title,
  available = true,
  fallback = "-",
  className,
  stopPropagation = true,
}: PortalBotToggleButtonProps) {
  if (!available) {
    return <span className="portal-bot-control__fallback">{fallback}</span>;
  }

  const resolvedTitle = title ?? (paused ? "Resume bot" : "Pause bot");
  const isDisabled = pending || disabled || !onToggle;

  return (
    <button
      type="button"
      className={`portal-bot-control ${paused ? "is-paused" : "is-active"}${className ? ` ${className}` : ""}`}
      onClick={(event) => {
        if (stopPropagation) event.stopPropagation();
        if (isDisabled) return;
        onToggle?.();
      }}
      disabled={isDisabled}
      aria-label={resolvedTitle}
      title={resolvedTitle}
    >
      {paused ? <PlayIcon /> : <PauseIcon />}
    </button>
  );
}
