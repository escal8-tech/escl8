"use client";
import { usePathname } from "next/navigation";
import PortalNav from "@/components/PortalNav";
import PortalAuthProvider from "@/components/PortalAuthProvider";
import { PhoneFilterProvider } from "@/components/PhoneFilterContext";
import PortalLiveDocumentToasts from "@/app/portal/components/PortalLiveDocumentToasts";
import { isAppAuthPath, isAppFlushPath, normalizeAppPath } from "@/lib/app-routes";
import {
  PortalThemeProvider,
  usePortalTheme,
} from "@/app/portal/components/PortalThemeProvider";

function PortalLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme } = usePortalTheme();
  const appPath = normalizeAppPath(pathname);
  const isAuthPage = isAppAuthPath(appPath);
  const isMessagesPage = appPath === "/messages" || appPath.startsWith("/messages/");
  const isFlushPage = isAppFlushPath(appPath);
  const isWorkbenchDetailPage =
    appPath.startsWith("/ticket/")
    || appPath.startsWith("/tickets/")
    || appPath.startsWith("/orders/")
    || appPath.startsWith("/payments/")
    || appPath.startsWith("/status/")
    || appPath.startsWith("/revenue/");

  if (isAuthPage) {
    // Login/Signup should not be guarded and typically shouldn't show PortalNav
    return <>{children}</>;
  }

  // Protected portal routes: show nav and require auth
  return (
    <PortalAuthProvider>
      <PhoneFilterProvider>
        <PortalLiveDocumentToasts />
        <div className="portal-layout" data-theme={theme} suppressHydrationWarning>
          <PortalNav />
          <main className={`portal-main portal-main--with-topbar${isWorkbenchDetailPage ? " portal-main--workbench-detail" : ""}`}>
            <div className={`portal-content${isFlushPage ? " portal-content--flush" : ""}${isMessagesPage ? " portal-content--flush-messages" : ""}${isWorkbenchDetailPage ? " portal-content--workbench-detail" : ""}`}>
              {children}
            </div>
          </main>
        </div>
      </PhoneFilterProvider>
    </PortalAuthProvider>
  );
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalThemeProvider>
      <PortalLayoutShell>{children}</PortalLayoutShell>
    </PortalThemeProvider>
  );
}
