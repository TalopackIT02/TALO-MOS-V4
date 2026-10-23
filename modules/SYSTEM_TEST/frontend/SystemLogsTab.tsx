import { useCallback, useEffect, useState } from 'react';
import './system-logs.css';

type Source='FOUNDATION'|'IAM';
type State='AVAILABLE'|'UNAVAILABLE'|'NOT_REQUESTED';
interface Entry {
  eventId:string;source:Source;occurredAt:string;actorAccountId:string|null;actorUsername:string|null;
  actionCode:string;targetType:string;targetId:string|null;outcome:'SUCCESS'|'FAILURE'|'DENIED';
  reason:string|null;errorCode:string|null;correlationId:string|null;
}
interface Logs {
  scope:'RECORDED_AUDIT_ONLY';queriedAt:string;from:string;to:string;page:number;pageSize:number;hasNext:boolean;
  complete:boolean;sources:Record<Source,{state:State;sqlstate?:string}>;events:Entry[];
}
function isRecord(x:unknown):x is Record<string,unknown>{return typeof x==='object'&&x!==null&&!Array.isArray(x);}
function valid(x:unknown):x is Logs {
  if(!isRecord(x) || x.scope!=='RECORDED_AUDIT_ONLY'||!Array.isArray(x.events)||typeof x.complete!=='boolean')return false;
  // Capture the narrowed record before the callback; TS does not preserve a property guard on x.sources inside .every().
  const sources=x.sources;
  if(!isRecord(sources))return false;
  return (['FOUNDATION','IAM'] as const).every(k=>{
    const source=sources[k];
    return isRecord(source)&&['AVAILABLE','UNAVAILABLE','NOT_REQUESTED'].includes(String(source.state));
  }) && x.events.every(v=>isRecord(v)&&typeof v.eventId==='string'&&typeof v.actionCode==='string'&&typeof v.occurredAt==='string'&&typeof v.outcome==='string');
}
const time=(iso:string)=>new Date(iso).toLocaleString('vi-VN');
export function SystemLogsTab({onSessionLost}:{onSessionLost:()=>void}){
  const [source,setSource]=useState<'ALL'|Source>('ALL');
  const [outcome,setOutcome]=useState('ISSUES');
  const [action,setAction]=useState('');
  const [actor,setActor]=useState('');
  const [hours,setHours]=useState('24');
  const [page,setPage]=useState(1);
  const [result,setResult]=useState<Logs|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<Entry|null>(null);
  useEffect(()=>{if(!selected)return;const handler=(e:KeyboardEvent)=>{if(e.key==='Escape')setSelected(null);};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[selected]);
  const load=useCallback(async()=>{
    setBusy(true);setError('');
    const q=new URLSearchParams({source,outcome,action,page:String(page),pageSize:'25',
      from:new Date(Date.now()-Number(hours)*3600000).toISOString(),to:new Date().toISOString()});
    if(actor)q.set('actorAccountId',actor);
    try{
      const r=await fetch('/api/system-test/audit/logs?'+q,{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
      if(r.status===401){onSessionLost();return;}
      const body:unknown=await r.json();
      if(!r.ok){const e=isRecord(body)&&isRecord(body.error)?body.error:null;
        throw new Error(typeof e?.message==='string'?e.message:`HTTP ${r.status}`);}
      const value=isRecord(body)?body.logs:null;
      if(!valid(value))throw new Error('API nhật ký không đúng hợp đồng. Không hiển thị dữ liệu suy đoán.');
      setResult(value);
    }catch(e){setResult(null);setError(e instanceof Error?e.message:'Không đọc được nhật ký.');}
    finally{setBusy(false);}
  },[source,outcome,action,actor,hours,page,onSessionLost]);
  useEffect(()=>{void load();},[load]);
  return <div className="sl-root">
    <header className="sl-header"><div><strong>SYSTEM AUDIT LOGS</strong><h2>Nhật ký thao tác & lỗi</h2>
      <p>Tra cứu các thao tác <b>đã được ghi audit</b> trong Foundation và IAM. Chỉ đọc; nguồn không có audit sẽ không xuất hiện.</p></div>
      <button className="st-button" type="button" onClick={()=>void load()} disabled={busy}>{busy?'Đang tải…':'↻ Làm mới'}</button></header>
    <div className="sl-filters">
      <label>Nguồn<select value={source} onChange={e=>{setSource(e.target.value as typeof source);setPage(1);}}>
        <option value="ALL">Foundation + IAM</option><option value="FOUNDATION">Foundation B08</option><option value="IAM">IAM Audit</option></select></label>
      <label>Kết quả<select value={outcome} onChange={e=>{setOutcome(e.target.value);setPage(1);}}>
        <option value="ISSUES">Lỗi và từ chối</option><option value="ALL">Tất cả thao tác</option><option value="FAILURE">FAILURE</option>
        <option value="DENIED">DENIED</option><option value="SUCCESS">SUCCESS</option></select></label>
      <label>Khoảng thời gian<select value={hours} onChange={e=>{setHours(e.target.value);setPage(1);}}>
        <option value="1">1 giờ</option><option value="24">24 giờ</option><option value="168">7 ngày</option><option value="720">30 ngày</option></select></label>
      <label>Action code<input value={action} onChange={e=>{setAction(e.target.value);setPage(1);}} maxLength={80} placeholder="VD: LOGIN, ACTIVATE…"/></label>
      <label>Account UUID<input value={actor} onChange={e=>{setActor(e.target.value);setPage(1);}} placeholder="Để trống: mọi tài khoản"/></label>
    </div>
    {error&&<p role="alert" className="sl-error">{error}</p>}
    {result&&<>
      <div className="sl-sources">
        {(['FOUNDATION','IAM'] as const).map(src=><div key={src} className="sl-source">
          <b>{src}</b> <span className={result.sources[src].state==='AVAILABLE'?'sl-ok':'sl-warn'}>{result.sources[src].state}</span>
          {result.sources[src].sqlstate&&<small>SQLSTATE {result.sources[src].sqlstate}</small>}</div>)}
      </div>
      {!result.complete&&<p className="sl-warning" role="status">Chưa đọc được đầy đủ các nguồn đã chọn. Không được hiểu kết quả trống là hệ thống không có lỗi. Kiểm tra quyền SELECT của DB role hoặc log máy chủ.</p>}
      <p className="sl-caption">{time(result.from)} → {time(result.to)} · Trang {result.page} · {result.events.length} bản ghi đang hiển thị · Nguồn: audit đã lưu (không phải toàn bộ request hoặc exception chưa ghi log)</p>
      <div className="sl-table-wrap"><table className="sl-table"><thead><tr><th>Thời gian</th><th>Nguồn</th><th>Tài khoản</th><th>Hành động</th><th>Kết quả</th></tr></thead>
      <tbody>{result.events.map(x=><tr key={`${x.source}-${x.eventId}`} onClick={()=>setSelected(x)} tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')setSelected(x);}}>
        <td>{time(x.occurredAt)}</td><td>{x.source}</td><td>{x.actorUsername??x.actorAccountId??'System / Unknown'}</td>
        <td>{x.actionCode}<small>{x.targetType}</small></td><td><span className={`sl-pill sl-${x.outcome.toLowerCase()}`}>{x.outcome}</span></td></tr>)}
      {result.events.length===0&&<tr><td colSpan={5}>Không có bản ghi phù hợp trong những nguồn đọc được.</td></tr>}</tbody></table></div>
      <div className="sl-pages"><button className="st-button" disabled={busy||page===1} onClick={()=>setPage(p=>p-1)}>← Trước</button>
        <span>Trang {page}</span><button className="st-button" disabled={busy||!result.hasNext} onClick={()=>setPage(p=>p+1)}>Tiếp →</button></div>
    </>}
    {selected&&<div className="sl-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null);}}>
      <aside className="sl-drawer" role="dialog" aria-modal="true" aria-label="Chi tiết nhật ký">
        <div className="sl-drawer-head"><h3>Chi tiết sự kiện audit</h3><button className="st-button" onClick={()=>setSelected(null)}>✕ Đóng</button></div>
        <dl>{([
          ['Thời gian',time(selected.occurredAt)],['Nguồn',selected.source],['Kết quả',selected.outcome],
          ['Tài khoản',selected.actorUsername??'—'],['Account ID',selected.actorAccountId??'—'],
          ['Hành động',selected.actionCode],['Đối tượng',selected.targetType],['Target ID',selected.targetId??'—'],
          ['Reason (đã lọc)',selected.reason??'Không có dữ liệu an toàn để hiển thị'],
          ['Error Code',selected.errorCode??'—'],['Correlation ID',selected.correlationId??'—'],
          ['Event ID',selected.eventId],
        ] as const).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <p>Chỉ các trường audit an toàn được hiển thị; không tải raw metadata hoặc mật khẩu/token.</p>
      </aside></div>}
  </div>;
}
