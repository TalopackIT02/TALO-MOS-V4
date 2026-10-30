import { useState } from 'react';
import { useAction, useCrm, useQuery } from '../hooks/crm';
import type { Appointment, Task, TaskPriority, WorkReport } from '../types/domain';
import { APPOINTMENT_STATUS, TASK_PRIORITY, TASK_STATUS, fmtDate, fmtDateTime, fromLocalInput, toLocalInput, todayKey } from '../utils/format';
import { Badge, Field, Modal, PromptDialog } from './ui';

// Forms shared by the global screens and the customer-profile tabs (same adapter = same data: owner order IV).

function CustomerSelect({ value, onChange, disabled }: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean }) {
  const { adapter } = useCrm();
  const { data } = useQuery(() => adapter.visibleCustomers(), []);
  return (
    <select value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— Không gắn khách hàng —</option>
      {(data ?? []).map((c) => <option key={c.customerId} value={c.customerId}>{c.customerCode} · {c.displayName}</option>)}
    </select>
  );
}

export function AppointmentForm({ appointment, customerId, defaultStart, onClose }: { appointment?: Appointment; customerId?: string | null; defaultStart?: Date; onClose: () => void }) {
  const { adapter } = useCrm();
  const { run, busy } = useAction();
  const start = defaultStart ?? (() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; })();
  const [f, setF] = useState({
    title: appointment?.title ?? '', customerId: appointment?.customerId ?? customerId ?? null,
    startAt: toLocalInput(appointment?.startAt ?? start.toISOString()), endAt: toLocalInput(appointment?.endAt ?? new Date(start.getTime() + 3_600_000).toISOString()),
    location: appointment?.location ?? '', description: appointment?.description ?? '', remindMinutes: appointment?.remindMinutes ?? 30,
  });
  const save = () => run(async () => {
    const input = { title: f.title, customerId: f.customerId, startAt: fromLocalInput(f.startAt) ?? '', endAt: fromLocalInput(f.endAt) ?? '',
      location: f.location || null, description: f.description || null, remindMinutes: f.remindMinutes || null };
    if (appointment) await adapter.updateAppointment(appointment.appointmentId, input); else await adapter.createAppointment(input);
  }, appointment ? 'Đã cập nhật lịch hẹn.' : 'Đã tạo lịch hẹn.').then((ok) => { if (ok) onClose(); });
  return (
    <Modal title={appointment ? 'Sửa lịch hẹn' : 'Tạo lịch hẹn'} onClose={onClose} footer={<>
      <button type="button" className="crm-btn" onClick={onClose}>Hủy bỏ</button>
      <button type="button" className="crm-btn crm-primary" disabled={busy} onClick={save}>Lưu lịch hẹn</button></>}>
      <div className="crm-form">
        <Field label="Tiêu đề" required><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></Field>
        <Field label="Khách hàng"><CustomerSelect value={f.customerId} disabled={customerId !== undefined && !appointment} onChange={(v) => setF({ ...f, customerId: v })} /></Field>
        <div className="crm-row2">
          <Field label="Bắt đầu" required><input type="datetime-local" value={f.startAt} onChange={(e) => setF({ ...f, startAt: e.target.value })} /></Field>
          <Field label="Kết thúc" required><input type="datetime-local" value={f.endAt} onChange={(e) => setF({ ...f, endAt: e.target.value })} /></Field>
        </div>
        <div className="crm-row2">
          <Field label="Địa điểm"><input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
          <Field label="Nhắc trước"><select value={f.remindMinutes} onChange={(e) => setF({ ...f, remindMinutes: Number(e.target.value) })}>
            <option value={0}>Không nhắc</option><option value={10}>10 phút</option><option value={30}>30 phút</option><option value={60}>1 giờ</option><option value={1440}>1 ngày</option>
          </select></Field>
        </div>
        <Field label="Nội dung"><textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function AppointmentDetail({ appointment: a, onClose }: { appointment: Appointment; onClose: () => void }) {
  const { adapter, accountName, session, navigate } = useCrm();
  const { run } = useAction();
  const [mode, setMode] = useState<'view' | 'edit' | 'cancel' | 'done'>('view');
  const own = a.ownerAccountId === session?.account.accountId && a.status === 'SCHEDULED';
  if (mode === 'edit') return <AppointmentForm appointment={a} onClose={onClose} />;
  if (mode === 'cancel') return <PromptDialog title="Hủy lịch hẹn" label="Lý do hủy" confirm="Hủy lịch hẹn" danger onCancel={onClose}
    onConfirm={(t) => run(() => adapter.cancelAppointment(a.appointmentId, t), 'Đã hủy lịch hẹn.')} />;
  if (mode === 'done') return <PromptDialog title="Ghi kết quả buổi hẹn" label="Kết quả" confirm="Đánh dấu đã diễn ra" onCancel={onClose}
    onConfirm={(t) => run(() => adapter.completeAppointment(a.appointmentId, t), 'Đã ghi kết quả.')} />;
  return (
    <Modal title={a.title} onClose={onClose} footer={<>
      {a.customerId && <button type="button" className="crm-btn" onClick={() => navigate('customers', { customer: a.customerId ?? '' })}>Mở hồ sơ khách hàng</button>}
      {own && <button type="button" className="crm-btn" onClick={() => setMode('cancel')}>Hủy lịch</button>}
      {own && <button type="button" className="crm-btn" onClick={() => setMode('edit')}>Sửa</button>}
      {own && <button type="button" className="crm-btn crm-primary" onClick={() => setMode('done')}>Đã diễn ra</button>}
    </>}>
      <dl className="crm-dl">
        <dt>Thời gian</dt><dd>{fmtDateTime(a.startAt)} – {fmtDateTime(a.endAt)}</dd>
        <dt>Trạng thái</dt><dd><Badge tone={a.status === 'SCHEDULED' ? 'blue' : a.status === 'DONE' ? 'green' : 'grey'}>{APPOINTMENT_STATUS[a.status]}</Badge></dd>
        <dt>Người phụ trách</dt><dd>{accountName(a.ownerAccountId)}</dd>
        <dt>Địa điểm</dt><dd>{a.location ?? '—'}</dd>
        <dt>Nhắc lịch</dt><dd>{a.remindMinutes ? `${a.remindMinutes} phút trước` : 'Không'}</dd>
        <dt>Nội dung</dt><dd>{a.description ?? '—'}</dd>
        {a.outcome && <><dt>Kết quả</dt><dd>{a.outcome}</dd></>}
        {a.cancelReason && <><dt>Lý do hủy</dt><dd>{a.cancelReason}</dd></>}
      </dl>
    </Modal>
  );
}

export function TaskForm({ task, customerId, onClose }: { task?: Task; customerId?: string | null; onClose: () => void }) {
  const { adapter, accounts } = useCrm();
  const { run, busy } = useAction();
  const [f, setF] = useState({
    title: task?.title ?? '', description: task?.description ?? '', customerId: task?.customerId ?? customerId ?? null,
    assigneeAccountId: task?.assigneeAccountId ?? '', dueAt: toLocalInput(task?.dueAt), priority: task?.priority ?? 'MEDIUM' as TaskPriority, progress: task?.progress ?? 0,
  });
  const save = () => run(async () => {
    const input = { title: f.title, description: f.description || null, customerId: f.customerId, dueAt: fromLocalInput(f.dueAt), priority: f.priority, progress: f.progress,
      ...(f.assigneeAccountId ? { assigneeAccountId: f.assigneeAccountId } : {}) };
    if (task) await adapter.updateTask(task.taskId, input); else await adapter.createTask(input);
  }, task ? 'Đã cập nhật công việc.' : 'Đã tạo công việc.').then((ok) => { if (ok) onClose(); });
  return (
    <Modal title={task ? 'Sửa công việc' : 'Tạo công việc'} onClose={onClose} footer={<>
      <button type="button" className="crm-btn" onClick={onClose}>Hủy bỏ</button>
      <button type="button" className="crm-btn crm-primary" disabled={busy} onClick={save}>Lưu công việc</button></>}>
      <div className="crm-form">
        <Field label="Tên công việc" required><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></Field>
        <Field label="Khách hàng"><CustomerSelect value={f.customerId} disabled={customerId !== undefined && !task} onChange={(v) => setF({ ...f, customerId: v })} /></Field>
        <div className="crm-row2">
          <Field label="Hạn hoàn thành"><input type="datetime-local" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} /></Field>
          <Field label="Người thực hiện"><select value={f.assigneeAccountId} onChange={(e) => setF({ ...f, assigneeAccountId: e.target.value })}>
            <option value="">Tôi</option>{accounts.filter((a) => a.active).map((a) => <option key={a.accountId} value={a.accountId}>{a.fullName}</option>)}
          </select></Field>
        </div>
        <div className="crm-row2">
          <Field label="Mức ưu tiên"><select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as TaskPriority })}>
            {(['HIGH', 'MEDIUM', 'LOW'] as const).map((p) => <option key={p} value={p}>{TASK_PRIORITY[p]}</option>)}</select></Field>
          <Field label={`Tiến độ: ${f.progress}%`}><input type="range" min={0} max={100} step={10} value={f.progress} onChange={(e) => setF({ ...f, progress: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Mô tả"><textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

const PRIORITY_TONE = { HIGH: 'red', MEDIUM: 'amber', LOW: 'grey' } as const;
export function TaskRows({ tasks, showCustomer = true }: { tasks: Task[]; showCustomer?: boolean }) {
  const { adapter, accountName, navigate } = useCrm();
  const { run } = useAction();
  const [edit, setEdit] = useState<Task | null>(null);
  const { data: customers } = useQuery(() => adapter.visibleCustomers(), []);
  const now = new Date().toISOString();
  return (
    <>
      <div className="crm-tablewrap"><table className="crm-table">
        <thead><tr><th>Công việc</th>{showCustomer && <th>Khách hàng</th>}<th>Hạn</th><th>Ưu tiên</th><th>Tiến độ</th><th>Trạng thái</th><th>Người làm</th><th /></tr></thead>
        <tbody>{tasks.map((t) => {
          const open = t.status === 'TODO' || t.status === 'IN_PROGRESS';
          const overdue = open && t.dueAt !== null && t.dueAt < now;
          const c = customers?.find((x) => x.customerId === t.customerId);
          return (
            <tr key={t.taskId} className={overdue ? 'crm-overdue' : ''}>
              <td><b>{t.title}</b>{t.description && <small className="crm-sub">{t.description}</small>}</td>
              {showCustomer && <td>{c ? <button type="button" className="crm-link" onClick={() => navigate('customers', { customer: c.customerId })}>{c.customerCode} · {c.displayName}</button> : '—'}</td>}
              <td>{fmtDateTime(t.dueAt)}{overdue && <> <Badge tone="red">Quá hạn</Badge></>}</td>
              <td><Badge tone={PRIORITY_TONE[t.priority]}>{TASK_PRIORITY[t.priority]}</Badge></td>
              <td><div className="crm-progress" title={`${t.progress}%`}><i style={{ width: `${t.progress}%` }} /></div></td>
              <td><Badge tone={t.status === 'DONE' ? 'green' : t.status === 'CANCELLED' ? 'grey' : 'blue'}>{TASK_STATUS[t.status]}</Badge></td>
              <td>{accountName(t.assigneeAccountId)}</td>
              <td className="crm-actions">{open && <>
                <button type="button" className="crm-btn crm-sm" onClick={() => setEdit(t)}>Sửa</button>
                <button type="button" className="crm-btn crm-sm crm-primary" onClick={() => run(() => adapter.completeTask(t.taskId), 'Đã hoàn thành công việc.')}>Hoàn thành</button>
              </>}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      {edit && <TaskForm task={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

export function ReportForm({ report, onClose }: { report?: WorkReport; onClose: () => void }) {
  const { adapter } = useCrm();
  const { run, busy } = useAction();
  const [f, setF] = useState({
    workDate: report?.workDate ?? todayKey(), workDone: report?.workDone ?? '', results: report?.results ?? '', issues: report?.issues ?? '', nextSteps: report?.nextSteps ?? '',
    customerIds: report?.customerIds ?? [], appointmentIds: report?.appointmentIds ?? [], taskIds: report?.taskIds ?? [],
  });
  const from = new Date(`${f.workDate}T00:00:00`);
  const to = new Date(from.getTime() + 86_400_000);
  const { data: apts } = useQuery(() => adapter.listAppointments({ from: from.toISOString(), to: to.toISOString(), mineOnly: true }), [f.workDate]);
  const { data: tasks } = useQuery(() => adapter.listTasks({ mineOnly: true }), []);
  const { data: customers } = useQuery(() => adapter.visibleCustomers(), []);
  const toggle = (k: 'customerIds' | 'appointmentIds' | 'taskIds', id: string) => setF({ ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] });
  const save = (submit: boolean) => run(async () => {
    const input = { ...f, issues: f.issues || null, nextSteps: f.nextSteps || null };
    const r = report ? await adapter.updateReport(report.reportId, input) : await adapter.createReport(input);
    if (submit) await adapter.submitReport(r.reportId);
  }, submit ? 'Đã nộp báo cáo.' : 'Đã lưu bản nháp.').then((ok) => { if (ok) onClose(); });
  return (
    <Modal title={report ? 'Sửa báo cáo công việc' : 'Viết báo cáo công việc'} onClose={onClose} wide footer={<>
      <button type="button" className="crm-btn" onClick={onClose}>Hủy bỏ</button>
      <button type="button" className="crm-btn" disabled={busy} onClick={() => save(false)}>Lưu nháp</button>
      <button type="button" className="crm-btn crm-primary" disabled={busy} onClick={() => save(true)}>Nộp báo cáo</button></>}>
      <div className="crm-form">
        <Field label="Ngày làm việc" required><input type="date" value={f.workDate} onChange={(e) => setF({ ...f, workDate: e.target.value, appointmentIds: [] })} /></Field>
        <Field label="Nội dung đã thực hiện" required><textarea rows={3} value={f.workDone} onChange={(e) => setF({ ...f, workDone: e.target.value })} /></Field>
        <Field label="Kết quả thực hiện" required><textarea rows={2} value={f.results} onChange={(e) => setF({ ...f, results: e.target.value })} /></Field>
        <div className="crm-row2">
          <Field label="Vấn đề phát sinh"><textarea rows={2} value={f.issues} onChange={(e) => setF({ ...f, issues: e.target.value })} /></Field>
          <Field label="Công việc cần tiếp tục"><textarea rows={2} value={f.nextSteps} onChange={(e) => setF({ ...f, nextSteps: e.target.value })} /></Field>
        </div>
        <fieldset className="crm-links"><legend>Liên kết lịch hẹn trong ngày</legend>
          {(apts ?? []).length === 0 ? <small>Không có lịch hẹn ngày {fmtDate(f.workDate)}.</small> : (apts ?? []).map((a) =>
            <label key={a.appointmentId}><input type="checkbox" checked={f.appointmentIds.includes(a.appointmentId)} onChange={() => toggle('appointmentIds', a.appointmentId)} /> {a.title}</label>)}
        </fieldset>
        <fieldset className="crm-links"><legend>Liên kết công việc</legend>
          {(tasks ?? []).slice(0, 12).map((t) => <label key={t.taskId}><input type="checkbox" checked={f.taskIds.includes(t.taskId)} onChange={() => toggle('taskIds', t.taskId)} /> {t.title}</label>)}
        </fieldset>
        <fieldset className="crm-links"><legend>Khách hàng liên quan</legend>
          <select value="" onChange={(e) => { if (e.target.value) toggle('customerIds', e.target.value); }}>
            <option value="">+ Thêm khách hàng…</option>
            {(customers ?? []).filter((c) => !f.customerIds.includes(c.customerId)).map((c) => <option key={c.customerId} value={c.customerId}>{c.customerCode} · {c.displayName}</option>)}
          </select>
          <div className="crm-chips">{f.customerIds.map((id) => { const c = customers?.find((x) => x.customerId === id);
            return <span key={id} className="crm-chip">{c ? `${c.customerCode} · ${c.displayName}` : id}<button type="button" aria-label="Bỏ" onClick={() => toggle('customerIds', id)}>×</button></span>; })}</div>
        </fieldset>
      </div>
    </Modal>
  );
}
