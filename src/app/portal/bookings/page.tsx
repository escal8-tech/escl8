"use client";
import { useState, useMemo } from "react";
import { trpc } from "@/utils/trpc";

type Slot = { dayISO: string; start: Date; end: Date; count: number; capacity: number };

export default function BookingsPage() {
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0,10));
  const bookings = trpc.bookings.list.useQuery();
  const me = trpc.user.getMe.useQuery({ email: typeof window !== 'undefined' ? (window.localStorage.getItem('lastEmail') || '') : '' }, { enabled: typeof window !== 'undefined' });

  const slots = useMemo<Slot[]>(() => {
    const cfg = {
      cap: me.data?.unitCapacity ?? 1,
      minutes: me.data?.timeslotMinutes ?? 60,
      open: me.data?.openTime ?? '09:00',
      close: me.data?.closeTime ?? '18:00'
    };
    const [y, m, d] = selectedDate.split('-').map(x=>parseInt(x));
    const startOfWeek = new Date(selectedDate);
    // Move to Monday of the selected date's week
    const dayIdx = startOfWeek.getDay(); // 0 Sun .. 6 Sat
    const diffToMonday = (dayIdx === 0) ? -6 : (1 - dayIdx);
    startOfWeek.setDate(startOfWeek.getDate() + diffToMonday);
    const weekDays: Date[] = Array.from({length:7}, (_,i)=>{
      const dt = new Date(startOfWeek);
      dt.setDate(startOfWeek.getDate()+i);
      return dt;
    });
    // Build slots per day based on open/close and duration
    const all: Slot[] = [];
    for (const day of weekDays) {
      const [openH, openM] = cfg.open.split(':').map(Number);
      const [closeH, closeM] = cfg.close.split(':').map(Number);
      const dayStart = new Date(day); dayStart.setHours(openH, openM, 0, 0);
      const dayEnd = new Date(day); dayEnd.setHours(closeH, closeM, 0, 0);
      for (let t = new Date(dayStart); t < dayEnd; t = new Date(t.getTime() + cfg.minutes*60000)) {
        const slotEnd = new Date(t.getTime() + cfg.minutes*60000);
        const dayISO = day.toISOString().slice(0,10);
        const count = (bookings.data||[]).filter(b => {
          const bs = new Date(b.startTime);
          const be = new Date(bs.getTime() + (b.durationMinutes||cfg.minutes)*60000);
          return bs >= t && be <= slotEnd; // simplistic: booking fully inside slot
        }).reduce((sum,b)=> sum + (b.unitsBooked||1), 0);
        all.push({ dayISO, start: new Date(t), end: slotEnd, count, capacity: cfg.cap });
      }
    }
    return all;
  }, [bookings.data, me.data, selectedDate]);

  const slotsByLabel = useMemo(() => {
    const m = new Map<string, Slot[]>();
    const fmt = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    for (const s of slots) {
      const label = fmt(s.start);
      const arr = m.get(label) || [];
      arr.push(s);
      m.set(label, arr);
    }
    return m;
  }, [slots]);

  const rowLabels = useMemo(() => {
    const labels = Array.from(slotsByLabel.keys());
    const toMinutes = (label: string) => {
      const [h, m] = label.split(":").map(Number);
      return h * 60 + m;
    };
    return labels.sort((a,b)=> toMinutes(a)-toMinutes(b));
  }, [slotsByLabel]);

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 16 }}>
        <h2>Bookings</h2>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <button className="btn" onClick={() => setSelectedDate(new Date(new Date(selectedDate).getTime() - 7*86400000).toISOString().slice(0,10))}>{"<"} Prev week</button>
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />
          <button className="btn" onClick={() => setSelectedDate(new Date(new Date(selectedDate).getTime() + 7*86400000).toISOString().slice(0,10))}>Next week {">"}</button>
        </div>
      </div>
      <div className="glass" style={{ padding: 0, height: 'calc(100vh - 180px)', overflow: 'auto' }}>
        <div style={{ display:'grid', gridTemplateColumns:'80px repeat(7, 1fr)', borderTop:'1px solid var(--border)' }}>
          {/* Header row: days */}
          <div style={{ padding:8, borderRight:'1px solid var(--border)', background:'rgba(0,0,0,0.04)' }}>Time</div>
          {Array.from({length:7}).map((_,i)=>{
            const day = new Date(slots[0]?.start || new Date());
            if (slots.length) {
              const first = slots[0].start;
              const monday = new Date(first);
              const dayIdx = monday.getDay();
              const diffToMonday = (dayIdx === 0) ? -6 : (1 - dayIdx);
              monday.setDate(monday.getDate() + diffToMonday);
              day.setDate(monday.getDate()+i);
            }
            return <div key={i} style={{ padding:8, borderRight:'1px solid var(--border)', background:'rgba(0,0,0,0.04)' }}>{day.toLocaleDateString(undefined,{ weekday:'short', month:'short', day:'numeric'})}</div>;
          })}
          {/* Body: slots per day */}
          {rowLabels.map((label, idxRow) => {
            const row = slotsByLabel.get(label) || [];
            const rowHeight = `calc((100vh - 180px) / ${rowLabels.length || 1})`;
            return (
              <>
                <div key={`t-${idxRow}`} style={{ padding:6, borderTop:'1px solid var(--border)', borderRight:'1px solid var(--border)', height: rowHeight, display:'flex', alignItems:'center' }}>{label}</div>
                {row.map((s, idxCol) => {
                  const full = s.count >= s.capacity;
                  const bg = full ? 'rgba(255,60,60,0.25)' : 'rgba(60,200,120,0.25)';
                  return (
                    <div key={`c-${idxRow}-${idxCol}`} style={{ borderTop:'1px solid var(--border)', borderRight:'1px solid var(--border)', background:bg, height: rowHeight, display:'grid', placeItems:'center' }}>
                      <span style={{ fontWeight:700 }}>{s.count}/{s.capacity}</span>
                    </div>
                  );
                })}
              </>
            );
          })}
        </div>
      </div>
    </div>
  );
}
