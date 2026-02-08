"use client";

import { ReactNode, useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { onAuthStateChanged, type User } from "firebase/auth";
import { useRouter } from "next/navigation";
import { trpc } from "@/utils/trpc";

type Props = { children: ReactNode };

export default function PortalAuthProvider({ children }: Props) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const router = useRouter();
  const { mutateAsync: ensureUser } = trpc.user.ensure.useMutation();

  useEffect(() => {
    let timeout: any;
    const auth = getFirebaseAuth();
    if (!auth) {
      setUser(null);
      return () => {};
    }

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
  }, []);

  useEffect(() => {
    if (user === null) {
      router.replace("/portal");
      return;
    }
    if (!user) return;

    // Ensure there's a corresponding DB user row.
    (async () => {
      try {
        const email = user.email;
        if (email) {
          await ensureUser({ email });
        }
      } catch {
        // If the DB sync fails, do not block portal navigation; downstream pages can surface errors.
      }
    })();
  }, [user, router, ensureUser]);

  if (user === undefined) {
    return (
      <div className="container" style={{ padding: "60px 0 80px" }}>
        <p className="muted">Checking session…</p>
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
