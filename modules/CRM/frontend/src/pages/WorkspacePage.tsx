import { useState } from 'react';
import { AppointmentDetail } from '../components/forms';
import { Badge, Empty, Modal } from '../components/ui';
import { HandoverBox, LegalBox } from './CustomerProfile';
import { useCrm, useQuery } from '../hooks/crm';
import type { Appointment } from '../types/domain';
import { ACTIVITY_TYPE, HANDOVER_STATUS, LEGAL_STATUS, addDays, expiry, fmtDate, fmtDateTime, fmtTime, startOfDay, startOfWeek } from '../utils/format';

// Screen 1 — Tổng quan công việc: dashboard computed from the same data as the other screens (customers in scope,
// appointments, tasks: open / overdue / done this week, recent activities, items waiting for the user, expiring documents).

export function WorkspacePage() {
  const { adapter, session, accountName, navigate, can } = useCrm();
  const [open, setOpen] = useState<Appointment | null>(null);
  const [work, setWork] = useState<{ kind: 'handover' | 'legal'; id: string } | null>(null);
  const me = session?.account.accountId ?? '';
  const today = startOfDay(new Date());
  const week = startOfWeek(today);
  const { data: customers } = useQuery(() => adapter.visibleCustomers(), []);
  const { data: apts } = useQuery(() => adapter.listAppointments({ from: today.toISOString(), to: addDays(today, 8).toISOString(), mineOnly: true, includeCancelled: false }), [today.getTime()]);
  const { data: tasks } = useQuery(() => adapter.listTasks({ mineOnly: true }), []);
  const { data: activities } = useQuery(() => adapter.recentActivities(8), []);
  const { data: handovers } = useQuery(() => adapter.listHandovers(), []);
  const { data: legal } = useQuery(() => adapter.listLegalChanges(), []);
  const { data: docs } = useQuery(() => adapter.expiringDocuments(30), []);
  const now = new Date().toISOString();
  const openTasks = (tasks ?? []).filter((t) => t.status === 'TODO' || t.status === 'IN_PROGRESS');
  const overdue = openTasks.filter((t) => t.dueAt !== null && t.dueAt < now);
  const doneWeek = (tasks ?? []).filter((t) => t.status === 'DONE' && t.completedAt !== null && t.completedAt >= week.toISOString());
  const todayApts = (apts ?? []).filter((a) => a.startAt < addDays(today, 1).toISOString());
  const mine = (customers ?? []).length;
  const verified = (customers ?? []).filter((c) => c.recordStatus === 'VERIFIED').length;
  // Items waiting for THIS account (step owner or approval right).
  const waitingHandover = (handovers ?? []).filter((h) => (h.status === 'PENDING_APPROVAL' && can('crm.handover.approve') && h.initiatedByAccountId !== me)
    || (h.status === 'PENDING_CURRENT_ACK' && h.currentSaleAccountId === me) || (h.status === 'PENDING_RECEIVER_ACK' && h.toSaleAccountId === me));
  const waitingLegal = (legal ?? []).filter((l) => l.requestedByAccountId !== me && ((l.status === 'PENDING_MANAGEMENT' && can('crm.legal_change.approve_management'))
    || (l.status === 'PENDING_ACCOUNTING' && can('crm.legal_change.approve_accounting'))));
  const name = (id: string) => customers?.find((c) => c.customerId === id)?.displayName ?? 'Khách hàng';
  return (
    <div className="crm-page">
      <div className="crm-kpis">
        <button type="button" className="crm-kpi" onClick={() => navigate('customers')}><b>{mine}</b><span>Khách hàng trong phạm vi ({verified} đã xác minh)</span></button>
        <button type="button" className="crm-kpi" onClick={() => navigate('calendar')}><b>{todayApts.length}</b><span>Lịch hẹn hôm nay</span></button>
        <button type="button" className="crm-kpi" onClick={() => navigate('tasks')}><b>{openTasks.length}</b><span>Công việc chưa hoàn thành</span></button>
        <button type="button" className={`crm-kpi${overdue.length ? ' crm-kpi-red' : ''}`} onClick={() => navigate('tasks')}><b>{overdue.length}</b><span>Công việc quá hạn</span></button>
        <div className="crm-kpi"><b>{doneWeek.length}</b><span>Hoàn thành tuần này</span></div>
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
          <h3>Chờ tôi xử lý</h3>
          {waitingHandover.length + waitingLegal.length === 0 ? <Empty>Không có yêu cầu nào chờ bạn.</Empty> : <>
            {waitingHandover.map((h) => <button type="button" key={h.handoverId} className="crm-row-btn" onClick={() => setWork({ kind: 'handover', id: h.handoverId })}>
              <Badge tone="amber">Bàn giao</Badge><span>{name(h.customerId)} — {HANDOVER_STATUS[h.status]}<small className="crm-sub">{accountName(h.currentSaleAccountId)} → {accountName(h.toSaleAccountId)}</small></span></button>)}
            {waitingLegal.map((l) => <button type="button" key={l.changeRequestId} className="crm-row-btn" onClick={() => setWork({ kind: 'legal', id: l.changeRequestId })}>
              <Badge tone="violet">Pháp lý</Badge><span>{name(l.customerId)} — {LEGAL_STATUS[l.status]}</span></button>)}
          </>}
        </section>
        <section className="crm-card">
          <h3>Tài liệu sắp / đã hết hạn</h3>
          {(docs ?? []).length === 0 ? <Empty>Không có tài liệu sắp hết hạn.</Empty> : (docs ?? []).slice(0, 6).map((d) => {
            const e = expiry(d.expiryDate);
            return <button type="button" key={d.documentId} className="crm-row-btn" onClick={() => navigate('customers', { customer: d.customerId })}>
              <Badge tone={e.status === 'EXPIRED' ? 'red' : 'amber'}>{e.label}</Badge><span>{d.documentName}<small className="crm-sub">{name(d.customerId)}</small></span></button>;
          })}
        </section>
        <section className="crm-card crm-span2">
          <h3>Hoạt động gần đây</h3>
          {(activities ?? []).length === 0 ? <Empty>Chưa có hoạt động.</Empty> : (activities ?? []).map((a) => (
            <button type="button" key={a.activityId} className="crm-row-btn" onClick={() => navigate('customers', { customer: a.customerId })}>
              <span className="crm-when">{fmtDateTime(a.occurredAt)}</span><Badge tone="grey">{ACTIVITY_TYPE[a.activityType]}</Badge><span>{a.title}<small className="crm-sub">{name(a.customerId)} · {accountName(a.createdByAccountId)}</small></span>
            </button>))}
        </section>
      </div>
      {open && <AppointmentDetail appointment={open} onClose={() => setOpen(null)} />}
      {work && (() => {
        // Handled in place: the receiver of a handover is not assigned to the customer yet, so the profile may be out of scope.
        const h = work.kind === 'handover' ? (handovers ?? []).find((x) => x.handoverId === work.id) : undefined;
        const l = work.kind === 'legal' ? (legal ?? []).find((x) => x.changeRequestId === work.id) : undefined;
        const customerId = h?.customerId ?? l?.customerId ?? '';
        const visible = (customers ?? []).some((c) => c.customerId === customerId);
        return (
          <Modal title={work.kind === 'handover' ? 'Xử lý bàn giao khách hàng' : 'Duyệt thay đổi pháp lý'} onClose={() => setWork(null)} wide footer={<>
            {visible && <button type="button" className="crm-btn" onClick={() => navigate('customers', { customer: customerId })}>Mở hồ sơ khách hàng</button>}
            <button type="button" className="crm-btn" onClick={() => setWork(null)}>Đóng</button></>}>
            <p><b>{name(customerId)}</b></p>
            {h && (['PENDING_APPROVAL', 'PENDING_CURRENT_ACK', 'PENDING_RECEIVER_ACK'].includes(h.status) ? <HandoverBox h={h} />
              : <p>Trạng thái hiện tại: <Badge tone={h.status === 'COMPLETED' ? 'green' : 'grey'}>{HANDOVER_STATUS[h.status]}</Badge></p>)}
            {l && (l.status === 'PENDING_MANAGEMENT' || l.status === 'PENDING_ACCOUNTING' ? <LegalBox l={l} />
              : <p>Trạng thái hiện tại: <Badge tone={l.status === 'APPLIED' ? 'green' : 'grey'}>{LEGAL_STATUS[l.status]}</Badge></p>)}
          </Modal>);
      })()}
    </div>
  );
}
