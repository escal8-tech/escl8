"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { onAuthStateChanged } from "firebase/auth";

// SVG Icons as components
const Icons = {
  dashboard: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  customers: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  upload: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  calendar: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  sync: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  home: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  chevronLeft: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
};

// Nav items without settings (moved to footer)
const navItems = [
  { href: "/portal/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/portal/customers", label: "Customers", icon: "customers" },
  { href: "/portal/messages", label: "Messages", icon: "customers" },
  { href: "/portal/upload", label: "Documents", icon: "upload" },
  { href: "/portal/bookings", label: "Bookings", icon: "calendar" },
  { href: "/portal/sync", label: "WhatsApp Sync", icon: "sync" },
];

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onMobileClose: () => void;
}

// Helper to extract display name from email
function getDisplayName(email: string | null): string {
  if (!email) return "User";
  // Get the part before @ and capitalize first letter
  const namePart = email.split("@")[0];
  // Replace dots and underscores with spaces, capitalize each word
  return namePart
    .replace(/[._]/g, " ")
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export default function Sidebar({ 
  collapsed, 
  mobileOpen, 
  onCollapsedChange, 
  onMobileClose 
}: SidebarProps) {
  const pathname = usePathname();
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    // Listen for auth state changes to get email
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user?.email) {
        setUserEmail(user.email);
      }
    });
    // Also check current user immediately
    if (auth.currentUser?.email) {
      setUserEmail(auth.currentUser.email);
    }
    return () => unsub();
  }, []);

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");

  const userInitials = userEmail?.slice(0, 2).toUpperCase() || "U";
  const displayName = getDisplayName(userEmail);
  const sidebarWidth = collapsed ? 72 : 260;

  return (
    <aside
      className={`portal-sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "open" : ""}`}
      style={{ width: sidebarWidth }}
    >
      {/* Brand */}
      <div 
        className="sidebar-brand"
        style={{ 
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
            height: collapsed ? "72px" : "96px", /* taller when expanded to fit larger logo */
          padding: collapsed ? "8px 16px" : "10px 16px",
          borderBottom: "1px solid rgba(184, 134, 11, 0.3)",
          background: "linear-gradient(90deg, rgba(184, 134, 11, 0.1) 0%, transparent 100%)",
          boxSizing: "border-box"
        }}
      >
        <Image
          src="/favikon.png"
          alt="Escl8"
          width={collapsed ? 40 : 245}
          height={collapsed ? 40 : 245}
          style={{ 
            objectFit: "contain",
            transition: "all 300ms cubic-bezier(0.4, 0, 0.2, 1)",
              maxHeight: collapsed ? "40px" : "92px", /* larger in expanded state (20% bigger) */
            transform: collapsed ? "none" : "translateY(0px)" /* slight nudge */
          }}
          priority
        />
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <div className="sidebar-nav-group">
          {!collapsed && <div className="sidebar-nav-label">Menu</div>}
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-nav-item ${isActive(item.href) ? "active" : ""}`}
              title={collapsed ? item.label : undefined}
              onClick={onMobileClose}
              style={{ position: "relative" }}
            >
              <span className="sidebar-nav-icon">{Icons[item.icon as keyof typeof Icons]}</span>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          ))}
        </div>

        <div className="sidebar-nav-group">
          {!collapsed && <div className="sidebar-nav-label">Quick Links</div>}
          <Link
            href="/"
            className="sidebar-nav-item"
            title={collapsed ? "Website" : undefined}
          >
            <span className="sidebar-nav-icon">{Icons.home}</span>
            {!collapsed && <span>Website</span>}
          </Link>
        </div>
      </nav>

      {/* Footer - User info with settings button */}
      <div className="sidebar-footer">
        {collapsed ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
            <div 
              className="avatar avatar-sm" 
              title={displayName}
              style={{ cursor: "default" }}
            >
              {userInitials}
            </div>
            <Link
              href="/portal/settings"
              className={`sidebar-nav-item ${isActive("/portal/settings") ? "active" : ""}`}
              title="Settings"
              onClick={onMobileClose}
              style={{ justifyContent: "center", width: "100%" }}
            >
              <span className="sidebar-nav-icon">{Icons.settings}</span>
            </Link>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 12px",
              borderRadius: 12,
              background: "linear-gradient(135deg, rgba(184, 134, 11, 0.15) 0%, rgba(0, 51, 160, 0.1) 100%)",
              border: "1px solid rgba(184, 134, 11, 0.2)",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
              <div className="avatar avatar-sm">{userInitials}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: "#f1f5f9",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {displayName}
                </div>
                {userEmail && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "#94a3b8",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {userEmail}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Link
                href="/portal/settings"
                className={`sidebar-settings-btn ${isActive("/portal/settings") ? "active" : ""}`}
                title="Settings"
                onClick={onMobileClose}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  color: isActive("/portal/settings") ? "#D4A84B" : "#94a3b8",
                  background: isActive("/portal/settings") 
                    ? "linear-gradient(135deg, rgba(184, 134, 11, 0.2) 0%, rgba(0, 51, 160, 0.15) 100%)"
                    : "rgba(15, 23, 42, 0.6)",
                  border: isActive("/portal/settings") 
                    ? "1px solid rgba(184, 134, 11, 0.4)"
                    : "1px solid rgba(255, 255, 255, 0.1)",
                  transition: "all 0.2s ease",
                  flexShrink: 0,
                }}
              >
                {Icons.settings}
              </Link>
              <button
                onClick={() => onCollapsedChange(true)}
                title="Collapse sidebar"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  color: "#94a3b8",
                  background: "rgba(15, 23, 42, 0.6)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  flexShrink: 0,
                }}
                aria-label="Collapse sidebar"
              >
                {Icons.chevronLeft}
              </button>
            </div>
          </div>
        )}

        {/* Collapsed state: show expand button */}
        {collapsed && (
          <button
            onClick={() => onCollapsedChange(false)}
            className="sidebar-collapse-btn"
            style={{
              width: "100%",
              marginTop: 8,
              transform: "rotate(180deg)",
            }}
            aria-label="Expand sidebar"
          >
            {Icons.chevronLeft}
          </button>
        )}
      </div>
    </aside>
  );
}
