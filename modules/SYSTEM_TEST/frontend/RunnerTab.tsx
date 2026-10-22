import { useCallback, useEffect, useState } from 'react';
import { systemTestApi } from './systemTestApi';
import type { CheckResult, ResultsView } from './systemTestApi';
import { CheckTable, DetailDrawer, FeedbackLine, StatusBadge, StatusBars, checkCounts, formatTime, settleSt } from './common';
import type { DrawerData, Feedback } from './common';

// Runner is deliberately split: browser may invoke read-only Quick Test; regression CLI runs ONLY outside HTTP.
const CLI = 'cd backend; npx tsx test/system-test/regression.cli.ts';
export function RunnerTab({onSessionLost}:{onSessionLost:()=>void}) {
  const [results,setResults]=useState<ResultsView|null>(null);
  const [feedback,setFeedback]=useState<Feedback|null>(null);
  const [busy,setBusy]=useState(false);
  const [drawer,setDrawer]=useState<DrawerData|null>(null);
  const load=useCallback(async()=>{setResults(settleSt(await systemTestApi.results(),onSessionLost,setFeedback));},[onSessionLost]);
  useEffect(()=>{void load();},[load]);
  async function runQuick(){
    if(busy)return;setBusy(true);setFeedback(null);
    try {const result=settleSt(await systemTestApi.runChecks(),onSessionLost,setFeedback);if(result)await load();}
    finally {setBusy(false);}
  }
  function pickCheck(x:CheckResult){setDrawer({title:x.label,status:x.status,group:x.key,
    description:x.detail,lines:['Loại: QUICK TEST (chỉ đọc)','Nguồn: Host / Foundation / PostgreSQL đã cấp quyền'],reference:results?.quickCheck?.runId});}
  const quick=results?.quickCheck;
  const reg=results?.regression;
  const suites=reg?.state==='AVAILABLE'?reg.run.suites:[];
  const counts=checkCounts(suites);
  return <div className="st-console">
    <header className="st-hero st-hero-runner"><div className="st-hero-head"><span className="st-eyebrow">TALO / QUALITY CONTROL</span>
      <span className="st-hero-version">TEST EXECUTION · V1.1.1</span></div>
      <div className="st-hero-main"><div><h1>Test runner <span>& results.</span></h1>
        <p>Kiểm tra nhanh ngay trên hệ thống; xem lịch sử và kết quả Full Regression của bộ runner CLI có sẵn.</p></div>
        <div className="st-hero-actions"><button type="button" className="st-button st-button-primary" disabled={busy} onClick={()=>void runQuick()}>
          ◉ {busy?'Đang thực hiện…':'Chạy quick tests'}</button>
          <button type="button" className="st-button st-button-ghost" onClick={()=>void load()}>↻ Làm mới kết quả</button></div></div>
      <div className="st-hero-footer"><span>QUICK <b>{quick?formatTime(quick.finishedAt):'NOT RUN'}</b></span>
        <span>FULL REGRESSION <b>{reg?.state==='AVAILABLE'?reg.run.status:reg?.state??'LOADING'}</b></span>
        <span>EXECUTION <b>SERVER / CLI ONLY</b></span></div></header>
    <FeedbackLine feedback={feedback}/>
    <section className="st-section"><div className="st-section-head"><div><span className="st-eyebrow">01 / DIRECT HEALTH TESTS</span><h2>Quick test results</h2></div>
      {quick&&<span className="st-section-count">{quick.results.length} checks · {quick.durationMs} ms</span>}</div>
      {quick?<><div className="st-inline-score"><span>{quick.summary.PASS} PASS</span><span>{quick.summary.FAIL} FAIL</span>
        <span>{quick.summary.WARN} WARN</span><span>{quick.summary.UNAVAILABLE} UNAVAILABLE</span><span>{quick.summary.NOT_TESTED} NOT TESTED</span></div>
        <CheckTable results={quick.results} onPick={pickCheck}/></>
        :<div className="st-empty st-empty-compact">Chưa có Quick Test của tài khoản trong phiên backend hiện tại.</div>}
    </section>
    <section className="st-section"><div className="st-section-head"><div><span className="st-eyebrow">02 / CLI REGRESSION ARTIFACT</span>
      <h2>Full regression history</h2></div><small className="st-note-inline">Nguồn: Host regressionResults()</small></div>
      <div className="st-command-bar"><span><b>SAFE EXECUTION</b> Full Regression không khởi chạy qua giao diện hoặc HTTP API.</span>
        <code>{CLI}</code><button type="button" className="st-button" onClick={()=>void load()}>Tải kết quả</button></div>
      {!reg?<div className="st-empty st-empty-compact">Đang đọc kết quả.</div>
        :reg.state==='NOT_RUN'?<div className="st-empty st-empty-compact">Chưa tìm thấy artifact từ CLI. Không đánh dấu kết quả PASS.</div>
        :reg.state==='INVALID'?<div className="st-feedback st-feedback-error">Artifact không hợp lệ. Không hiển thị dữ liệu không đáng tin cậy.</div>
        :<><div className="st-regression-overview"><div><StatusBadge status={reg.run.status==='ABORTED'?'NOT_RUN':reg.run.status}/>
          <strong>{reg.run.runId}</strong><small>{formatTime(reg.run.startedAt)} → {formatTime(reg.run.finishedAt)}</small>
          <small>{reg.run.target.database} · {reg.run.target.nodeEnv} · {reg.run.target.host}</small></div>
          <StatusBars counts={counts}/></div>
          <div className="st-suite-heading"><span>SUITE / COMMAND</span><span>TESTS</span><span>DURATION</span><span>STATUS</span></div>
          <div className="st-suites">{suites.map((s)=><button type="button" key={s.key} className="st-suite-row" onClick={()=>setDrawer({title:s.label,
            status:s.status,group:'REGRESSION',description:`Suite ${s.key}: ${s.command}`,reference:reg.run.runId,
            lines:[`Exit code: ${s.exitCode??'không có'}`,`Duration: ${s.durationMs} ms`,
              `Tests: ${s.tests?`${s.tests.passed} passed / ${s.tests.failed} failed / ${s.tests.skipped} skipped`:'không có số liệu'}`,
              ...s.summary]})}>
            <span><strong>{s.label}</strong><small>{s.key} · {s.command}</small></span>
            <span>{s.tests?`${s.tests.passed}/${s.tests.failed}/${s.tests.skipped}`:'—'}</span>
            <span>{(s.durationMs/1000).toFixed(1)}s</span><StatusBadge status={s.status}/></button>)}</div>
        </>}
    </section>
    <p className="st-disclaimer">Các phép đo chỉ phản ánh lần chạy có bằng chứng. Không có dữ liệu hoặc thiếu quyền luôn được biểu diễn là chưa xác minh, không phải trạng thái bình thường.</p>
    <DetailDrawer data={drawer} onClose={()=>setDrawer(null)}/>
  </div>;
}
