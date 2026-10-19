import { useEffect, useState } from 'react';
import { systemTestApi } from './systemTestApi';
import type { CheckResult, Health, QuickCheckRun } from './systemTestApi';
import { FeedbackLine, formatTime } from './common';
import type { Feedback } from './common';
import { CheckList, settleSt } from './common';

// TAB 1 — Kiểm tra hệ thống. Before a run every component is NOT_TESTED (never PASS without a real check). The quick
// check is POST /api/system-test/checks/run: read-only on the server (no module or database change).

const COMPONENTS: readonly [string, string][] = [
  ['AUTHENTICATION', 'Authentication'], ['SESSION', 'Session'], ['IAM', 'IAM permission evaluation'], ['POSTGRESQL', 'PostgreSQL connectivity'],
  ['REGISTRY', 'Foundation Registry'], ['VERSION_MIC', 'Version / MIC'], ['FUNCTION_ACTION', 'Function & Action'], ['DATA_CONTRACTS', 'Data Contracts'],
  ['COMPATIBILITY', 'Compatibility'], ['LIFECYCLE', 'Lifecycle'], ['NAVIGATION', 'Navigation'], ['MODULE_API', 'Module API'],
];

const NOT_RUN: CheckResult[] = COMPONENTS.map(([key, label]) => ({ key, label, status: 'NOT_TESTED', detail: 'Chưa kiểm tra.' }));

export function DiagnosticsTab({ onSessionLost }: { onSessionLost: () => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [run, setRun] = useState<QuickCheckRun | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void systemTestApi.health().then((r) => setHealth(settleSt(r, onSessionLost, setFeedback)));
  }, [onSessionLost]);

  async function check() {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    const data = settleSt(await systemTestApi.runChecks(), onSessionLost, setFeedback);
    if (data) setRun(data);
    setBusy(false);
  }

  return (
    <>
      <div className="fx-toolbar">
        <button type="button" className="fx-btn primary" disabled={busy} onClick={() => void check()}>{busy ? 'Đang kiểm tra…' : 'Chạy kiểm tra nhanh'}</button>
        {health && <span className="muted">Module {health.moduleKey} đang bật, có phiên bản ACTIVE (máy chủ trả lời lúc {formatTime(health.checkedAt)}).</span>}
      </div>
      <FeedbackLine feedback={feedback} />
      {run && (
        <p className="st-summary">
          Lần chạy {formatTime(run.finishedAt)} · PASS {run.summary.PASS} · FAIL {run.summary.FAIL} · NOT_TESTED {run.summary.NOT_TESTED} · UNAVAILABLE {run.summary.UNAVAILABLE}
          <span className="muted"> · Mã yêu cầu {run.runId}</span>
        </p>
      )}
      <CheckList results={run ? run.results : NOT_RUN} />
      <div className="note">Kiểm tra nhanh chỉ đọc: không thay đổi trạng thái Module hay dữ liệu PostgreSQL. Kết quả PASS chỉ xuất hiện sau khi máy chủ thực sự kiểm tra.</div>
    </>
  );
}
