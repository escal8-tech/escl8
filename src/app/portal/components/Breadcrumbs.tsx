"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { getPortalTicketTypeLabel } from "@/app/portal/lib/ticketTypes";

const routeLabels: Record<string, string> = {
  dashboard: "Dashboard",
  requests: "Requests",
  customers: "Customers",
  messages: "Messages",
  upload: "Documents",
  bookings: "Bookings",
  orders: "Revenue",
  sync: "Sync",
  settings: "Settings",
  revenue: "Revenue",
};

export default function Breadcrumbs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const segments = (pathname || "").split("/").filter(Boolean);
  const leaf = segments[segments.length - 1] || "dashboard";
  const isTickets = pathname?.startsWith("/portal/tickets");

  const sectionLabel = isTickets ? "Tickets" : "Menu";
  const ticketType = (searchParams?.get("type") || "").toLowerCase();
  const currentTitle = isTickets
    ? getPortalTicketTypeLabel(ticketType)
    : routeLabels[leaf] || leaf.charAt(0).toUpperCase() + leaf.slice(1);

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol className="breadcrumbs-list">
        <li className="breadcrumbs-item">
          <Link href="/portal/dashboard" className="breadcrumbs-link">
            Portal
          </Link>
        </li>
        <li className="breadcrumbs-item">
          <span className="breadcrumbs-separator">
            <ChevronRightIcon />
          </span>
          <span className="breadcrumbs-current">{sectionLabel}</span>
        </li>
      </ol>
      
      {/* Current page title in gold */}
      <h1 className="breadcrumbs-page-title">{currentTitle}</h1>
    </nav>
  );
}

function ChevronRightIcon() {
  return (
    <svg 
      width="14" 
      height="14" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
