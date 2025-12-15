"use client";
import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/utils/trpc";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { onAuthStateChanged } from "firebase/auth";
import { BookingsHeader } from "./components/BookingsHeader";
import { SlotsGrid } from "./components/SlotsGrid";
import { generateSlots } from "./components/slotUtils";
import type { Booking } from "./components/types";

export default function BookingsPage() {
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [email, setEmail] = useState<string | null>(null);
  const biz = trpc.business.getMine.useQuery({ email: email || "" }, { enabled: !!email });
  const bookings = trpc.bookings.list.useQuery({ businessId: biz.data?.id ?? "" }, { enabled: !!biz.data?.id });

  // Get email from Firebase Auth in production reliably
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const auth = getFirebaseAuth();
      const unsub = onAuthStateChanged(auth, (u) => {
        const em = u?.email || window.localStorage.getItem("lastEmail") || null;
        if (em) {
          setEmail(em);
          try {
            window.localStorage.setItem("lastEmail", em);
          } catch {}
        }
      });
      return () => unsub();
    } catch {
      const em = window.localStorage.getItem("lastEmail");
      if (em) setEmail(em);
    }
  }, []);

  const slots = useMemo(() => {
    return generateSlots(
      selectedDate,
      {
        open: biz.data?.bookingOpenTime ?? "09:00",
        close: biz.data?.bookingCloseTime ?? "18:00",
        minutes: biz.data?.bookingTimeslotMinutes ?? 60,
        capacity: biz.data?.bookingUnitCapacity,
      },
      normalizeBookings(bookings.data || []),
    );
  }, [bookings.data, biz.data, selectedDate]);

  const goPrevWeek = () => setSelectedDate(new Date(new Date(selectedDate).getTime() - 7 * 86400000).toISOString().slice(0, 10));
  const goNextWeek = () => setSelectedDate(new Date(new Date(selectedDate).getTime() + 7 * 86400000).toISOString().slice(0, 10));

  return (
    <div style={{ padding: 20 }}>
      <BookingsHeader
        selectedDate={selectedDate}
        onPrevWeek={goPrevWeek}
        onNextWeek={goNextWeek}
        onDateChange={setSelectedDate}
      />

      <SlotsGrid
        slots={slots}
        bookings={normalizeBookings(bookings.data || [])}
        bookingUnitCapacity={biz.data?.bookingUnitCapacity ?? 0}
        bookingTimeslotMinutes={biz.data?.bookingTimeslotMinutes ?? 60}
      />
    </div>
  );
}

function normalizeBookings(bookings: any[]): Booking[] {
  return bookings.map((b) => ({
    ...b,
    startTime: b.startTime instanceof Date ? b.startTime.toISOString() : b.startTime,
  }));
}
