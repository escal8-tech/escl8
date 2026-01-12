"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Map of route segments to display labels
const routeLabels: Record<string, string> = {
  portal: "Portal",
  dashboard: "Dashboard",
  upload: "Documents",
  bookings: "Bookings",
  sync: "WhatsApp Sync",
  settings: "Settings",
  signup: "Sign Up",
};

interface BreadcrumbItem {
  label: string;
  href: string;
  isLast: boolean;
}

export default function Breadcrumbs() {
  const pathname = usePathname();
  
  // Build breadcrumb items from pathname
  const buildBreadcrumbs = (): BreadcrumbItem[] => {
    if (!pathname) return [];
    
    const segments = pathname.split("/").filter(Boolean);
    const breadcrumbs: BreadcrumbItem[] = [];
    
    // Skip the first segment if it's "portal" since we start from there
    let currentPath = "";
    
    segments.forEach((segment, index) => {
      currentPath += `/${segment}`;
      const label = routeLabels[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);
      
      breadcrumbs.push({
        label,
        href: currentPath,
        isLast: index === segments.length - 1,
      });
    });
    
    return breadcrumbs;
  };

  const breadcrumbs = buildBreadcrumbs();
  const currentPage = breadcrumbs[breadcrumbs.length - 1];

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol className="breadcrumbs-list">
        {breadcrumbs.map((crumb, index) => (
          <li key={crumb.href} className="breadcrumbs-item">
            {index > 0 && (
              <span className="breadcrumbs-separator">
                <ChevronRightIcon />
              </span>
            )}
            {crumb.isLast ? (
              <span className="breadcrumbs-current">{crumb.label}</span>
            ) : (
              <Link href={crumb.href} className="breadcrumbs-link">
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
      
      {/* Current page title in gold */}
      {currentPage && (
        <h1 className="breadcrumbs-page-title">{currentPage.label}</h1>
      )}
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
