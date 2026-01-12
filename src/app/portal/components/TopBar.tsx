"use client";

import Breadcrumbs from "@/app/portal/components/Breadcrumbs";

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
};

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
    </header>
  );
}
