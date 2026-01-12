"use client";

import { useState } from "react";
import Sidebar from "@/app/portal/components/Sidebar";
import TopBar from "@/app/portal/components/TopBar";

export default function PortalNav() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebarWidth = collapsed ? 72 : 260;

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={`drawer-backdrop ${mobileOpen ? "open" : ""}`}
        onClick={() => setMobileOpen(false)}
      />

      {/* Sidebar */}
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCollapsedChange={setCollapsed}
        onMobileClose={() => setMobileOpen(false)}
      />

      {/* Top bar */}
      <TopBar
        sidebarWidth={sidebarWidth}
        onMobileMenuOpen={() => setMobileOpen(true)}
      />

      {/* Responsive styles */}
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
          .breadcrumbs {
            display: none !important;
          }
        }
      `}</style>
    </>
  );
}
