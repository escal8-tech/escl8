"use client";

type Props = {
  unitCapacity: number | undefined;
  timeslotMinutes: number | undefined;
  openTime: string | undefined;
  closeTime: string | undefined;
  onChange: (field: "unitCapacity" | "timeslotMinutes" | "openTime" | "closeTime", value: number | string | undefined) => void;
  onSave: () => void;
};

export function BookingSettingsForm({ unitCapacity, timeslotMinutes, openTime, closeTime, onChange, onSave }: Props) {
  return (
    <div className="glass" style={{ padding: 18, display: "grid", gap: 12 }}>
      <div style={{ fontWeight: 600 }}>Booking settings</div>
      <label style={{ display: "grid", gridTemplateColumns: "160px 1fr", alignItems: "center", gap: 10 }}>
        <span>Unit capacity</span>
        <input
          type="number"
          min={1}
          value={unitCapacity ?? ""}
          onChange={(e) => onChange("unitCapacity", e.target.value === "" ? undefined : parseInt(e.target.value))}
          className="contact-input"
          placeholder=""
        />
      </label>
      <label style={{ display: "grid", gridTemplateColumns: "160px 1fr", alignItems: "center", gap: 10 }}>
        <span>Timeslot minutes</span>
        <input
          type="number"
          min={5}
          max={600}
          value={timeslotMinutes ?? ""}
          onChange={(e) => onChange("timeslotMinutes", e.target.value === "" ? undefined : parseInt(e.target.value))}
          className="contact-input"
          placeholder=""
        />
      </label>
      <label style={{ display: "grid", gridTemplateColumns: "160px 1fr", alignItems: "center", gap: 10 }}>
        <span>Open time</span>
        <input
          type="time"
          value={openTime ?? ""}
          onChange={(e) => onChange("openTime", e.target.value || undefined)}
          className="contact-input"
        />
      </label>
      <label style={{ display: "grid", gridTemplateColumns: "160px 1fr", alignItems: "center", gap: 10 }}>
        <span>Close time</span>
        <input
          type="time"
          value={closeTime ?? ""}
          onChange={(e) => onChange("closeTime", e.target.value || undefined)}
          className="contact-input"
        />
      </label>
      <div>
        <button className="btn btn-primary" onClick={onSave}>Save settings</button>
      </div>
    </div>
  );
}
