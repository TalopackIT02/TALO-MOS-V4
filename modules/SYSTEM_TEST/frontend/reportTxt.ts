import type { QuickCheckRun, ResultsView, RegressionRun } from './systemTestApi';

// Human-readable UTF-8 report. Uses the redacted operational summary already
// returned by SYSTEM_TEST. Never exports DB table rows, cookie or raw audit metadata.
function clean(x:unknown):string{
  const s=String(x??'—').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,' ').slice(0,1200);
  return s.replace(/\b(?:Bearer\s+)[A-Za-z0-9._~-]+/gi,'Bearer [REDACTED]')
    .replace(/\b(password|passwd|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi,'$1=[REDACTED]')
    .replace(/postgres(?:ql)?:\/\/\S+/gi,'[REDACTED_CONNECTION]');
}
const line=(key:string,value:unknown)=>`${key}: ${clean(value)}`;
function checkRun(run:QuickCheckRun|null):string[]{
  if(run===null)return ['QUICK CHECK: NOT_RUN (chưa có kết quả được ghi nhận)'];
  const lines=['QUICK CHECK',line('Run ID',run.runId),line('Module',run.moduleKey),
    line('Start',run.startedAt),line('Finished',run.finishedAt),line('Duration (ms)',run.durationMs),
    ...(['PASS','FAIL','WARN','UNAVAILABLE','NOT_TESTED'] as const).map(s=>line(`Count ${s}`,run.summary[s])),
    line('Fleet complete',run.fleetComplete),'','TẤT CẢ PHÉP KIỂM TRA'];
  for(let i=0;i<run.results.length;i++){
    const c=run.results[i]!;
    lines.push(`${i+1}. [${clean(c.status)}] ${clean(c.key)} — ${clean(c.label)}`,`   ${clean(c.detail)}`);
  }
  lines.push('','MODULE FLEET');
  for(const m of run.fleet) lines.push(`- ${clean(m.moduleKey)} | enabled=${m.enabled} | versions=${m.versionCount} | active=${m.activeVersions}`);
  if(!run.fleetComplete)lines.push('WARNING: Fleet không đầy đủ; không được suy diễn module chưa liệt kê là không tồn tại.');
  return lines;
}
function regression(run:RegressionRun):string[]{
  const lines=['FULL REGRESSION',line('Run ID',run.runId),line('Start',run.startedAt),line('Finished',run.finishedAt),
    line('Status',run.status),line('Database',run.target.database),line('Node Environment',run.target.nodeEnv),
    line('Host',run.target.host),'','TEST SUITES'];
  for(let i=0;i<run.suites.length;i++){
    const s=run.suites[i]!;
    lines.push(`${i+1}. [${clean(s.status)}] ${clean(s.key)} — ${clean(s.label)}`,
      `   Command: ${clean(s.command)}`,
      `   Duration (ms): ${s.durationMs}; exitCode: ${s.exitCode??'NULL'}`,
      `   Tests: ${s.tests?`${s.tests.passed} passed, ${s.tests.failed} failed, ${s.tests.skipped} skipped`:'không có số liệu'}`);
    for(const part of s.summary)lines.push(`   ${clean(part)}`);
  }
  return lines;
}
export function diagnosticsReportTxt(run:QuickCheckRun):string{
  return ['TALO-MOS-V4 / SYSTEM CONTROL CENTER','SYSTEM DIAGNOSTICS — FULL TXT REPORT',
    line('Exported (UTC)',new Date().toISOString()),'Source: Quick Check (API), no fabricated results',
    'Scope: kết quả của đúng lượt quét được cung cấp, không phải tất cả lịch sử ứng dụng.','','='.repeat(72),
    ...checkRun(run),'','END OF REPORT'].join('\r\n');
}
export function resultsReportTxt(v:ResultsView):string{
  const reg=v.regression;
  return ['TALO-MOS-V4 / SYSTEM CONTROL CENTER','TEST RUNNER — FULL TXT REPORT',
    line('Exported (UTC)',new Date().toISOString()),
    'Scope: Quick Check gần nhất trong phiên backend của tài khoản + regression artifact hiện tại.',
    'Full Regression chạy bằng CLI bên ngoài HTTP; báo cáo không khởi chạy test.','',
    '='.repeat(72),...checkRun(v.quickCheck),'', '='.repeat(72),
    ...(reg.state==='AVAILABLE'?regression(reg.run):[`FULL REGRESSION: ${reg.state}`,
      reg.state==='INVALID'?'Artifact có định dạng không hợp lệ; không suy diễn PASS.':'Không tìm thấy artifact từ CLI.']),
    '','END OF REPORT'].join('\r\n');
}
export function downloadTxt(text:string,filePrefix:string):void {
  const date=new Date().toISOString().replace(/[:.]/g,'-');
  const blob=new Blob(['\ufeff',text],{type:'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`${filePrefix}_${date}.txt`;
  document.body.appendChild(a);a.click();a.remove();
  URL.revokeObjectURL(url);
}
