"use client";
import { usePathname } from "next/navigation";
import PortalNav from "@/components/PortalNav";
import PortalAuthProvider from "@/components/PortalAuthProvider";
import { PhoneFilterProvider } from "@/components/PhoneFilterContext";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname === "/portal" || pathname?.startsWith("/portal/signup");
  const isFlushPage = pathname?.startsWith("/portal/customers");

  if (isAuthPage) {
    // Login/Signup should not be guarded and typically shouldn't show PortalNav
    return <>{children}</>;
  }

  // Protected portal routes: show nav and require auth
  return (
    <PortalAuthProvider>
      <PhoneFilterProvider>
        <div className="portal-layout">
          <PortalNav />
          <main className="portal-main" style={{ paddingTop: 72 }}>
            <div className={`portal-content${isFlushPage ? " portal-content--flush" : ""}`}>
              {children}
            </div>
          </main>
        </div>
      </PhoneFilterProvider>
    </PortalAuthProvider>
  );
}
