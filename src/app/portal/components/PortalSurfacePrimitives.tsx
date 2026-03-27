"use client";

import type { ReactNode } from "react";

export type PortalMetricTone = "blue" | "gold" | "amber" | "rose";

export function PortalHeaderCard({
  title,
  description,
  controls,
}: {
  title: string;
  description: string;
  controls?: ReactNode;
}) {
  return (
    <div className="portal-res-header-card">
      <div className="portal-res-header-card__layout">
        <div className="portal-res-header-card__body">
          <div className="portal-res-header-card__title">{title}</div>
          <div className="portal-res-header-card__copy">{description}</div>
        </div>
        {controls ? <div className="portal-res-header-card__controls">{controls}</div> : null}
      </div>
    </div>
  );
}

export function PortalMetricCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: PortalMetricTone;
}) {
  return (
    <div className="portal-stat-card">
      <div className="portal-stat-card__head">
        <span className={`portal-stat-card__icon portal-stat-card__icon--${tone}`}>
          <PortalMetricIcon tone={tone} />
        </span>
        <span className="portal-stat-card__trail">{label}</span>
      </div>
      <div className="portal-stat-value">{value}</div>
      {hint ? <div className="portal-stat-hint">{hint}</div> : null}
    </div>
  );
}

function PortalMetricIcon({ tone }: { tone: PortalMetricTone }) {
  if (tone === "gold") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </svg>
    );
  }

  if (tone === "rose") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 7H8" />
        <path d="m12 5-4 4 4 4" />
      </svg>
    );
  }

  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 9.5c0-1.38-1.57-2.5-3.5-2.5s-3.5 1.12-3.5 2.5S10.07 12 12 12s3.5 1.12 3.5 2.5S13.93 17 12 17s-3.5-1.12-3.5-2.5" />
      <path d="M12 6.5v11" />
    </svg>
  );
}
