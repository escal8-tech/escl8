"use client";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { trpc } from "@/utils/trpc";
import { SettingsHeader } from "./components/SettingsHeader";
import { ProfileCard } from "./components/ProfileCard";
import { BookingSettingsForm } from "./components/BookingSettingsForm";

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
  const businessQuery = trpc.business.getMine.useQuery({ email: email ?? "" }, { enabled: !!email });
  const updateBooking = trpc.business.updateBookingConfig.useMutation();
  const [unitCapacity, setUnitCapacity] = useState<number | undefined>(undefined);
  const [timeslotMinutes, setTimeslotMinutes] = useState<number | undefined>(undefined);
  const [openTime, setOpenTime] = useState<string | undefined>(undefined);
  const [closeTime, setCloseTime] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (businessQuery.data) {
      setUnitCapacity(businessQuery.data.bookingUnitCapacity ?? undefined);
      setTimeslotMinutes(businessQuery.data.bookingTimeslotMinutes ?? undefined);
      setOpenTime(businessQuery.data.bookingOpenTime ?? undefined);
      setCloseTime(businessQuery.data.bookingCloseTime ?? undefined);
    }
  }, [businessQuery.data]);

  const handleLogout = async () => {
    await signOut(auth);
    window.location.href = "/portal"; // go back to login
  };

  return (
    <div style={{ padding: 20, display: "grid", gap: 14 }}>
      <SettingsHeader />
      <ProfileCard email={email} onLogout={handleLogout} />
      <BookingSettingsForm
        unitCapacity={unitCapacity}
        timeslotMinutes={timeslotMinutes}
        openTime={openTime}
        closeTime={closeTime}
        onChange={(field, value) => {
          if (field === "unitCapacity") setUnitCapacity(value as number | undefined);
          if (field === "timeslotMinutes") setTimeslotMinutes(value as number | undefined);
          if (field === "openTime") setOpenTime(value as string | undefined);
          if (field === "closeTime") setCloseTime(value as string | undefined);
        }}
        onSave={() => {
          if (!email || !businessQuery.data?.id) return;
          if (unitCapacity == null || timeslotMinutes == null || !openTime || !closeTime) return;
          updateBooking.mutate({
            email,
            businessId: businessQuery.data.id,
            unitCapacity,
            timeslotMinutes,
            openTime,
            closeTime,
          });
        }}
      />
    </div>
  );
}
