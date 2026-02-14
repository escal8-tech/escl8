"use client";
import { usePathname } from "next/navigation";
import PortalNav from "@/components/PortalNav";
import PortalAuthProvider from "@/components/PortalAuthProvider";
import { PhoneFilterProvider } from "@/components/PhoneFilterContext";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname === "/portal" || pathname?.startsWith("/portal/signup");
  const isMessagesPage = pathname?.startsWith("/portal/messages");
  const isFlushPage =
    pathname?.startsWith("/portal/customers") ||
    pathname?.startsWith("/portal/messages") ||
    pathname?.startsWith("/portal/tickets") ||
    pathname?.startsWith("/portal/requests");

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
            <div className={`portal-content${isFlushPage ? " portal-content--flush" : ""}${isMessagesPage ? " portal-content--flush-messages" : ""}`}>
              {children}
            </div>
          </main>
        </div>
      </PhoneFilterProvider>
    </PortalAuthProvider>
  );
}
