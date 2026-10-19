import { useCallback, useEffect, useState } from 'react';
import { systemTestApi } from '../../services/system-test/systemTestApi';
import type { ResultsView } from '../../services/system-test/systemTestApi';
import { FeedbackLine, formatTime } from '../foundation/common';
import type { Feedback } from '../foundation/common';
import { CheckBadge, CheckList, settleSt } from './common';

// TAB 3 — Chạy test & xem kết quả. QUICK TEST: the read-only checks of the server. FULL REGRESSION: the existing suites,
// run ONLY by the local TEST runner from the command line (the API runs no command); this tab reads the redacted result
// file through GET /api/system-test/results.

const RUNNER_COMMAND = 'cd backend && npx tsx test/system-test/regression.cli.ts';

export function RunnerTab({ onSessionLost }: { onSessionLost: () => void }) {
  const [results, setResults] = useState<ResultsView | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setResults(settleSt(await systemTestApi.results(), onSessionLost, setFeedback));
  }, [onSessionLost]);

  useEffect(() => {
    void load();
  }, [load]);

  async function quick() {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    const data = settleSt(await systemTestApi.runChecks(), onSessionLost, setFeedback);
    if (data) await load();
    setBusy(false);
  }

  const regression = results?.regression;
  return (
    <>
      <FeedbackLine feedback={feedback} />
      <section className="st-block">
        <div className="st-block-head">
          <h3>QUICK TEST</h3>
          <button type="button" className="fx-btn primary" disabled={busy} onClick={() => void quick()}>{busy ? 'Đang kiểm tra…' : 'Chạy kiểm tra nhanh'}</button>
        </div>
        {results?.quickCheck ? (
          <>
            <p className="st-summary">Lần chạy gần nhất {formatTime(results.quickCheck.finishedAt)} · PASS {results.quickCheck.summary.PASS} · FAIL {results.quickCheck.summary.FAIL}
              {' '}· NOT_TESTED {results.quickCheck.summary.NOT_TESTED} · UNAVAILABLE {results.quickCheck.summary.UNAVAILABLE}</p>
            <CheckList results={results.quickCheck.results} />
          </>
        ) : <p className="muted">Chưa có lần kiểm tra nhanh nào kể từ khi máy chủ khởi động.</p>}
      </section>

      <section className="st-block">
        <div className="st-block-head">
          <h3>FULL REGRESSION</h3>
          <button type="button" className="fx-btn" onClick={() => void load()}>Tải lại kết quả</button>
        </div>
        <div className="note" style={{ marginTop: 0 }}>
          Full Regression chỉ chạy bằng runner TEST cục bộ (tập lệnh cố định, cơ sở dữ liệu talo_mos_v4_test trên localhost):{' '}
          <code>{RUNNER_COMMAND}</code>. Giao diện và API không chạy lệnh; màn hình này chỉ đọc kết quả đã được lọc bí mật.
        </div>
        {!regression ? null : regression.state === 'NOT_RUN' ? <p className="muted">Chưa có kết quả Full Regression (NOT_TESTED).</p>
          : regression.state === 'INVALID' ? <p className="fx-msg error">Tệp kết quả không hợp lệ; máy chủ không hiển thị nội dung.</p> : (
            <>
              <p className="st-summary">
                Lần chạy {regression.run.runId} · <CheckBadge status={regression.run.status === 'ABORTED' ? 'NOT_TESTED' : regression.run.status} /> {regression.run.status}
                {' '}· {formatTime(regression.run.startedAt)} → {formatTime(regression.run.finishedAt)} · {regression.run.target.database}@{regression.run.target.host}
              </p>
              <div className="st-grid st-grid-short">
                <table>
                  <thead><tr><th>Suite</th><th>Trạng thái</th><th>Exit code</th><th>Tests (pass / fail / skip)</th><th>Thời gian</th><th /></tr></thead>
                  <tbody>
                    {regression.run.suites.map((s) => (
                      <tr key={s.key}>
                        <td><b>{s.label}</b><br /><small className="muted">{s.command}</small></td>
                        <td><CheckBadge status={s.status} /></td>
                        <td>{s.exitCode ?? '—'}</td>
                        <td>{s.tests ? `${s.tests.passed} / ${s.tests.failed} / ${s.tests.skipped}` : '—'}</td>
                        <td>{Math.round(s.durationMs / 1000)} s</td>
                        <td><button type="button" className="fx-btn" onClick={() => setOpen(open === s.key ? null : s.key)}>{open === s.key ? 'Ẩn' : 'Chi tiết'}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {regression.run.suites.filter((s) => s.key === open).map((s) => (
                <pre key={s.key} className="st-log">{s.summary.length > 0 ? s.summary.join('\n') : '(không có dòng tóm tắt)'}</pre>
              ))}
            </>
          )}
      </section>
    </>
  );
}
