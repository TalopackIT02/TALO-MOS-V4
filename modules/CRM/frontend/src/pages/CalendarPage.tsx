import { useEffect, useMemo, useState } from 'react';
import { AppointmentDetail, AppointmentForm } from '../components/forms';
import { Badge } from '../components/ui';
import { useCrm, useQuery, useUrlParam } from '../hooks/crm';
import type { Appointment } from '../types/domain';
import { WEEKDAYS, addDays, dayKey, fmtDate, fmtTime, startOfDay, startOfWeek } from '../utils/format';

// Screen 3 — Lịch hẹn: day / week / month calendar; create, edit, cancel, mark done; customer-linked appointments are
// the same records as the "Lịch hẹn" tab of the customer profile. Mock-only data (no table yet — Gate 2).

type View = 'day' | 'week' | 'month';
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 07:00 – 21:00
const HOUR_PX = 44;

function range(view: View, anchor: Date): { from: Date; to: Date; days: Date[] } {
  if (view === 'day') { const from = startOfDay(anchor); return { from, to: addDays(from, 1), days: [from] }; }
  if (view === 'week') { const from = startOfWeek(anchor); return { from, to: addDays(from, 7), days: Array.from({ length: 7 }, (_, i) => addDays(from, i)) }; }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const from = startOfWeek(first);
  return { from, to: addDays(from, 42), days: Array.from({ length: 42 }, (_, i) => addDays(from, i)) };
}

export function CalendarPage() {
  const { adapter, accountName } = useCrm();
  const deepLink = useUrlParam('appointment');
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [mineOnly, setMineOnly] = useState(true);
  const [showCancelled, setShowCancelled] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [create, setCreate] = useState<Date | null>(null);
  const [open, setOpen] = useState<Appointment | null>(null);
  const r = useMemo(() => range(view, anchor), [view, anchor]);
  const { data } = useQuery(() => adapter.listAppointments({ from: r.from.toISOString(), to: r.to.toISOString(), mineOnly, includeCancelled: showCancelled,
    ...(customerId ? { customerId } : {}) }), [r.from.getTime(), view, mineOnly, showCancelled, customerId]);
  const { data: customers } = useQuery(() => adapter.visibleCustomers(), []);
  useEffect(() => {
    if (!deepLink) return;
    adapter.listAppointments({ from: '0000', to: '9999' }).then((all) => {
      const a = all.find((x) => x.appointmentId === deepLink);
      if (a) { setAnchor(new Date(a.startAt)); setOpen(a); }
    }).catch(() => undefined);
  }, [adapter, deepLink]);
  const items = data ?? [];
  const byDay = (d: Date) => items.filter((a) => dayKey(new Date(a.startAt)) === dayKey(d));
  const step = (n: number) => setAnchor((a) => (view === 'month' ? new Date(a.getFullYear(), a.getMonth() + n, 1) : addDays(a, n * (view === 'week' ? 7 : 1))));
  const title = view === 'month' ? `Tháng ${anchor.getMonth() + 1}/${anchor.getFullYear()}` : view === 'week' ? `${fmtDate(r.days[0]?.toISOString())} – ${fmtDate(r.days[6]?.toISOString())}` : fmtDate(anchor.toISOString());
  const today = dayKey(new Date());
  const tone = (a: Appointment) => (a.status === 'CANCELLED' ? 'crm-ev-cancel' : a.status === 'DONE' ? 'crm-ev-done' : 'crm-ev');
  const customerName = (id: string | null) => (id ? customers?.find((c) => c.customerId === id)?.displayName ?? '' : '');
  return (
    <div className="crm-page">
      <div className="crm-toolbar">
        <button type="button" className="crm-btn crm-sm" onClick={() => setAnchor(new Date())}>Hôm nay</button>
        <button type="button" className="crm-btn crm-sm" aria-label="Kỳ trước" onClick={() => step(-1)}>‹</button>
        <button type="button" className="crm-btn crm-sm" aria-label="Kỳ sau" onClick={() => step(1)}>›</button>
        <b className="crm-caltitle">{title}</b>
        <div className="crm-seg" role="group" aria-label="Chế độ xem">{(['day', 'week', 'month'] as const).map((v) =>
          <button type="button" key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>{v === 'day' ? 'Ngày' : v === 'week' ? 'Tuần' : 'Tháng'}</button>)}</div>
        <select value={mineOnly ? 'mine' : 'all'} onChange={(e) => setMineOnly(e.target.value === 'mine')} aria-label="Phạm vi lịch">
          <option value="mine">Lịch của tôi</option><option value="all">Tất cả lịch tôi được xem</option></select>
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Lọc khách hàng"><option value="">Mọi khách hàng</option>
          {(customers ?? []).map((c) => <option key={c.customerId} value={c.customerId}>{c.customerCode} · {c.displayName}</option>)}</select>
        <label className="crm-check"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Hiện lịch đã hủy</label>
        <span className="crm-grow" />
        <button type="button" className="crm-btn crm-primary" onClick={() => setCreate(new Date())}>+ Lịch hẹn</button>
      </div>

      {view === 'month' ? (
        <div className="crm-month">
          {WEEKDAYS.map((w) => <div key={w} className="crm-month-head">{w}</div>)}
          {r.days.map((d) => {
            const list = byDay(d);
            return (
              <div key={d.toISOString()} className={`crm-month-cell${d.getMonth() !== anchor.getMonth() ? ' crm-out' : ''}${dayKey(d) === today ? ' crm-today' : ''}`}
                onDoubleClick={() => setCreate(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9))}>
                <button type="button" className="crm-daynum" onClick={() => { setAnchor(d); setView('day'); }}>{d.getDate()}</button>
                {list.slice(0, 3).map((a) => <button type="button" key={a.appointmentId} className={`crm-chip-ev ${tone(a)}`} onClick={() => setOpen(a)}>{fmtTime(a.startAt)} {a.title}</button>)}
                {list.length > 3 && <button type="button" className="crm-link" onClick={() => { setAnchor(d); setView('day'); }}>+{list.length - 3} lịch</button>}
              </div>);
          })}
        </div>
      ) : (
        <div className="crm-grid" style={{ gridTemplateColumns: `56px repeat(${r.days.length}, minmax(0, 1fr))` }}>
          <div />
          {r.days.map((d, i) => <div key={d.toISOString()} className={`crm-grid-head${dayKey(d) === today ? ' crm-today' : ''}`}>{view === 'week' ? `${WEEKDAYS[i]} ${d.getDate()}/${d.getMonth() + 1}` : fmtDate(d.toISOString())}</div>)}
          <div className="crm-hours">{HOURS.map((h) => <div key={h} style={{ height: HOUR_PX }}>{String(h).padStart(2, '0')}:00</div>)}</div>
          {r.days.map((d) => (
            <div key={d.toISOString()} className="crm-daycol" style={{ height: HOURS.length * HOUR_PX }}>
              {HOURS.map((h) => <button type="button" key={h} className="crm-slot" style={{ height: HOUR_PX }} aria-label={`Tạo lịch ${fmtDate(d.toISOString())} ${h}:00`}
                onClick={() => setCreate(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h))} />)}
              {byDay(d).map((a) => {
                const s = new Date(a.startAt);
                const e = new Date(a.endAt);
                const top = Math.max(0, (s.getHours() + s.getMinutes() / 60 - HOURS[0]!) * HOUR_PX);
                const height = Math.max(22, ((e.getTime() - s.getTime()) / 3_600_000) * HOUR_PX - 2);
                return (
                  <button type="button" key={a.appointmentId} className={`crm-event ${tone(a)}`} style={{ top, height }} onClick={() => setOpen(a)}
                    title={`${a.title} — ${accountName(a.ownerAccountId)}`}>
                    <b>{fmtTime(a.startAt)} {a.title}</b>{a.customerId && <small>{customerName(a.customerId)}</small>}
                  </button>);
              })}
            </div>
          ))}
        </div>
      )}
      <p className="crm-legend"><Badge tone="blue">Đã lên lịch</Badge> <Badge tone="green">Đã diễn ra</Badge> <Badge tone="grey">Đã hủy</Badge> · Bấm ô trống để tạo lịch tại giờ đó (tháng: nhấp đúp vào ngày).</p>
      {create && <AppointmentForm defaultStart={create} onClose={() => setCreate(null)} />}
      {open && <AppointmentDetail appointment={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
