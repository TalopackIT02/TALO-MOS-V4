import { useState } from 'react';
import { TaskForm, TaskRows } from '../components/forms';
import { Empty } from '../components/ui';
import { useCrm, useQuery } from '../hooks/crm';
import type { TaskQuery } from '../services/adapter';

// Screen 4 — Công việc: To-do list independent of appointments (owner order IV). Same records as the "Công việc" tab
// of the customer profile. Priority / progress are mock-only fields (no column yet — Gate 2).

export function TasksPage() {
  const { adapter } = useCrm();
  const [q, setQ] = useState<TaskQuery>({ status: 'OPEN', mineOnly: true });
  const [form, setForm] = useState(false);
  const { data } = useQuery(() => adapter.listTasks(q), [JSON.stringify(q)]);
  const { data: customers } = useQuery(() => adapter.visibleCustomers(), []);
  const { data: all } = useQuery(() => adapter.listTasks({ mineOnly: q.mineOnly ?? false }), [q.mineOnly]);
  const now = new Date().toISOString();
  const open = (all ?? []).filter((t) => t.status === 'TODO' || t.status === 'IN_PROGRESS');
  const counts = { open: open.length, overdue: open.filter((t) => t.dueAt !== null && t.dueAt < now).length, done: (all ?? []).filter((t) => t.status === 'DONE').length };
  return (
    <div className="crm-page">
      <div className="crm-kpis">
        <button type="button" className={`crm-kpi${q.status === 'OPEN' && !q.overdueOnly ? ' active' : ''}`} onClick={() => setQ({ ...q, status: 'OPEN', overdueOnly: false })}><b>{counts.open}</b><span>Chưa hoàn thành</span></button>
        <button type="button" className={`crm-kpi crm-kpi-red${q.overdueOnly ? ' active' : ''}`} onClick={() => setQ({ ...q, status: '', overdueOnly: true })}><b>{counts.overdue}</b><span>Quá hạn</span></button>
        <button type="button" className={`crm-kpi${q.status === 'DONE' ? ' active' : ''}`} onClick={() => setQ({ ...q, status: 'DONE', overdueOnly: false })}><b>{counts.done}</b><span>Đã hoàn thành</span></button>
      </div>
      <div className="crm-toolbar">
        <input className="crm-search" placeholder="Tìm công việc…" value={q.q ?? ''} onChange={(e) => setQ({ ...q, q: e.target.value })} aria-label="Tìm công việc" />
        <select value={q.status ?? ''} onChange={(e) => setQ({ ...q, status: e.target.value as TaskQuery['status'], overdueOnly: false })} aria-label="Trạng thái">
          <option value="OPEN">Chưa hoàn thành</option><option value="">Mọi trạng thái</option><option value="TODO">Chưa làm</option><option value="IN_PROGRESS">Đang làm</option>
          <option value="DONE">Hoàn thành</option><option value="CANCELLED">Đã hủy</option></select>
        <select value={q.mineOnly ? 'mine' : 'all'} onChange={(e) => setQ({ ...q, mineOnly: e.target.value === 'mine' })} aria-label="Phạm vi">
          <option value="mine">Việc của tôi</option><option value="all">Mọi việc tôi được xem</option></select>
        <select value={q.customerId ?? ''} onChange={(e) => setQ({ ...q, customerId: e.target.value })} aria-label="Khách hàng"><option value="">Mọi khách hàng</option>
          {(customers ?? []).map((c) => <option key={c.customerId} value={c.customerId}>{c.customerCode} · {c.displayName}</option>)}</select>
        <span className="crm-grow" />
        <button type="button" className="crm-btn crm-primary" onClick={() => setForm(true)}>+ Công việc</button>
      </div>
      {data && (data.length === 0 ? <Empty>Không có công việc phù hợp.</Empty> : <TaskRows tasks={data} />)}
      {form && <TaskForm onClose={() => setForm(false)} />}
    </div>
  );
}
