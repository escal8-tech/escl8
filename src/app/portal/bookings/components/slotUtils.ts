import { Booking, Slot } from "./types";

type SlotConfig = {
  open: string;
  close: string;
  minutes: number;
  capacity?: number | null;
};

export function generateSlots(selectedDate: string, cfg: SlotConfig, bookings: Booking[]): Slot[] {
  const config = {
    cap: cfg.capacity ?? 0,
    minutes: cfg.minutes ?? 60,
    open: cfg.open ?? "09:00",
    close: cfg.close ?? "18:00",
  };

  const startOfWeek = new Date(selectedDate);
  // Move to Monday of the selected date's week
  const dayIdx = startOfWeek.getDay(); // 0 Sun .. 6 Sat
  const diffToMonday = dayIdx === 0 ? -6 : 1 - dayIdx;
  startOfWeek.setDate(startOfWeek.getDate() + diffToMonday);

  const weekDays: Date[] = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(startOfWeek);
    dt.setDate(startOfWeek.getDate() + i);
    return dt;
  });

  const all: Slot[] = [];

  for (const day of weekDays) {
    const [openH, openM] = config.open.split(":").map(Number);
    const [closeH, closeM] = config.close.split(":").map(Number);

    // build UTC-based day start/end
    const dayUTC = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()));
    const dayStart = new Date(
      Date.UTC(dayUTC.getUTCFullYear(), dayUTC.getUTCMonth(), dayUTC.getUTCDate(), openH, openM, 0, 0),
    );
    const dayEnd = new Date(
      Date.UTC(dayUTC.getUTCFullYear(), dayUTC.getUTCMonth(), dayUTC.getUTCDate(), closeH, closeM, 0, 0),
    );

    for (let t = new Date(dayStart); t < dayEnd; t = new Date(t.getTime() + config.minutes * 60000)) {
      const slotEnd = new Date(t.getTime() + config.minutes * 60000);
      const dayISO = dayUTC.toISOString().slice(0, 10);
      const slotBookings = bookings.filter((b) => {
        const bs = new Date(b.startTime);
        const be = new Date(bs.getTime() + (b.durationMinutes || config.minutes) * 60000);
        const bsTime = bs.getTime();
        const beTime = be.getTime();
        const tTime = t.getTime();
        const seTime = slotEnd.getTime();
        // overlap if booking starts before slot end AND booking ends after slot start
        return bsTime < seTime && beTime > tTime;
      });
      const count = slotBookings.reduce((sum, b) => sum + (b.unitsBooked || 1), 0);
      all.push({ dayISO, start: new Date(t), end: slotEnd, count, capacity: config.cap });
    }
  }

  return all;
}