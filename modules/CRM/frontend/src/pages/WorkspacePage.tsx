import { useState } from 'react';
import { AppointmentDetail } from '../components/forms';
import { Badge, Empty } from '../components/ui';
import { WorkQueueRows, useWorkQueue } from './WorkQueue';
import { useCrm, useQuery } from '../hooks/crm';
import type { Appointment } from '../types/domain';
import { ACTIVITY_TYPE, addDays, expiry, fmtDate, fmtDateTime, fmtTime, startOfDay, startOfWeek } from '../utils/format';

// Screen 1 — Tổng quan công việc: dashboard computed from the same data as the other screens (customers in scope,
// appointments, tasks: open / overdue / done this week, recent activities, items waiting for the user, expiring documents).

export function WorkspacePage() {
  const { adapter, session, accountName, navigate, can } = useCrm();
  const [open, setOpen] = useState<Appointment | null>(null);
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const me = session?.account.accountId ?? '';
  const today = startOfDay(new Date());
  const week = startOfWeek(today);
  const { data: customers } = useQuery(() => adapter.visibleCustomers(), []);
  const { data: mine } = useQuery(() => adapter.listCustomers({ saleAccountId: me, pageSize: 1 }), [me]);
  const { data: apts } = useQuery(() => adapter.listAppointments({ from: today.toISOString(), to: addDays(today, 8).toISOString(), mineOnly: true, includeCancelled: false }), [today.getTime()]);
  const { data: tasks } = useQuery(() => adapter.listTasks({ mineOnly: true }), []);
  const { data: activities } = useQuery(() => adapter.recentActivities(8), []);
  const queue = useWorkQueue();
  const { data: docs } = useQuery(() => adapter.expiringDocuments(30), []);
  const now = new Date().toISOString();
  const openTasks = (tasks ?? []).filter((t) => t.status === 'TODO' || t.status === 'IN_PROGRESS');
  const overdue = openTasks.filter((t) => t.dueAt !== null && t.dueAt < now);
  const periodStart = period === 'week' ? week : new Date(today.getFullYear(), today.getMonth(), 1);
  const donePeriod = (tasks ?? []).filter((t) => t.status === 'DONE' && t.completedAt !== null && t.completedAt >= periodStart.toISOString());
  const todayApts = (apts ?? []).filter((a) => a.startAt < addDays(today, 1).toISOString());
  const inScope = (customers ?? []).length;
  const name = (id: string) => customers?.find((c) => c.customerId === id)?.displayName ?? 'Khách hàng';
  return (
    <div className="crm-page">
      <div className="crm-kpis">
        <button type="button" className="crm-kpi" onClick={() => navigate('customers')}><b>{mine?.total ?? '…'}</b><span>Khách hàng đang phụ trách{inScope !== (mine?.total ?? inScope) ? ` (xem được ${inScope})` : ''}</span></button>
        <button type="button" className="crm-kpi" onClick={() => navigate('calendar')}><b>{todayApts.length}</b><span>Lịch hẹn hôm nay</span></button>
        <button type="button" className="crm-kpi" onClick={() => navigate('tasks')}><b>{openTasks.length}</b><span>Công việc chưa hoàn thành</span></button>
        <button type="button" className={`crm-kpi${overdue.length ? ' crm-kpi-red' : ''}`} onClick={() => navigate('tasks', { filter: 'overdue' })}><b>{overdue.length}</b><span>Công việc quá hạn</span></button>
        <div className="crm-kpi"><b>{donePeriod.length}</b><span>Hoàn thành <select className="crm-inline-select" value={period} aria-label="Kỳ thống kê" onChange={(e) => setPeriod(e.target.value as 'week' | 'month')}>
          <option value="week">tuần này</option><option value="month">tháng này</option></select></span></div>
      </div>
      <div className="crm-dash">
        <section className="crm-card">
          <h3>Lịch hẹn 7 ngày tới</h3>
          {(apts ?? []).length === 0 ? <Empty>Không có lịch hẹn.</Empty> : (apts ?? []).map((a) => (
            <button type="button" key={a.appointmentId} className="crm-row-btn" onClick={() => setOpen(a)}>
              <span className="crm-when">{fmtDate(a.startAt)} {fmtTime(a.startAt)}</span><span>{a.title}{a.customerId && <small className="crm-sub">{name(a.customerId)}</small>}</span>
            </button>))}
        </section>
        <section className="crm-card">
          <h3>Công việc cần chú ý</h3>
          {openTasks.length === 0 ? <Empty>Không có công việc đang mở.</Empty> : [...overdue, ...openTasks.filter((t) => !overdue.includes(t))].slice(0, 7).map((t) => (
            <p key={t.taskId}>{overdue.includes(t) ? <Badge tone="red">Quá hạn</Badge> : <Badge tone="blue">{t.progress}%</Badge>} {t.title} <small className="crm-sub">hạn {fmtDateTime(t.dueAt)}</small></p>))}
          <button type="button" className="crm-link" onClick={() => navigate('tasks')}>Mở danh sách công việc →</button>
        </section>
        <section className="crm-card">
          <h3>Chờ tôi xử lý <small className="crm-sub">Xử lý trong màn Khách hàng</small></h3>
          <WorkQueueRows handoverItems={queue.handoverItems} legalItems={queue.legalItems} name={queue.name}
            onPick={(w) => navigate('customers', { [w.kind]: w.id })} />
        </section>
        {can('crm.document.read') && <section className="crm-card">
          <h3>Tài liệu sắp / đã hết hạn <small className="crm-sub">Ngưỡng 30 ngày — cấu hình đề xuất D06</small></h3>
          {(docs ?? []).length === 0 ? <Empty>Không có tài liệu sắp hết hạn.</Empty> : (docs ?? []).slice(0, 6).map((d) => {
            const e = expiry(d.expiryDate);
            return <button type="button" key={d.documentId} className="crm-row-btn" onClick={() => navigate('customers', { customer: d.customerId })}>
              <Badge tone={e.status === 'EXPIRED' ? 'red' : 'amber'}>{e.label}</Badge><span>{d.documentName}<small className="crm-sub">{name(d.customerId)}</small></span></button>;
          })}
        </section>}
        <section className="crm-card crm-span2">
          <h3>Hoạt động gần đây</h3>
          {(activities ?? []).length === 0 ? <Empty>Chưa có hoạt động.</Empty> : (activities ?? []).map((a) => (
            <button type="button" key={a.activityId} className="crm-row-btn" onClick={() => navigate('customers', { customer: a.customerId })}>
              <span className="crm-when">{fmtDateTime(a.occurredAt)}</span><Badge tone="grey">{ACTIVITY_TYPE[a.activityType]}</Badge><span>{a.title}<small className="crm-sub">{name(a.customerId)} · {accountName(a.createdByAccountId)}</small></span>
            </button>))}
        </section>
      </div>
      {open && <AppointmentDetail appointment={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
