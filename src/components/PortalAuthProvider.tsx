"use client";

import { ReactNode, useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { onAuthStateChanged, type User } from "firebase/auth";
import { useRouter } from "next/navigation";
import { trpc } from "@/utils/trpc";

type Props = { children: ReactNode };

export default function PortalAuthProvider({ children }: Props) {
  const auth = getFirebaseAuth();
  const [user, setUser] = useState<User | null | undefined>(() => (auth ? undefined : null));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { mutateAsync: ensureUser } = trpc.user.ensure.useMutation();

  useEffect(() => {
    if (!auth) return;
    let timeout: ReturnType<typeof setTimeout>;

    const unsub = onAuthStateChanged(auth, (u) => {
      clearTimeout(timeout);
      setUser(u);
    });
    // Fallback: if SDK never responds in 5s, treat as unauthenticated
    timeout = setTimeout(() => setUser(null), 5000);
    return () => {
      clearTimeout(timeout);
      unsub();
    };
  }, [auth]);

  useEffect(() => {
    setReady(false);
    setError(null);

    if (user === null) {
      router.replace("/portal");
      return;
    }
    if (!user) return;

    let cancelled = false;

    // Ensure there's a corresponding DB user row before protected pages run queries.
    (async () => {
      try {
        await user.getIdToken(true);
        const email = user.email;
        if (!email) throw new Error("Signed-in account is missing email.");
        await ensureUser({ email });
        if (!cancelled) setReady(true);
      } catch (e: unknown) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Failed to initialize your account.";
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
