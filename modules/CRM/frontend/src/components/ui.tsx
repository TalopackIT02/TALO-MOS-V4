import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { CrmProvider, useAction, useCrm, useQuery } from '../hooks/crm';
import { MockCrmAdapter } from '../services/mockAdapter';
import { fmtTime } from '../utils/format';

// Shared CRM UI pieces. Classes are prefixed crm- and scoped under .app-shell (crm.css), reusing the AppShell tokens.

export function Badge({ tone = 'grey', children }: { tone?: 'green' | 'amber' | 'red' | 'blue' | 'grey' | 'violet'; children: ReactNode }) {
  return <span className={`crm-badge crm-${tone}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="crm-empty">{children}</p>;
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="crm-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`crm-modal${wide ? ' crm-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="crm-modal-head"><h3>{title}</h3><button type="button" className="crm-x" aria-label="Đóng" onClick={onClose}>×</button></div>
        <div className="crm-modal-body">{children}</div>
        {footer && <div className="crm-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// Confirmation that requires a reason (reject, cancel, override…).
export function PromptDialog({ title, label, confirm, danger, onCancel, onConfirm, required = true }: {
  title: string; label: string; confirm: string; danger?: boolean; required?: boolean; onCancel: () => void; onConfirm: (text: string) => Promise<boolean> | void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onCancel} footer={<>
      <button type="button" className="crm-btn" onClick={onCancel}>Đóng</button>
      <button type="button" className={`crm-btn ${danger ? 'crm-danger' : 'crm-primary'}`} disabled={busy || (required && !text.trim())}
        onClick={async () => { setBusy(true); const ok = await onConfirm(text.trim()); setBusy(false); if (ok !== false) onCancel(); }}>{confirm}</button>
    </>}>
      <label className="crm-field"><span>{label}{required && ' *'}</span><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus /></label>
    </Modal>
  );
}

export function Field({ label, required, children, hint }: { label: string; required?: boolean; children: ReactNode; hint?: string }) {
  return <label className="crm-field"><span>{label}{required && ' *'}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="crm-pager">
      <span>{total === 0 ? '0 bản ghi' : `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} / ${total}`}</span>
      <button type="button" className="crm-btn crm-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Trước</button>
      <span>Trang {page}/{pages}</span>
      <button type="button" className="crm-btn crm-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Sau ›</button>
    </div>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useCrm();
  return (
    <div className="crm-toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`crm-toast crm-toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
        <span>{t.text}</span><button type="button" aria-label="Đóng thông báo" onClick={() => dismissToast(t.id)}>×</button></div>)}
    </div>
  );
}

// In-app appointment reminders (checked every 30 s; no background job, no push — owner order VII).
function Reminders() {
  const { adapter, navigate } = useCrm();
  const { run } = useAction();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  const { data } = useQuery(() => adapter.dueReminders(now), [now]);
  if (!data || data.length === 0) return null;
  return (
    <div className="crm-reminders" role="status">
      {data.map(({ appointment: a, minutesLeft }) => (
        <div key={a.appointmentId} className="crm-reminder">
          <span>🔔 <b>{fmtTime(a.startAt)}</b> {a.title} — còn {minutesLeft} phút</span>
          <span>
            <button type="button" className="crm-link" onClick={() => navigate('calendar', { appointment: a.appointmentId })}>Xem lịch</button>
            <button type="button" className="crm-link" onClick={() => run(() => adapter.dismissReminder(a.appointmentId))}>Đã biết</button>
          </span>
        </div>
      ))}
    </div>
  );
}

// Mock banner: makes the simulated state explicit and lets the acceptance tester switch the synthetic account.
function MockBanner() {
  const { adapter, session, accounts } = useCrm();
  const [open, setOpen] = useState(false);
  if (!(adapter instanceof MockCrmAdapter)) return null;
  return (
    <div className="crm-mockbar">
      <span><Badge tone="amber">Chế độ mô phỏng</Badge> Dữ liệu giả lập trong trình duyệt — chưa ghi vào hệ thống.</span>
      <label>Tài khoản thử:
        <select value={session?.account.accountId ?? ''} onChange={(e) => adapter.switchAccount(e.target.value)} aria-label="Tài khoản mô phỏng">
          {accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.fullName} — {a.title}</option>)}
        </select>
      </label>
      <button type="button" className="crm-link" onClick={() => setOpen(true)}>Trạng thái tích hợp</button>
      <button type="button" className="crm-link" onClick={() => { if (window.confirm('Khôi phục toàn bộ dữ liệu mẫu? Thay đổi mô phỏng sẽ mất.')) adapter.reset(); }}>Khôi phục dữ liệu mẫu</button>
      {open && <Modal title="Trạng thái tích hợp CRM" onClose={() => setOpen(false)} wide>
        <table className="crm-table"><thead><tr><th>Chức năng</th><th>Trạng thái</th><th>Lý do</th></tr></thead><tbody>
          {adapter.capabilities().map((c) => <tr key={c.feature}><td>{c.feature}</td>
            <td><Badge tone={c.state === 'INTEGRATED' ? 'green' : c.state === 'BLOCKED' ? 'red' : 'amber'}>{c.state === 'MOCK' ? 'Mô phỏng' : c.state === 'BLOCKED' ? 'Chưa có (BLOCKED)' : 'Đã tích hợp'}</Badge></td>
            <td>{c.reason}</td></tr>)}
        </tbody></table>
      </Modal>}
    </div>
  );
}

export function CrmScreen({ children, onSessionLost }: { children: ReactNode; onSessionLost?: () => void }) {
  return (
    <CrmProvider {...(onSessionLost ? { onSessionLost } : {})}>
      <div className="crm-root">
        <MockBanner />
        <Reminders />
        <Gate>{children}</Gate>
        <Toasts />
      </div>
    </CrmProvider>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const { session } = useCrm();
  if (!session) return <p className="crm-empty">Đang tải phiên làm việc…</p>;
  if (!session.permissions.has('crm.customer.read')) return <div className="crm-guard" role="alert">Tài khoản này chưa được cấp quyền xem CRM (crm.customer.read).</div>;
  return <>{children}</>;
}
