"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { signOut } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";

// SVG Icons as components - properly sized
const Icons = {
  dashboard: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
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
  logout: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  chevronLeft: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
  menu: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
  bell: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  search: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
};

const navItems = [
  { href: "/portal/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/portal/upload", label: "Documents", icon: "upload" },
  { href: "/portal/bookings", label: "Bookings", icon: "calendar" },
  { href: "/portal/sync", label: "WhatsApp Sync", icon: "sync" },
  { href: "/portal/settings", label: "Settings", icon: "settings" },
];

export default function PortalNav() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    try {
      const auth = getFirebaseAuth();
      setUserEmail(auth.currentUser?.email ?? null);
    } catch {}
  }, []);

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");

  const handleLogout = async () => {
    try {
      const auth = getFirebaseAuth();
      await signOut(auth);
      window.location.href = "/portal";
    } catch {}
  };

  const userInitials = userEmail?.slice(0, 2).toUpperCase() || "U";
  const sidebarWidth = collapsed ? 72 : 260;

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={`drawer-backdrop ${mobileOpen ? "open" : ""}`}
        onClick={() => setMobileOpen(false)}
      />

      {/* Sidebar */}
      <aside
        className={`portal-sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "open" : ""}`}
        style={{ width: sidebarWidth }}
      >
        {/* Brand */}
        <div className="sidebar-brand">
          <Link href="/portal/dashboard" className="sidebar-brand-logo">
            <Image
              src="/8.png"
              alt="Escl8"
              width={collapsed ? 40 : 120}
              height={38}
              style={{ objectFit: "contain" }}
            />
          </Link>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="sidebar-collapse-btn"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            style={{ display: collapsed ? "none" : "flex" }}
          >
            {Icons.chevronLeft}
          </button>
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
                onClick={() => setMobileOpen(false)}
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

        {/* Footer */}
        <div className="sidebar-footer">
          {/* User section */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: collapsed ? 0 : 12,
              padding: 10,
              borderRadius: 12,
              marginBottom: 12,
              background: "linear-gradient(135deg, rgba(184, 134, 11, 0.15) 0%, rgba(0, 51, 160, 0.1) 100%)",
              border: "1px solid rgba(184, 134, 11, 0.2)",
              justifyContent: collapsed ? "center" : "flex-start",
            }}
          >
            <div className="avatar avatar-sm">{userInitials}</div>
            {!collapsed && (
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
                  {userEmail || "User"}
                </div>
              </div>
            )}
          </div>

          {/* Logout button */}
          <button
            onClick={handleLogout}
            className="sidebar-nav-item"
            style={{
              width: "100%",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              background: "rgba(239, 68, 68, 0.1)",
              color: "#f87171",
              cursor: "pointer",
              justifyContent: collapsed ? "center" : "flex-start",
              borderRadius: 10,
            }}
            title={collapsed ? "Log out" : undefined}
          >
            <span className="sidebar-nav-icon">{Icons.logout}</span>
            {!collapsed && <span>Log out</span>}
          </button>

          {/* Collapsed state: show expand button */}
          {collapsed && (
            <button
              onClick={() => setCollapsed(false)}
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

      {/* Top bar */}
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
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Mobile menu button */}
          <button
            className="btn btn-ghost btn-icon mobile-menu-btn"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            style={{ display: "none", color: "#f1f5f9" }}
          >
            {Icons.menu}
          </button>

          {/* Search */}
          <div 
            className="portal-search"
            style={{
              background: "linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(26, 31, 46, 0.8) 100%)",
              border: "1px solid rgba(184, 134, 11, 0.25)",
            }}
          >
            {Icons.search}
            <input type="text" placeholder="Search..." style={{ color: "#f1f5f9", background: "transparent" }} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button 
            className="btn btn-ghost btn-icon" 
            aria-label="Notifications"
            style={{ 
              color: "#f1f5f9", 
              border: "1px solid rgba(184, 134, 11, 0.2)",
              background: "linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(26, 31, 46, 0.8) 100%)",
            }}
          >
            {Icons.bell}
          </button>
        </div>
      </header>

      {/* Add responsive styles */}
      <style jsx global>{`
        @media (max-width: 1024px) {
          .portal-sidebar {
            width: 72px !important;
          }
          .portal-sidebar .sidebar-brand-name,
          .portal-sidebar .sidebar-nav-label,
          .portal-sidebar .sidebar-nav-item span:not(.sidebar-nav-icon) {
            display: none;
          }
          .portal-sidebar .sidebar-nav-item {
            justify-content: center;
          }
          .portal-sidebar .sidebar-collapse-btn {
            display: none !important;
          }
          .portal-topbar {
            margin-left: 72px !important;
            width: calc(100% - 72px) !important;
          }
          .portal-main {
            margin-left: 72px !important;
          }
        }

        @media (max-width: 768px) {
          .portal-sidebar {
            position: fixed;
            transform: translateX(-100%);
            width: 260px !important;
            z-index: 500;
          }
          .portal-sidebar.open {
            transform: translateX(0);
          }
          .portal-sidebar .sidebar-brand-name,
          .portal-sidebar .sidebar-nav-label,
          .portal-sidebar .sidebar-nav-item span:not(.sidebar-nav-icon) {
            display: initial;
          }
          .portal-sidebar .sidebar-nav-item {
            justify-content: flex-start;
          }
          .portal-topbar {
            margin-left: 0 !important;
            width: 100% !important;
          }
          .portal-main {
            margin-left: 0 !important;
          }
          .mobile-menu-btn {
            display: flex !important;
          }
          .portal-search {
            display: none !important;
          }
        }
      `}</style>
    </>
  );
}
