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
      // build UTC-based day start/end
      const dayUTC = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()));
      const dayStart = new Date(Date.UTC(dayUTC.getUTCFullYear(), dayUTC.getUTCMonth(), dayUTC.getUTCDate(), openH, openM, 0, 0));
      const dayEnd = new Date(Date.UTC(dayUTC.getUTCFullYear(), dayUTC.getUTCMonth(), dayUTC.getUTCDate(), closeH, closeM, 0, 0));
      for (let t = new Date(dayStart); t < dayEnd; t = new Date(t.getTime() + cfg.minutes*60000)) {
        const slotEnd = new Date(t.getTime() + cfg.minutes*60000);
        const dayISO = dayUTC.toISOString().slice(0,10);
        const slotBookings = (bookings.data||[])
          .filter(b => {
            // Only count bookings for current user
            if (me.data?.id && b.userId !== me.data.id) return false as any;
            const bs = new Date(b.startTime);
            const be = new Date(bs.getTime() + (b.durationMinutes||cfg.minutes)*60000);
            const bsTime = bs.getTime();
            const beTime = be.getTime();
            const tTime = t.getTime();
            const seTime = slotEnd.getTime();
            // overlap if booking starts before slot end AND booking ends after slot start
            return (bsTime < seTime) && (beTime > tTime);
          })
        const count = slotBookings.reduce((sum,b)=> sum + (b.unitsBooked||1), 0);
        all.push({ dayISO, start: new Date(t), end: slotEnd, count, capacity: cfg.cap });
      }
    }
    return all;
  }, [bookings.data, me.data, selectedDate]);

  const slotsByLabel = useMemo(() => {
    const m = new Map<string, Slot[]>();
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
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
                    <SlotCell
                      key={`c-${idxRow}-${idxCol}`}
                      slot={s}
                      height={rowHeight}
                      bg={bg}
                      bookings={(bookings.data||[]).filter(b => {
                        if (me.data?.id && b.userId !== me.data.id) return false as any;
                        const bs = new Date(b.startTime);
                        const be = new Date(bs.getTime() + (b.durationMinutes|| (me.data?.timeslotMinutes ?? 60))*60000);
                        return (bs.getTime() < s.end.getTime()) && (be.getTime() > s.start.getTime());
                      })}
                    />
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

function SlotCell({ slot, height, bg, bookings }: { slot: Slot; height: string; bg: string; bookings: any[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderTop:'1px solid var(--border)', borderRight:'1px solid var(--border)', background:bg, height, display:'grid', placeItems:'center', cursor:'pointer' }} onClick={() => setOpen(true)}>
      <span style={{ fontWeight:700 }}>{slot.count}/{slot.capacity}</span>
      {open && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'grid', placeItems:'center', zIndex:1000 }} onClick={() => setOpen(false)}>
          <div className="glass" style={{ width:'min(800px, 90vw)', maxHeight:'80vh', overflow:'auto', padding:18 }} onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <h3>Bookings for {slot.start.toLocaleString(undefined, { hour:'2-digit', minute:'2-digit' })}</h3>
              <button className="btn" onClick={() => setOpen(false)}>Close</button>
            </div>
            {bookings.length === 0 ? (
              <p className="muted" style={{ marginTop:8 }}>No bookings in this slot.</p>
            ) : (
              <table style={{ width:'100%', marginTop:10, borderCollapse:'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign:'left', padding:'8px 6px', borderBottom:'1px solid var(--border)' }}>Start</th>
                    <th style={{ textAlign:'left', padding:'8px 6px', borderBottom:'1px solid var(--border)' }}>Units</th>
                    <th style={{ textAlign:'left', padding:'8px 6px', borderBottom:'1px solid var(--border)' }}>Phone</th>
                    <th style={{ textAlign:'left', padding:'8px 6px', borderBottom:'1px solid var(--border)' }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b:any) => (
                    <tr key={b.id}>
                      <td style={{ padding:'8px 6px', borderBottom:'1px solid var(--border)' }}>{new Date(b.startTime).toLocaleString()}</td>
                      <td style={{ padding:'8px 6px', borderBottom:'1px solid var(--border)' }}>{b.unitsBooked}</td>
                      <td style={{ padding:'8px 6px', borderBottom:'1px solid var(--border)' }}>{b.phoneNumber || '—'}</td>
                      <td style={{ padding:'8px 6px', borderBottom:'1px solid var(--border)' }}>{b.notes || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
