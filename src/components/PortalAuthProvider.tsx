"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { getFirebaseIdTokenOrThrow } from "@/lib/client-auth-ops";
import { isClientErrorReported } from "@/lib/client-business-monitoring";
import { APP_ACCESS_ROUTE, APP_LOGIN_ROUTE, isAppPath } from "@/lib/app-routes";
import { onAuthStateChanged, type User } from "firebase/auth";
import { usePathname, useRouter } from "next/navigation";
import { trpc } from "@/utils/trpc";
import { captureSentryException, recordSentryMetric, updateSentryScope } from "@/lib/sentry-monitoring";

type Props = { children: ReactNode };

export default function PortalAuthProvider({ children }: Props) {
  const auth = getFirebaseAuth();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const router = useRouter();
  const { mutateAsync: ensureUser } = trpc.user.ensure.useMutation();

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!auth) {
      setUser(null);
      return;
    }
    const timeout = setTimeout(() => setUser(null), 5000);

    const unsub = onAuthStateChanged(auth, (u) => {
      clearTimeout(timeout);
      setUser(u);
    });
    return () => {
      clearTimeout(timeout);
      unsub();
    };
  }, [auth]);

  useEffect(() => {
    updateSentryScope({
      route: pathname || null,
      surface: isAppPath(pathname) ? "portal" : "site",
      user: user
        ? {
            email: user.email ?? null,
            id: user.uid ?? null,
            username: user.displayName ?? null,
          }
        : null,
    });
  }, [pathname, user]);

  useEffect(() => {
    setReady(false);
    setError(null);

    if (user === null) {
      router.replace(APP_LOGIN_ROUTE);
      return;
    }
    if (!user) return;

    let cancelled = false;

    // Ensure there's a corresponding DB user row before protected pages run queries.
    (async () => {
      try {
        const idToken = await getFirebaseIdTokenOrThrow({
          action: "portal.auth.ensureUser",
          area: "auth",
          attributes: {
            firebase_uid: user.uid ?? undefined,
          },
          freshToken: true,
          missingConfigEvent: "auth.user_bootstrap_failed",
          missingSessionEvent: "auth.user_bootstrap_session_missing",
          route: pathnameRef.current ?? APP_LOGIN_ROUTE,
          tokenFailureEvent: "auth.user_bootstrap_failed",
        });
        const email = user.email;
        if (!email) throw new Error("Signed-in account is missing email.");
        await ensureUser({ email });
        const statusRes = await fetch("/api/auth/status", {
          headers: { authorization: `Bearer ${idToken}` },
          cache: "no-store",
        });
        const status = statusRes.ok ? await statusRes.json().catch(() => null) : null;
        if (status?.accessBlocked && status?.workspaceMode === "blocked") {
          router.replace(APP_ACCESS_ROUTE);
          return;
        }
        if (!cancelled) setReady(true);
      } catch (e: unknown) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Failed to initialize your account.";
        recordSentryMetric("count", "escl8.auth.ensure_user_error", 1, {
          area: "auth",
          route: pathnameRef.current,
        });
        if (!isClientErrorReported(e)) {
          captureSentryException(e, {
            action: "portal-auth-ensure-user",
            area: "auth",
            contexts: {
              auth: {
                email: user.email ?? null,
                firebaseUid: user.uid ?? null,
                route: pathnameRef.current ?? null,
              },
            },
            level: "error",
            tags: {
              "auth.route": pathnameRef.current ?? null,
            },
          });
        }
        setError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, router, ensureUser]);

  if (user === undefined) {
    return (
      <div className="container" style={{ padding: "60px 0 80px" }}>
        <p className="muted">Checking session…</p>
      </div>
    );
  }

  if (!user) return null;
  if (error) {
    return (
      <div className="container" style={{ padding: "60px 0 80px" }}>
        <p style={{ color: "var(--danger)" }}>Account setup failed: {error}</p>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="container" style={{ padding: "60px 0 80px" }}>
        <p className="muted">Preparing your workspace…</p>
      </div>
    );
  }

  return <>{children}</>;
}
