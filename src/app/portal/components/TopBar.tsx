"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePortalTheme } from "@/app/portal/components/PortalThemeProvider";
import { trpc } from "@/utils/trpc";
import { usePhoneFilter } from "@/components/PhoneFilterContext";
import { useIsMobileViewport } from "@/app/portal/hooks/useIsMobileViewport";
import {
  Sparkles,
  CheckCircle2,
  ChevronRight,
  X,
  Circle,
} from "lucide-react";

// Types matching the backend
type SetupItem = {
  id: string;
  label: string;
  detail: string;
  complete: boolean;
  icon?: React.ReactNode;
};
type TryItem = {
  id: string;
  label: string;
  detail: string;
  icon?: React.ReactNode;
};
type SetupStatus = {
  percent: number;
  completed: number;
  total: number;
  required: SetupItem[];
  thingsToTry: TryItem[];
  onboarding: Record<string, unknown>;
  businessName?: string;
};

const Icons = {
  profile: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  location: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  whatsapp: (
    <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  ),
  gmail: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  ),
  widget: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 21V9" />
    </svg>
  ),
  invite: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  catalog: (
    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12 20.73 6.96" />
      <line x1="12" y1="22" x2="12" y2="12" />
    </svg>
  ),
  firstOrder: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9 15 2 20 9" />
      <path d="M20 9v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9" />
    </svg>
  ),
};

export default function TopBar({ sidebarWidth, onMobileMenuOpen }: { sidebarWidth: number; onMobileMenuOpen: () => void }) {
  const [setupOpen, setSetupOpen] = useState(false);
  const { theme } = usePortalTheme();
  const isDark = theme === "dark";
  const isMobile = useIsMobileViewport();
  const { selectedPhoneNumberId, setSelectedPhoneNumberId } = usePhoneFilter();
  const phoneNumbersQuery = trpc.business.listPhoneNumbers.useQuery();
  const setupStatusQuery = trpc.business.getSetupStatus.useQuery(undefined, { refetchOnWindowFocus: false });
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
    <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 12px" }}>Loading...</div>
  ) : phoneNumbers.length > 0 ? (
    <div className="portal-topbar-control portal-topbar-control--filter">
      <select
        value={selectedPhoneNumberId ?? "all"}
        onChange={(e) => setSelectedPhoneNumberId(e.target.value === "all" ? null : e.target.value)}
        style={{ minWidth: 0, width: phoneFilterWidth, height: 38, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: 14 }}
        aria-label="Filter by phone number"
      >
        {phoneFilterOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  ) : null;

  const setupStatus = setupStatusQuery.data;
  const setupPercent = setupStatus?.percent ?? 0;
  const setupComplete = setupStatus?.completed ?? 0;
  const setupTotal = setupStatus?.total ?? 5;
  const businessName = setupStatus?.onboarding?.businessName
    ? String(setupStatus.onboarding.businessName).trim()
    : setupStatus?.required?.find((r) => r.id === "profile")?.complete
      ? "Your Business"
      : "";

  const setupRingStyle = {
    background: `conic-gradient(${isDark ? "#D4A84B" : "#f4c45f"} ${setupPercent * 3.6}deg, ${isDark ? "rgba(15,23,42,0.7)" : "rgba(255,255,255,0.34)"} 0deg)`,
  };

  return (
    <>
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
          <button className="btn btn-ghost btn-icon mobile-menu-btn" onClick={onMobileMenuOpen} aria-label="Open menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <nav className="topbar-breadcrumbs">
            <ol style={{ display: "flex", alignItems: "center", gap: 6, listStyle: "none", margin: 0, padding: 0 }}>
              <li style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <a href="/portal" style={{ textDecoration: "none", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>PORTAL</a>
              </li>
              <li style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)" }}>
                <svg width="3.5" height="3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m9 18 6-6-6-6" />
                </svg>
                <span style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>MENU</span>
              </li>
            </ol>
          </nav>

          <div className="topbar-mobile-inline">
            <div className="portal-time-chip" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
              <span aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 3" />
                </svg>
              </span>
              <span>{new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            </div>
          </div>
        </div>

        {/* Right side: Phone number filter + Setup button + Time */}
        {!isMobile || hasPhoneFilter ? (
          <div className={`topbar-right${hasPhoneFilter ? " has-filter" : ""}`} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              onClick={() => setSetupOpen(true)}
              className={`h-12 min-w-[210px] items-center gap-3 rounded-full px-3.5 pr-5 text-sm font-bold shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl flex ${isDark ? "bg-gradient-to-r from-accent-gold via-[#e7bd68] to-[#b8860b] text-dark-950 shadow-accent-gold/15" : "bg-gradient-to-r from-[#07111f] via-[#0A3A76] to-[#1f5f9f] text-white shadow-[#0A3A76]/25"}`}
              style={{ padding: "0 16px" }}
            >
              <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${isDark ? "text-dark-950" : "text-[#0A3A76]"}`} style={setupRingStyle}>
                <span className={`absolute inset-[4px] rounded-full ${isDark ? "bg-[#f4d17b]" : "bg-white"}`} />
                <span className="relative">{setupPercent}%</span>
              </span>
              <span className="flex min-w-0 flex-col items-start leading-none">
                <span>Complete setup</span>
                <span className={`mt-1 text-[11px] font-semibold ${isDark ? "text-dark-900/70" : "text-white/70"}`}>{setupComplete} of {setupTotal} tasks</span>
              </span>
              <ChevronRight className="ml-auto h-4 w-4" strokeWidth={2.4} />
            </button>
            {phoneFilterControl}
            <div className="topbar-secondary" style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8, background: "var(--card-muted)", border: "1px solid var(--border)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: isDark ? "var(--gold-light)" : "var(--primary)" }}>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 3" />
              </svg>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            </div>
          </div>
        ) : null}
      </header>

      {setupOpen && setupStatus && (
        <SetupChecklistDrawer
          open={setupOpen}
          onClose={() => setSetupOpen(false)}
          status={{
            ...setupStatus,
            required: setupStatus.required.map((r) => ({ ...r, icon: Icons[r.id as keyof typeof Icons] ?? Icons.profile })),
            thingsToTry: setupStatus.thingsToTry.map((t) => ({ ...t, icon: Icons[t.id as keyof typeof Icons] ?? Icons.firstOrder })),
          }}
          businessName={businessName}
          isDark={isDark}
        />
      )}
    </>
  );
}

// SetupChecklistDrawer Component (inline for co-location)
function SetupChecklistDrawer({ open, onClose, status, businessName, isDark }: { open: boolean; onClose: () => void; status: SetupStatus; businessName: string; isDark: boolean }) {
  if (!open) return null;

  const setupPercent = status.percent ?? 0;
  const setupComplete = status.completed ?? 0;
  const setupTotal = status.total ?? 5;

  const setupRingStyle = {
    background: `conic-gradient(${isDark ? "#D4A84B" : "#f4c45f"} ${setupPercent * 3.6}deg, ${isDark ? "rgba(15,23,42,0.7)" : "rgba(255,255,255,0.34)"} 0deg)`,
  };

  const requiredItems = status.required ?? [
    { id: "profile", label: "Complete business profile", detail: "Business name, contact details, and brand identity.", complete: false, icon: Icons.profile },
    { id: "location", label: "Set location and timezone", detail: "Needed for customer widgets, schedules, receipts, and due times.", complete: false, icon: Icons.location },
    { id: "whatsapp", label: "Connect WhatsApp", detail: "Required before live customer messaging and automation.", complete: false, icon: Icons.whatsapp },
    { id: "gmail", label: "Connect Gmail", detail: "Required for invite emails, order emails, and payment instructions.", complete: false, icon: Icons.gmail },
    { id: "widget", label: "Prepare customer widget", detail: "Enable and preview the public customer entry point.", complete: false, icon: Icons.widget },
  ];

  const quickActions = [
    { id: "invite", label: "Invite teammates", detail: "Add staff from Users & Permissions when you are ready.", icon: Icons.invite },
    { id: "catalog", label: "Upload documents or stock", detail: "Give the AI and operations screens real business data.", icon: Icons.catalog },
    { id: "first-order", label: "Create a test order or appointment", detail: "Run one internal flow before going live.", icon: Icons.firstOrder },
  ];

  return (
    <div className="fixed inset-0 z-[100]">
      <button type="button" aria-label="Close setup checklist" onClick={onClose} className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px]" />
      <aside className={`absolute right-0 top-[72px] h-[calc(100vh-72px)] w-full max-w-[560px] overflow-auto border-l shadow-2xl ${isDark ? "border-accent-gold/20 bg-[#07111f] text-dark-50 shadow-black/50" : "border-gray-200 bg-[#f8fafc] text-gray-950 shadow-slate-950/20"}`}>
        <div className={`sticky top-0 z-10 border-b px-7 py-5 backdrop-blur-xl ${isDark ? "border-white/10 bg-[#07111f]/90" : "border-gray-200 bg-white/88"}`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className={`text-xs font-bold uppercase tracking-[0.16em] ${isDark ? "text-accent-gold" : "text-[#0A3A76]"}`}>Workspace setup</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight">Complete setup</h2>
            </div>
            <button type="button" onClick={onClose} className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${isDark ? "border-white/10 bg-white/5 text-dark-200 hover:bg-white/10" : "border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50"}`}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-6 px-7 py-7">
          <section className={`overflow-hidden rounded-[2rem] border p-5 shadow-xl ${isDark ? "border-accent-gold/20 bg-[radial-gradient(circle_at_top_right,rgba(212,168,75,0.22),transparent_38%),linear-gradient(135deg,rgba(15,23,42,0.94),rgba(7,17,31,0.98))]" : "border-white bg-[radial-gradient(circle_at_top_right,rgba(244,196,95,0.55),transparent_34%),linear-gradient(135deg,#0A3A76,#07111f)] text-white"}`}>
            <div className="flex items-center gap-4">
              <div className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-lg font-black shadow-inner" style={setupRingStyle}>
                <div className={`absolute inset-[7px] rounded-full ${isDark ? "bg-[#07111f]" : "bg-white"}`} />
                <span className={`relative ${isDark ? "text-accent-gold" : "text-[#0A3A76]"}`}>{setupPercent}%</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${isDark ? "bg-accent-gold/10 text-accent-gold" : "bg-white/[0.12] text-white"}`}>
                  <Sparkles className="h-3.5 w-3.5" />
                  {setupComplete} of {setupTotal} tasks complete
                </div>
                <h3 className="mt-2 font-heading text-2xl font-bold leading-tight">
                  {businessName ? `Hi ${businessName}, continue setup` : "Continue setting up your workspace"}
                </h3>
              </div>
            </div>
            <div className={`mt-5 h-2.5 overflow-hidden rounded-full ${isDark ? "bg-white/10" : "bg-white/[0.18]"}`}>
              <div className={`h-full rounded-full ${isDark ? "bg-accent-gold" : "bg-[#f4c45f]"}`} style={{ width: `${setupPercent}%` }} />
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h3 className="text-base font-black">Required setup</h3>
                <p className={`mt-1 text-sm ${isDark ? "text-dark-400" : "text-gray-500"}`}>These unlock the core customer-facing system.</p>
              </div>
            </div>
            <div className="grid gap-3">
              {requiredItems.map((item) => (
                <Link key={item.id} href={`/portal/settings?tab=${item.id === "widget" ? "customization" : "integrations"}&setup=${item.id}`} onClick={onClose} className={`group flex items-center gap-4 rounded-2xl border p-4 no-underline shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${item.complete ? (isDark ? "border-emerald-400/25 bg-emerald-400/10 text-dark-50" : "border-emerald-200 bg-emerald-50 text-gray-950") : (isDark ? "border-white/10 bg-white/[0.045] text-dark-50 hover:border-accent-gold/35 hover:bg-accent-gold/10" : "border-gray-200 bg-white text-gray-950 hover:border-[#0A3A76]/25 hover:bg-white")}`}>
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${item.complete ? (isDark ? "bg-emerald-400/15 text-emerald-300" : "bg-emerald-100 text-emerald-700") : (isDark ? "bg-accent-gold/10 text-accent-gold" : "bg-[#0A3A76]/10 text-[#0A3A76]")}`}>
                    {item.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{item.label}</span>
                      {item.complete ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : null}
                    </div>
                    <div className={`mt-1 text-sm ${isDark ? "text-dark-400" : "text-gray-500"}`}>{item.detail}</div>
                  </div>
                  <div className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-bold ${item.complete ? (isDark ? "border-emerald-400/25 text-emerald-300" : "border-emerald-200 text-emerald-700") : (isDark ? "border-accent-gold/25 text-accent-gold group-hover:bg-accent-gold group-hover:text-dark-950" : "border-gray-200 text-[#0A3A76] group-hover:bg-[#0A3A76] group-hover:text-white")}`}>
                    {item.complete ? "Done" : "Start"}
                    {!item.complete ? <ChevronRight className="h-3.5 w-3.5" /> : null}
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2">
              <Circle className={`h-3 w-3 fill-current ${isDark ? "text-accent-gold" : "text-[#0A3A76]"}`} />
              <h3 className="text-base font-black">Things to try</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {quickActions.map((item) => (
                <Link key={item.id} href={`/portal/${item.id === "invite" ? "settings?tab=users" : item.id === "catalog" ? "upload" : "orders"}`} onClick={onClose} className={`group min-h-[132px] rounded-2xl border p-4 no-underline transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${isDark ? "border-white/10 bg-white/[0.04] text-dark-50 hover:border-accent-gold/35 hover:bg-accent-gold/10" : "border-gray-200 bg-white text-gray-950 hover:border-[#0A3A76]/20 hover:shadow-[#0A3A76]/10"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${isDark ? "bg-accent-gold/10 text-accent-gold" : "bg-[#0A3A76]/10 text-[#0A3A76]"}`}>
                      {item.icon}
                    </div>
                    <ChevronRight className={`h-4 w-4 transition-transform group-hover:translate-x-0.5 ${isDark ? "text-dark-500" : "text-gray-400"}`} />
                  </div>
                  <div className="mt-4 font-bold">{item.label}</div>
                  <p className={`mt-1 text-sm leading-5 ${isDark ? "text-dark-400" : "text-gray-500"}`}>{item.detail}</p>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}