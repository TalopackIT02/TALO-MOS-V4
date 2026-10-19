import { describeSystemTestFailure } from './systemTestApi';
import type { ApiResult, CheckResult } from './systemTestApi';
import './system-test.css';

// Shared pieces of the SYSTEM_TEST tabs (MOD-TEST-01). A 401 hands control back to App (login); every other failure
// is shown with the module's own texts (MODULE_UNAVAILABLE, TABLE_NOT_READABLE …) or the Foundation texts.

// MOD-TEST-02: the package carries its own small UI helpers (no import of the Host's screens); it relies only on the
// Host's shell styles (.fx-btn, .fx-toolbar, .fx-msg, .note, .muted) for a consistent look.
export interface Feedback {
  readonly tone: 'error' | 'success' | 'info';
  readonly text: string;
}

export function FeedbackLine({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;
  return <div className={`fx-msg ${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.text}</div>;
}

export function formatTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
}

export function settleSt<T>(result: ApiResult<T>, onSessionLost: () => void, report: (f: Feedback) => void): T | null {
  if (result.ok) return result.data;
  if (result.status === 401) {
    onSessionLost();
    return null;
  }
  report({ tone: 'error', text: describeSystemTestFailure(result) });
  return null;
}

const BADGES = new Set(['PASS', 'FAIL', 'NOT_TESTED', 'UNAVAILABLE', 'TIMEOUT', 'NOT_RUN']);

export function CheckBadge({ status }: { status: string }) {
  return <span className={`st-badge st-${BADGES.has(status) ? status.toLowerCase() : 'not_tested'}`}>{status}</span>;
}

export function CheckList({ results }: { results: readonly CheckResult[] }) {
  return (
    <div className="st-checks">
      {results.map((r) => (
        <div className="st-check" key={r.key}>
          <div className="st-check-head"><b>{r.label}</b><CheckBadge status={r.status} /></div>
          <p>{r.detail}</p>
        </div>
      ))}
    </div>
  );
}
