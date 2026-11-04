import { useCallback, useEffect, useMemo, useState } from 'react';
import { systemTestApi } from './systemTestApi';
import { diagnosticsReportTxt, downloadTxt } from './reportTxt';
import type { CheckResult, FleetSummary, Health, QuickCheckRun } from './systemTestApi';
import { CheckTable, DetailDrawer, FeedbackLine, GROUP_LABELS, CHECK_GROUPS, StatusBars, StatusBadge, checkCounts, formatTime, settleSt } from './common';
import type { DrawerData, Feedback, Level } from './common';

// SCC 0.1.3: whole-registry counts (fixture candidates shown apart, never left out) and the five deployment layers.
function FleetSummaryPanel({s}:{s:FleetSummary}) {
  const n=(x:number|null)=>x===null?'—':x.toLocaleString('vi-VN');
  const other=(k:keyof FleetSummary['all'])=>s.all[k]-s.fixtureCandidates[k];
  const rows:[string,number,number,number][]=[
    ['Đã đăng ký (B01)',s.all.registered,other('registered'),s.fixtureCandidates.registered],
    ['ENABLED',s.all.enabled,other('enabled'),s.fixtureCandidates.enabled],
    ['Có đúng 1 ACTIVE',s.all.withActive,other('withActive'),s.fixtureCandidates.withActive],
    ['ENABLED + 1 ACTIVE',s.all.enabledActive,other('enabledActive'),s.fixtureCandidates.enabledActive],
    ['ENABLED sai lifecycle',s.all.enabledWithoutActive+s.all.multiActive,other('enabledWithoutActive')+other('multiActive'),s.fixtureCandidates.enabledWithoutActive+s.fixtureCandidates.multiActive],
    ['Chưa có version',s.all.noVersion,other('noVersion'),s.fixtureCandidates.noVersion],
    ['Version',s.all.versions,other('versions'),s.fixtureCandidates.versions],
  ];
  return <div className="st-fleet-summary">
    <div className="st-fleet-head"><span>TOÀN REGISTRY</span><span>TỔNG</span><span>MODULE KHÁC</span><span>ỨNG VIÊN FIXTURE FBET_*</span></div>
    {rows.map(([label,all,o,f])=><div key={label} className="st-fleet-row"><strong>{label}</strong><span>{n(all)}</span><span>{n(o)}</span><span>{n(f)}</span></div>)}
    <p className="st-note-inline">Version theo trạng thái: {Object.entries(s.versionStatuses).map(([k,v])=>`${k} ${n(v)}`).join(' · ')||'—'}</p>
    <p className="st-note-inline">Triển khai: REGISTERED {n(s.tiers.registered)} → ACTIVE {n(s.tiers.active)} → INSTALLED {n(s.tiers.installed)} → LOADED {n(s.tiers.loaded)} → SERVING {n(s.tiers.serving)}
      {s.tiers.installed===null?' (Host chưa cung cấp deploymentState: ba tầng cuối chưa xác minh).':'.'}</p>
    {s.packages&&<p className="st-note-inline">Package: {s.packages.map(p=>`${p.moduleKey} ${p.packageVersion} ${p.state}`).join(' · ')}</p>}
  </div>;
}

// System diagnostics: quick test is read-only; no result is fabricated before a successful run.
export function DiagnosticsTab({onSessionLost}:{onSessionLost:()=>void}) {
  const [health,setHealth]=useState<Health|null>(null);
  const [run,setRun]=useState<QuickCheckRun|null>(null);
  const [busy,setBusy]=useState(false);
  const [feedback,setFeedback]=useState<Feedback|null>(null);
  const [group,setGroup]=useState('ALL');
  const [level,setLevel]=useState<Level|'all'>('all');
  const [query,setQuery]=useState('');
  const [drawer,setDrawer]=useState<DrawerData|null>(null);

  useEffect(()=>{let active=true;void systemTestApi.health().then((r)=>{
    if(!active)return;setHealth(settleSt(r,onSessionLost,setFeedback));
  });return()=>{active=false;};},[onSessionLost]);

  const perform=useCallback(async()=>{
    if(busy)return;setBusy(true);setFeedback(null);
    try { const result=settleSt(await systemTestApi.runChecks(),onSessionLost,setFeedback);if(result)setRun(result); }
    finally {setBusy(false);}
  },[busy,onSessionLost]);

  async function copyReport(){
    if(!run)return;
    // Bounded operational metadata only; never contains table row values or credentials.
    const report={format:'TALO-SYSTEM-CONTROLLER-CENTER-DIAGNOSTICS-1',runId:run.runId,checkedAt:run.finishedAt,
      durationMs:run.durationMs,summary:run.summary,results:run.results,fleet:run.fleet,fleetSummary:run.fleetSummary};
    try {await navigator.clipboard.writeText(JSON.stringify(report,null,2));
      setFeedback({tone:'success',text:'Đã sao chép báo cáo kiểm tra vào clipboard.'});}
    catch {setFeedback({tone:'error',text:'Trình duyệt không cho phép sao chép. Không có tệp nào được xuất.'});}
  }

  const results=run?.results??[];
  const filtered=useMemo(()=>results.filter((r)=>{
    const category=CHECK_GROUPS[r.key]??'FOUNDATION';
    return (group==='ALL'||category===group) && (level==='all'||checkCounts([r])[level]===1)
      && (!query.trim()||`${r.key} ${r.label} ${r.detail}`.toLocaleLowerCase('vi').includes(query.trim().toLocaleLowerCase('vi')));
  }),[results,group,level,query]);
  const total=checkCounts(results);
  function showCheck(x:CheckResult) {
    setDrawer({title:x.label,status:x.status,group:x.key,description:x.detail,
      lines:[`Nhóm: ${GROUP_LABELS[CHECK_GROUPS[x.key]??'FOUNDATION']??'Diagnostics'}`,
        `Kiểm tra lúc: ${formatTime(run?.finishedAt??null)}`,
        `Mã phép kiểm tra: ${x.key}`],reference:run?.runId});
  }
  return <div className="st-console">
    <header className="st-hero">
      <div className="st-hero-head"><span className="st-eyebrow">TALO / OPS CONTROL <span className="st-online-dot"/> DIAGNOSTICS</span>
        <span className="st-hero-version">SYSTEM_CONTROLLER_CENTER · V0.1.3</span></div>
      <div className="st-hero-main"><div>
        <h1>System health <span>monitor.</span></h1>
        <p>Quan sát Foundation, IAM, PostgreSQL và các module vừa đăng ký. Phân loại dựa trên dữ kiện thực tế, không giả lập kết quả.</p>
      </div><div className="st-hero-actions"><button className="st-button st-button-primary" type="button" disabled={busy} onClick={()=>void perform()}>
        <span aria-hidden="true">◉</span> {busy?'Đang chạy kiểm tra…':'Chạy kiểm tra hệ thống'}
      </button><small>{run?`Lần gần nhất ${formatTime(run.finishedAt)} · ${run.durationMs} ms`:'Chưa chạy kiểm tra trong phiên này'}</small></div></div>
      <div className="st-hero-footer"><span>HOST <b>{health?.moduleKey??'CHƯA KẾT NỐI'}</b></span>
        <span>SESSION <b>{health?'ĐÃ XÁC NHẬN':'CHƯA XÁC NHẬN'}</b></span>
        <span>ACTIVE <b>{health?String(health.activeVersions):'—'}</b></span>
        <span>RUN ID <b>{run?.runId?.slice(0,14)??'—'}</b></span></div>
    </header>
    <FeedbackLine feedback={feedback}/>
    <section className="st-overview" aria-label="Tổng quan trạng thái">
      <div className="st-overview-text"><span className="st-eyebrow">REAL-TIME SNAPSHOT / ON-DEMAND</span>
        <h2>{!run?'Chưa có dữ liệu kiểm tra':total.critical?'Cần xử lý cảnh báo nghiêm trọng':total.warning?'Có vấn đề cần theo dõi':'Hệ thống đạt các phép kiểm tra'}</h2>
        <p>{run?`${results.length} phép kiểm trong ${run.durationMs} ms. Bấm vào từng mục để mở panel xem chi tiết.`:'Nhấn “Chạy kiểm tra hệ thống” để thu thập tín hiệu thực tế.'}</p>
        <div className="st-kpi-strip"><span><b>{results.length||'—'}</b> Checks</span><span><b>{run?(run.fleetSummary?.all.registered??run.fleet.length).toLocaleString('vi-VN'):'—'}</b> Modules</span><span><b>{run?formatTime(run.finishedAt):'—'}</b> Last run</span></div>
      </div>
      <StatusBars counts={total}/>
    </section>
    <section className="st-section">
      <div className="st-section-head"><div><span className="st-eyebrow">01 / SYSTEM CHECKLIST</span><h2>Kiểm tra vận hành</h2></div>
        <div className="st-section-tools"><span className="st-section-count">{filtered.length} / {results.length} mục</span>
          <button type="button" className="st-button" disabled={!run} onClick={()=>{ if(run) downloadTxt(diagnosticsReportTxt(run),'TALO_SYSTEM_DIAGNOSTICS'); }}>↓ Xuất TXT đầy đủ</button>
          <button type="button" className="st-button" disabled={!run} onClick={()=>void copyReport()}>⧉ Sao chép JSON</button></div></div>
      <div className="st-filters"><label className="st-search-label"><span aria-hidden="true">⌕</span>
        <input aria-label="Tìm phép kiểm tra" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Tìm phép kiểm tra, trạng thái, mã lỗi…"/></label>
        <select aria-label="Lọc nhóm kiểm tra" value={group} onChange={e=>setGroup(e.target.value)}>
          {Object.entries(GROUP_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="st-status-filter" aria-label="Lọc mức độ">
        {([['all','Tất cả'],['critical','Đỏ · Critical'],['warning','Vàng · Warning'],['normal','Xanh · Normal']] as const).map(([v,l])=><button type="button" key={v} onClick={()=>setLevel(v)}
          aria-pressed={level===v} className={`st-filter-chip ${level===v?'active':''}`}>{l}</button>)}
      </div>
      {!run?<div className="st-empty"><div className="st-empty-icon">◎</div><b>Chưa có lượt kiểm tra</b><p>Không tự hiển thị PASS khi chưa nhận kết quả từ backend.</p></div>
        :filtered.length===0?<div className="st-empty"><b>Không có mục phù hợp bộ lọc</b><p>Thử bỏ bộ lọc hoặc từ khóa đang nhập.</p></div>
        :<CheckTable results={filtered} onPick={showCheck}/>}
    </section>
    <section className="st-section">
      <div className="st-section-head"><div><span className="st-eyebrow">02 / CONNECTED MODULES</span><h2>Module registry watch</h2></div>
        <small className="st-note-inline">Nguồn: Foundation B01/B02 · Read-only</small></div>
      {run?.fleetSummary&&<FleetSummaryPanel s={run.fleetSummary}/>}
      {!run?<div className="st-empty st-empty-compact">Chạy kiểm tra để đọc danh sách module từ Foundation.</div>
        :run.fleet.length===0?<div className="st-empty st-empty-compact">Không đọc được module fleet hoặc Registry chưa có module.</div>
        :<><div className="st-fleet-head"><span>MODULE KEY</span><span>VERSION</span><span>LIFECYCLE</span><span>TRẠNG THÁI</span></div>
          <div className="st-fleet-list">{run.fleet.map(m=>{
            const status=m.activeVersions>1||(m.enabled&&m.activeVersions!==1)?'FAIL':!m.enabled||m.activeVersions===0?'WARN':'PASS';
            return <button key={m.moduleKey} type="button" className="st-fleet-row" onClick={()=>setDrawer({title:m.moduleKey,
              status,group:'FLEET_DISCOVERY',description:`Module Foundation ${m.moduleKey} ${m.enabled?'ENABLED':'DISABLED'}.`,
              lines:[`Đã đăng ký ${m.versionCount} version`,`Số ACTIVE: ${m.activeVersions}`,
                ...(m.fixtureCandidate?['Ứng viên fixture (tiền tố FBET_): chỉ là nhãn phân loại, vẫn được tính trong mọi số liệu.']:[]),
                'Chú ý: registry không chứng minh source package đã deploy hoặc API runtime đang phản hồi.']})}>
              <strong>{m.moduleKey}{m.fixtureCandidate?' · fixture?':''}</strong><span>{m.versionCount} registered</span><span>{m.enabled?'ENABLED':'DISABLED'}</span><StatusBadge status={status}/>
            </button>})}</div>
          {!run.fleetComplete&&<div className="st-feedback st-feedback-info">{run.fleetSummary
            ?'Danh sách hiển thị có giới hạn (module hệ thống/nghiệp vụ + module sai lifecycle). Số liệu tổng ở trên là toàn bộ Registry.'
            :'Không lấy được đầy đủ danh sách module (không có quyền hoặc vượt giới hạn 200).'}</div>}</>}
    </section>
    <p className="st-disclaimer">SYSTEM_CONTROLLER_CENTER chỉ quan sát và chẩn đoán. Không thay đổi IAM, lifecycle, dữ liệu PostgreSQL hoặc chạy câu lệnh shell qua HTTP.</p>
    <DetailDrawer data={drawer} onClose={()=>setDrawer(null)}/>
  </div>;
}
