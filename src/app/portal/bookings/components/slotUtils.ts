import { Booking, Slot } from "./types";

type SlotConfig = {
  open?: string;
  close?: string;
  minutes: number;
  capacity?: number | null;
};

function normalizeTimeZone(timeZone?: string | null): string {
  const candidate = String(timeZone || "").trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

function parseDateKey(dateKey: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || "").trim());
  if (!match) {
    const now = new Date();
    return {
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
      day: now.getUTCDate(),
    };
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function toDateKey(parts: { year: number; month: number; day: number }): string {
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const { year, month, day } = parseDateKey(dateKey);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toDateKey({
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  });
}

function getWeekdayIndex(dateKey: string): number {
  const { year, month, day } = parseDateKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function getWeekDateKeys(selectedDate: string): string[] {
  const dayIdx = getWeekdayIndex(selectedDate);
  const diffToMonday = dayIdx === 0 ? -6 : 1 - dayIdx;
  const monday = addDaysToDateKey(selectedDate, diffToMonday);
  return Array.from({ length: 7 }, (_, i) => addDaysToDateKey(monday, i));
}

function getTimeZoneParts(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const out: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") out[part.type] = part.value;
  }
  return out;
}

function getTimeZoneOffsetMillis(date: Date, timeZone: string): number {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(dateKey: string, hour: number, minute: number, timeZone: string): Date {
  const { year, month, day } = parseDateKey(dateKey);
  const guessMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const first = new Date(guessMs - getTimeZoneOffsetMillis(new Date(guessMs), timeZone));
  return new Date(guessMs - getTimeZoneOffsetMillis(first, timeZone));
}

function parseHHMM(value: string, fallbackMinutes: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return fallbackMinutes;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallbackMinutes;
  return Math.max(0, hours * 60 + minutes);
}

function formatMinutesLabel(minutes: number): string {
  const safe = ((minutes % 1440) + 1440) % 1440;
  const hh = Math.floor(safe / 60);
  const mm = safe % 60;
  return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
}

export function getTodayDateKeyInTimeZone(timeZone?: string | null): string {
  const parts = getTimeZoneParts(new Date(), normalizeTimeZone(timeZone));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getDateKeyInTimeZone(date: Date | string, timeZone?: string | null): string {
  const input = date instanceof Date ? date : new Date(date);
  const parts = getTimeZoneParts(input, normalizeTimeZone(timeZone));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatDateKey(
  dateKey: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  const { year, month, day } = parseDateKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    timeZone: "UTC",
    ...options,
  });
}

export function formatTimeInTimeZone(date: Date | string, timeZone?: string | null, hour12 = false): string {
  const input = date instanceof Date ? date : new Date(date);
  return input.toLocaleTimeString([], {
    timeZone: normalizeTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    hour12,
  });
}

export function generateSlots(
  selectedDate: string,
  cfg: SlotConfig,
  bookings: Booking[],
  timeZone?: string | null,
): Slot[] {
  if (!cfg.open || !cfg.close) {
    return [];
  }
  const config = {
    cap: cfg.capacity ?? 0,
    minutes: cfg.minutes ?? 60,
    open: cfg.open,
    close: cfg.close,
  };
  const tz = normalizeTimeZone(timeZone);
  const weekDays = getWeekDateKeys(selectedDate);
  const openMinutes = parseHHMM(config.open, Number.NaN);
  const closeMinutes = parseHHMM(config.close, Number.NaN);
  if (!Number.isFinite(openMinutes) || !Number.isFinite(closeMinutes)) {
    return [];
  }
  const closingBoundary = closeMinutes > openMinutes ? closeMinutes : openMinutes + config.minutes;

  const all: Slot[] = [];

  for (const day of weekDays) {
    for (let minutes = openMinutes; minutes < closingBoundary; minutes += config.minutes) {
      const dayOffset = Math.floor(minutes / 1440);
      const slotDay = dayOffset > 0 ? addDaysToDateKey(day, dayOffset) : day;
      const normalizedMinutes = ((minutes % 1440) + 1440) % 1440;
      const hour = Math.floor(normalizedMinutes / 60);
      const minute = normalizedMinutes % 60;
      const slotStart = zonedDateTimeToUtc(slotDay, hour, minute, tz);
      const slotEnd = new Date(slotStart.getTime() + config.minutes * 60000);
      const slotBookings = bookings.filter((b) => {
        const bs = new Date(b.startTime);
        const be = new Date(bs.getTime() + (b.durationMinutes || config.minutes) * 60000);
        return bs.getTime() < slotEnd.getTime() && be.getTime() > slotStart.getTime();
      });
      const count = slotBookings.reduce((sum, b) => sum + (b.unitsBooked || 1), 0);
      all.push({
        dayISO: slotDay,
        start: slotStart,
        end: slotEnd,
        count,
        capacity: config.cap,
        label: formatMinutesLabel(minutes),
        minutesStart: minutes,
      });
    }
  }

  return all;
}
