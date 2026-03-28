"use client";

import { useEffect, useState } from "react";
import Breadcrumbs from "@/app/portal/components/Breadcrumbs";
import { useIsMobileViewport } from "@/app/portal/hooks/useIsMobileViewport";
import { usePhoneFilter } from "@/components/PhoneFilterContext";
import { trpc } from "@/utils/trpc";
import { PortalSelect } from "./PortalSelect";
import { usePortalTheme } from "./PortalThemeProvider";

interface TopBarProps {
  sidebarWidth: number;
  onMobileMenuOpen: () => void;
}

// Icons
const Icons = {
  menu: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
  phone: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  clock: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  ),
  sun: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5" />
      <path d="M12 19.5V22" />
      <path d="m4.93 4.93 1.77 1.77" />
      <path d="m17.3 17.3 1.77 1.77" />
      <path d="M2 12h2.5" />
      <path d="M19.5 12H22" />
      <path d="m4.93 19.07 1.77-1.77" />
      <path d="m17.3 6.7 1.77-1.77" />
    </svg>
  ),
  moon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a7 7 0 1 0 9 9 9 9 0 1 1-9-9z" />
    </svg>
  ),
};

function ThemeToggle() {
  const { theme, setTheme } = usePortalTheme();

  return (
    <div className="portal-theme-switch" role="group" aria-label="Portal theme">
      <button
        type="button"
        className={`portal-theme-switch__option${theme === "light" ? " is-active" : ""}`}
        onClick={() => setTheme("light")}
        aria-pressed={theme === "light"}
      >
        {Icons.sun}
        <span>Light</span>
      </button>
      <button
        type="button"
        className={`portal-theme-switch__option${theme === "dark" ? " is-active" : ""}`}
        onClick={() => setTheme("dark")}
        aria-pressed={theme === "dark"}
      >
        {Icons.moon}
        <span>Dark</span>
      </button>
    </div>
  );
}

function TimeChip() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const timeLabel = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const tzLabel =
    Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value || "";

  return (
    <div className="portal-time-chip">
      <span className="portal-time-chip__icon" aria-hidden>
        {Icons.clock}
      </span>
      <span>{timeLabel}</span>
      {tzLabel ? <span className="portal-time-chip__tz">{tzLabel}</span> : null}
    </div>
  );
}

export default function TopBar({ sidebarWidth, onMobileMenuOpen }: TopBarProps) {
  const isMobile = useIsMobileViewport();
  const { selectedPhoneNumberId, setSelectedPhoneNumberId } = usePhoneFilter();
  const phoneNumbersQuery = trpc.business.listPhoneNumbers.useQuery();
  const phoneNumbers = phoneNumbersQuery.data ?? [];
  const hasPhoneFilter = phoneNumbers.length > 0 || phoneNumbersQuery.isLoading;
  const phoneFilterOptions = [
    { value: "all", label: "All Numbers" },
    ...phoneNumbers.map((phone) => ({
      value: phone.phoneNumberId,
      label: phone.displayPhoneNumber || phone.phoneNumberId.slice(-8),
    })),
  ];
  const phoneFilterWidthCh = Math.min(
    Math.max(...phoneFilterOptions.map((option) => option.label.length), "All Numbers".length) + 4,
    22,
  );
  const phoneFilterWidth = `min(100%, calc(${phoneFilterWidthCh}ch + 2.75rem))`;

  const phoneFilterControl = phoneNumbersQuery.isLoading ? (
    <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 12px" }}>
      Loading...
    </div>
  ) : phoneNumbers.length > 0 ? (
    <div className="portal-topbar-control portal-topbar-control--filter">
      <PortalSelect
        value={selectedPhoneNumberId ?? "all"}
        onValueChange={(value) => setSelectedPhoneNumberId(value === "all" ? null : value)}
        options={phoneFilterOptions}
        style={{ minWidth: 0, width: phoneFilterWidth }}
        ariaLabel="Filter by phone number"
      />
    </div>
  ) : null;

  return (
    <header
      className="portal-topbar"
      data-mobile-has-filter={isMobile && hasPhoneFilter ? "true" : "false"}
      style={{
        marginLeft: sidebarWidth,
        width: `calc(100% - ${sidebarWidth}px)`,
        position: "fixed",
        top: 0,
        right: 0,
        transition: "margin-left 0.3s, width 0.3s",
      }}
    >
      {/* Left side: Mobile menu + Breadcrumbs */}
      <div className="topbar-left">
        <button
          className="btn btn-ghost btn-icon mobile-menu-btn"
          onClick={onMobileMenuOpen}
          aria-label="Open menu"
        >
          {Icons.menu}
        </button>
        
        <Breadcrumbs />

        <div className="topbar-mobile-inline">
          <ThemeToggle />
          <TimeChip />
        </div>
      </div>

      {/* Right side: Phone number filter */}
      {!isMobile || hasPhoneFilter ? (
        <div className={`topbar-right${hasPhoneFilter ? " has-filter" : ""}`}>
          {phoneFilterControl}
          <div className="topbar-secondary">
            <ThemeToggle />
            <TimeChip />
          </div>
        </div>
      ) : null}
    </header>
  );
}
