export type Booking = {
  id: string;
  startTime: string | Date;
  durationMinutes?: number | null;
  unitsBooked?: number | null;
  phoneNumber?: string | null;
  notes?: string | null;
};

export type Slot = {
  dayISO: string;
  start: Date;
  end: Date;
  count: number;
  capacity: number;
};