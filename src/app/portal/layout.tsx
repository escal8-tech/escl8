"use client";
import { usePathname } from "next/navigation";
import PortalNav from "@/components/PortalNav";
import PortalAuthProvider from "@/components/PortalAuthProvider";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname === "/portal" || pathname?.startsWith("/portal/signup");

  if (isAuthPage) {
    // Login/Signup should not be guarded and typically shouldn't show PortalNav
    return <>{children}</>;
  }

  // Protected portal routes: show nav and require auth
  return (
    <div className="portal-layout">
      <PortalNav />
      <main className="portal-main" style={{ paddingTop: 64 }}>
        <PortalAuthProvider>
          <div className="portal-content">
            {children}
          </div>
        </PortalAuthProvider>
      </main>
    </div>
  );
}
