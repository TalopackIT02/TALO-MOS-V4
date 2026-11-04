import type { QuickCheckRun, ResultsView, RegressionRun } from './systemTestApi';

// Human-readable UTF-8 report. Uses the redacted operational summary already
// returned by SYSTEM_CONTROLLER_CENTER. Never exports DB table rows, cookie or raw audit metadata.
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
  const s=run.fleetSummary;
  if(s){
    const other=(k:keyof typeof s.all)=>s.all[k]-s.fixtureCandidates[k];
    lines.push('','FLEET — TOÀN REGISTRY (tổng | module khác | ứng viên fixture FBET_*)',
      `Registered: ${s.all.registered} | ${other('registered')} | ${s.fixtureCandidates.registered}`,
      `ENABLED: ${s.all.enabled} | ${other('enabled')} | ${s.fixtureCandidates.enabled}`,
      `ENABLED + 1 ACTIVE: ${s.all.enabledActive} | ${other('enabledActive')} | ${s.fixtureCandidates.enabledActive}`,
      `ENABLED sai lifecycle: ${s.all.enabledWithoutActive+s.all.multiActive} | ${other('enabledWithoutActive')+other('multiActive')} | ${s.fixtureCandidates.enabledWithoutActive+s.fixtureCandidates.multiActive}`,
      `Chưa có version: ${s.all.noVersion} | ${other('noVersion')} | ${s.fixtureCandidates.noVersion}`,
      `Version: ${s.all.versions} (${Object.entries(s.versionStatuses).map(([k,v])=>`${k} ${v}`).join(', ')})`,
      `Triển khai: REGISTERED ${s.tiers.registered} → ACTIVE ${s.tiers.active} → INSTALLED ${s.tiers.installed??'—'} → LOADED ${s.tiers.loaded??'—'} → SERVING ${s.tiers.serving??'—'}`,
      ...(s.packages?s.packages.map(p=>`- package ${clean(p.moduleKey)} ${clean(p.packageVersion)}: ${clean(p.state)}`):['Host chưa cung cấp deploymentState: INSTALLED / LOADED / SERVING chưa xác minh.']));
  }
  lines.push('','MODULE FLEET (danh sách hiển thị có giới hạn)');
  for(const m of run.fleet) lines.push(`- ${clean(m.moduleKey)} | enabled=${m.enabled} | versions=${m.versionCount} | active=${m.activeVersions}${m.fixtureCandidate?' | fixture-candidate':''}`);
  if(!run.fleetComplete)lines.push(s?'NOTE: danh sách module hiển thị có giới hạn; các số liệu FLEET ở trên là toàn bộ Registry.'
    :'WARNING: Fleet không đầy đủ; không được suy diễn module chưa liệt kê là không tồn tại.');
  return lines;
}
function regression(run:RegressionRun):string[]{
  const lines=['FULL REGRESSION',line('Run ID',run.runId),line('Start',run.startedAt),line('Finished',run.finishedAt),
    line('Status',run.status),line('Database',run.target.database),line('Node Environment',run.target.nodeEnv),
    line('Host',`${run.target.host}${run.target.port?`:${run.target.port}`:''}`),
    line('Source environment',`${run.environment}${run.environment!=='TEST'?' (KHÔNG phải bằng chứng runtime TEST)':''}`),
    line('Source commit',run.source?`${run.source.commit}${run.source.dirty?' + uncommitted changes':''}`:'không có (format 1)'),'','TEST SUITES'];
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
