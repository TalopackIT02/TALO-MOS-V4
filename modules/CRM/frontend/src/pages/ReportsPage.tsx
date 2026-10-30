import { useState } from 'react';
import { ReportForm } from '../components/forms';
import { Badge, Empty, Modal } from '../components/ui';
import { useAction, useCrm, useQuery } from '../hooks/crm';
import type { WorkReport } from '../types/domain';
import { REPORT_STATUS, fmtDate, fmtDateTime } from '../utils/format';

// Screen 5 — Báo cáo: daily work reports written by the user (content done, results, issues, next steps), linked to
// appointments / tasks / customers. NOT the dashboard: no computed KPI here. Mock-only (no table yet — Gate 2).

export function ReportsPage() {
  const { adapter, accountName, session, accounts, can } = useCrm();
  const { run } = useAction();
  const [form, setForm] = useState<WorkReport | 'new' | null>(null);
  const [view, setView] = useState<WorkReport | null>(null);
  const [filter, setFilter] = useState({ from: '', to: '', authorAccountId: '', status: '' as '' | 'DRAFT' | 'SUBMITTED' });
  const { data } = useQuery(() => adapter.listReports({ ...(filter.from ? { from: filter.from } : {}), ...(filter.to ? { to: filter.to } : {}),
    ...(filter.authorAccountId ? { authorAccountId: filter.authorAccountId } : {}), status: filter.status }), [JSON.stringify(filter)]);
  const { data: customers } = useQuery(() => adapter.visibleCustomers(), []);
  const { data: tasks } = useQuery(() => adapter.listTasks({}), []);
  const { data: apts } = useQuery(() => adapter.listAppointments({ from: '0000', to: '9999' }), []);
  const me = session?.account.accountId;
  return (
    <div className="crm-page">
      <div className="crm-toolbar">
        <label>Từ <input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} /></label>
        <label>Đến <input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} /></label>
        <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as typeof filter.status })} aria-label="Trạng thái báo cáo">
          <option value="">Mọi trạng thái</option><option value="DRAFT">Bản nháp</option><option value="SUBMITTED">Đã nộp</option></select>
        {can('crm.customer.read_all') && <select value={filter.authorAccountId} onChange={(e) => setFilter({ ...filter, authorAccountId: e.target.value })} aria-label="Người báo cáo">
          <option value="">Mọi người</option>{accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.fullName}</option>)}</select>}
        <span className="crm-grow" />
        <button type="button" className="crm-btn crm-primary" onClick={() => setForm('new')}>+ Viết báo cáo</button>
      </div>
      {data && (data.length === 0 ? <Empty>Chưa có báo cáo trong khoảng đã chọn.</Empty> : (
        <div className="crm-tablewrap"><table className="crm-table crm-hover"><thead><tr><th>Ngày làm việc</th><th>Người báo cáo</th><th>Nội dung thực hiện</th><th>Kết quả</th><th>Liên kết</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>{data.map((r) => (
            <tr key={r.reportId} tabIndex={0} onClick={() => setView(r)} onKeyDown={(e) => { if (e.key === 'Enter') setView(r); }}>
              <td>{fmtDate(r.workDate)}</td><td>{accountName(r.authorAccountId)}</td><td className="crm-clip">{r.workDone}</td><td className="crm-clip">{r.results}</td>
              <td><small>{r.customerIds.length} KH · {r.appointmentIds.length} lịch · {r.taskIds.length} việc</small></td>
              <td><Badge tone={r.status === 'SUBMITTED' ? 'green' : 'amber'}>{REPORT_STATUS[r.status]}</Badge></td>
              <td className="crm-actions" onClick={(e) => e.stopPropagation()}>{r.status === 'DRAFT' && r.authorAccountId === me && <>
                <button type="button" className="crm-btn crm-sm" onClick={() => setForm(r)}>Sửa</button>
                <button type="button" className="crm-btn crm-sm crm-primary" onClick={() => run(() => adapter.submitReport(r.reportId), 'Đã nộp báo cáo.')}>Nộp</button></>}</td>
            </tr>))}</tbody></table></div>
      ))}
      {form && <ReportForm {...(form === 'new' ? {} : { report: form })} onClose={() => setForm(null)} />}
      {view && <Modal title={`Báo cáo ngày ${fmtDate(view.workDate)} — ${accountName(view.authorAccountId)}`} onClose={() => setView(null)} wide>
        <dl className="crm-dl">
          <dt>Trạng thái</dt><dd><Badge tone={view.status === 'SUBMITTED' ? 'green' : 'amber'}>{REPORT_STATUS[view.status]}</Badge> {view.submittedAt && <small>nộp {fmtDateTime(view.submittedAt)}</small>}</dd>
          <dt>Nội dung thực hiện</dt><dd className="crm-pre">{view.workDone}</dd>
          <dt>Kết quả</dt><dd className="crm-pre">{view.results}</dd>
          <dt>Vấn đề phát sinh</dt><dd className="crm-pre">{view.issues ?? '—'}</dd>
          <dt>Công việc tiếp tục</dt><dd className="crm-pre">{view.nextSteps ?? '—'}</dd>
          <dt>Khách hàng</dt><dd>{view.customerIds.map((id) => customers?.find((c) => c.customerId === id)?.displayName ?? '(ngoài phạm vi xem)').join(', ') || '—'}</dd>
          <dt>Lịch hẹn</dt><dd>{view.appointmentIds.map((id) => apts?.find((a) => a.appointmentId === id)?.title ?? id).join(', ') || '—'}</dd>
          <dt>Công việc</dt><dd>{view.taskIds.map((id) => tasks?.find((t) => t.taskId === id)?.title ?? id).join(', ') || '—'}</dd>
        </dl>
      </Modal>}
    </div>
  );
}
