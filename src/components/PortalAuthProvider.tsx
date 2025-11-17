"use client";

import { ReactNode, useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { onAuthStateChanged, type User } from "firebase/auth";
import { useRouter } from "next/navigation";

type Props = { children: ReactNode };

export default function PortalAuthProvider({ children }: Props) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [devAdmin, setDevAdmin] = useState<boolean>(false);
  const router = useRouter();

  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    // Check for dev admin cookie to allow platform access without Firebase
    if (typeof document !== "undefined") {
      const has = document.cookie.split(";").some((p) => p.trim().startsWith("dev_admin="));
      setDevAdmin(has);
    }
  }, []);

  useEffect(() => {
    if (user === null && !devAdmin) {
      router.replace("/portal");
    }
  }, [user, devAdmin, router]);

  if (user === undefined && !devAdmin) {
    return (
      <div className="container" style={{ padding: "60px 0 80px" }}>
        <p className="muted">Checking session…</p>
      </div>
    );
  }

  if (!user && !devAdmin) return null;

  return <>{children}</>;
}
