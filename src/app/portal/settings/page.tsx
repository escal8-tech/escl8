"use client";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { trpc } from "@/utils/trpc";
import Link from "next/link";

export default function SettingsPage() {
  const auth = getFirebaseAuth();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setEmail(user?.email ?? null);
    });
    return () => unsub();
  }, [auth]);

  const userQuery = trpc.user.getMe.useQuery({ email: email ?? "" }, { enabled: !!email });
  const upsert = trpc.user.upsert.useMutation();
  const phone = userQuery.data?.phoneNumber ?? null;
  const [unitCapacity, setUnitCapacity] = useState<number | undefined>(undefined);
  const [timeslotMinutes, setTimeslotMinutes] = useState<number | undefined>(undefined);
  const [openTime, setOpenTime] = useState<string | undefined>(undefined);
  const [closeTime, setCloseTime] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (userQuery.data) {
      setUnitCapacity(userQuery.data.unitCapacity ?? undefined);
      setTimeslotMinutes(userQuery.data.timeslotMinutes ?? undefined);
      setOpenTime(userQuery.data.openTime ?? undefined);
      setCloseTime(userQuery.data.closeTime ?? undefined);
    }
  }, [userQuery.data]);

  const handleLogout = async () => {
    await signOut(auth);
    window.location.href = "/portal"; // go back to login
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Settings</h2>
      <div className="glass" style={{ padding: 18, marginTop: 12, display:'grid', gap: 10 }}>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Logged in email</div>
          <div style={{ fontWeight: 600 }}>{email || "—"}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Phone number</div>
          <div style={{ fontWeight: 600 }}>{phone || "—"}</div>
        </div>
        <div style={{ display:'flex', gap: 10, marginTop: 8 }}>
          <button className="btn" onClick={handleLogout}>Log out</button>
          <Link className="btn" href="/portal/dashboard">Back to Dashboard</Link>
        </div>
        <hr style={{ margin: '14px 0', borderColor: 'var(--border)' }} />
        <div style={{ display:'grid', gap:10 }}>
          <div style={{ fontWeight:600 }}>Booking settings</div>
          <label style={{ display:'grid', gridTemplateColumns:'160px 1fr', alignItems:'center', gap:10 }}>
            <span>Unit capacity</span>
            <input type="number" min={1} value={unitCapacity ?? ''} onChange={e => setUnitCapacity(e.target.value === '' ? undefined : parseInt(e.target.value))} className="contact-input" placeholder="" />
          </label>
          <label style={{ display:'grid', gridTemplateColumns:'160px 1fr', alignItems:'center', gap:10 }}>
            <span>Timeslot minutes</span>
            <input type="number" min={5} max={600} value={timeslotMinutes ?? ''} onChange={e => setTimeslotMinutes(e.target.value === '' ? undefined : parseInt(e.target.value))} className="contact-input" placeholder="" />
          </label>
          <label style={{ display:'grid', gridTemplateColumns:'160px 1fr', alignItems:'center', gap:10 }}>
            <span>Open time</span>
            <input type="time" value={openTime ?? ''} onChange={e => setOpenTime(e.target.value || undefined)} className="contact-input" />
          </label>
          <label style={{ display:'grid', gridTemplateColumns:'160px 1fr', alignItems:'center', gap:10 }}>
            <span>Close time</span>
            <input type="time" value={closeTime ?? ''} onChange={e => setCloseTime(e.target.value || undefined)} className="contact-input" />
          </label>
          <div>
            <button className="btn btn-primary" onClick={() => email && upsert.mutate({ email, unitCapacity, timeslotMinutes, openTime, closeTime })}>Save settings</button>
          </div>
        </div>
      </div>
    </div>
  );
}
