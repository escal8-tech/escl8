"use client";

import { ReactNode, useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { onAuthStateChanged, type User } from "firebase/auth";
import { useRouter } from "next/navigation";

type Props = { children: ReactNode };

export default function PortalAuthProvider({ children }: Props) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const router = useRouter();

  useEffect(() => {
    let timeout: any;
    try {
      const auth = getFirebaseAuth();
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
    } catch (e) {
      // If Firebase init fails, fail closed and redirect
      setUser(null);
      return () => {};
    }
  }, []);

  useEffect(() => {
    if (user === null) {
      router.replace("/portal");
    }
  }, [user, router]);

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
