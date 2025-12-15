"use client";

type Props = {
  selectedDate: string;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onDateChange: (value: string) => void;
};

export function BookingsHeader({ selectedDate, onPrevWeek, onNextWeek, onDateChange }: Props) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
      <h2>Bookings</h2>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn" onClick={onPrevWeek}>{"<"} Prev week</button>
        <input type="date" value={selectedDate} onChange={(e) => onDateChange(e.target.value)} />
        <button className="btn" onClick={onNextWeek}>Next week {">"}</button>
      </div>
    </div>
  );
}