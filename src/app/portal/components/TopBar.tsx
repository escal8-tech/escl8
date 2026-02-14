"use client";

import Breadcrumbs from "@/app/portal/components/Breadcrumbs";
import { usePhoneFilter } from "@/components/PhoneFilterContext";
import { trpc } from "@/utils/trpc";
import { PortalSelect } from "./PortalSelect";

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
  chevronDown: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
};

function PhoneNumberFilter() {
  const { selectedPhoneNumberId, setSelectedPhoneNumberId } = usePhoneFilter();
  const phoneNumbersQuery = trpc.business.listPhoneNumbers.useQuery();

  const phoneNumbers = phoneNumbersQuery.data ?? [];
  
  if (phoneNumbersQuery.isLoading) {
    return (
      <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 12px" }}>
        Loading...
      </div>
    );
  }

  // If no phone numbers, don't show filter
  if (phoneNumbers.length === 0) {
    return null;
  }

  return (
    <div>
      <PortalSelect
        value={selectedPhoneNumberId ?? "all"}
        onValueChange={(value) => setSelectedPhoneNumberId(value === "all" ? null : value)}
        options={[
          { value: "all", label: "All Numbers" },
          ...phoneNumbers.map((phone) => ({
            value: phone.phoneNumberId,
            label: phone.displayPhoneNumber || phone.phoneNumberId.slice(-8),
          })),
        ]}
        style={{ minWidth: 168 }}
        ariaLabel="Filter by phone number"
      />
    </div>
  );
}

export default function TopBar({ sidebarWidth, onMobileMenuOpen }: TopBarProps) {
  return (
    <header
      className="portal-topbar"
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
      </div>

      {/* Right side: Phone number filter */}
      <div className="topbar-right" style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: "auto", paddingRight: 16 }}>
        <PhoneNumberFilter />
      </div>
    </header>
  );
}
