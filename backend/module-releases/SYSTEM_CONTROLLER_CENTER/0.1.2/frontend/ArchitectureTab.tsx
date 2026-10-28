import { useEffect, useState } from 'react';
import { controllerList, exportAll, printable } from './controllerApi';
import type { ApiRow, ListResult } from './controllerApi';
import './controller.css';
const keyOf=(r:ApiRow)=>typeof r.moduleKey==='string'?r.moduleKey:'';
export function ArchitectureTab({onSessionLost}:{onSessionLost:()=>void}){
 const [page,setPage]=useState(1);const [result,setResult]=useState<ListResult|null>(null);
 const [selected,setSelected]=useState('');const [functions,setFunctions]=useState<ListResult|null>(null);
 const [functionPage,setFunctionPage]=useState(1);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;setBusy(true);setError('');void controllerList(`architecture/modules?page=${page}`,onSessionLost).then(v=>{if(live)setResult(v);}).catch(e=>{if(live)setError(String(e));}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;};},[page,onSessionLost]);
 useEffect(()=>{if(!selected){setFunctions(null);return;}let live=true;setError('');void controllerList(`architecture/functions?moduleKey=${encodeURIComponent(selected)}&page=${functionPage}`,onSessionLost).then(v=>{if(live)setFunctions(v);}).catch(e=>{if(live)setError(String(e));});return()=>{live=false;};},[selected,functionPage,onSessionLost]);
 return <div className="scc-page">
  <header className="scc-header"><div><h2>Foundation · Module · Phiên bản</h2><p>Xem mọi version đã đăng ký và các Function/Action thuộc version; không có quyền chỉnh sửa.</p></div>
   <button className="scc-btn" disabled={!result} onClick={()=>void exportAll('architecture/modules','FOUNDATION_VERSIONS',onSessionLost).catch(e=>setError(String(e)))}>Xuất báo cáo toàn bộ</button></header>
  {error&&<p className="scc-error" role="alert">{error}</p>}
  <section className="scc-card"><h3>Module & phiên bản {busy?'· đang đọc…':''}</h3>
   <div className="scc-table"><table><thead><tr><th>Module</th><th>Phiên bản</th><th>Lifecycle</th><th>Trạng thái module</th><th>MIC hash</th><th></th></tr></thead><tbody>
    {result?.rows.map((r,i)=><tr key={`${keyOf(r)}-${printable(r.version)}-${i}`}><td><b>{keyOf(r)}</b><small>{printable(r.moduleName)}</small></td><td>{printable(r.version)}</td><td>{printable(r.status)}</td><td>{r.enabled===true?'ENABLED':'DISABLED'}</td><td><code>{printable(r.manifestHash).slice(0,14)}…</code></td><td><button className="scc-btn" onClick={()=>{setSelected(keyOf(r));setFunctionPage(1);}}>Chức năng</button></td></tr>)}
    {!result?.rows.length&&<tr><td colSpan={6}>Không có dòng trong trang hoặc nguồn không khả dụng.</td></tr>}</tbody></table></div>
   <div className="scc-pager"><button className="scc-btn" disabled={page===1||busy} onClick={()=>setPage(p=>p-1)}>← Trước</button>Trang {page}<button className="scc-btn" disabled={busy||!result?.hasNext} onClick={()=>setPage(p=>p+1)}>Tiếp →</button></div>
  </section>
  {selected&&<section className="scc-card"><div className="scc-header"><h3>Function / Action — {selected}</h3><button className="scc-btn" disabled={!functions} onClick={()=>void exportAll(`architecture/functions?moduleKey=${encodeURIComponent(selected)}`,'FUNCTION_ACTIONS',onSessionLost,selected).catch(e=>setError(String(e)))}>Xuất TXT toàn bộ</button></div>
   <div className="scc-table"><table><thead><tr><th>Version</th><th>Trạng thái</th><th>Function</th><th>Tên</th><th>Action</th></tr></thead><tbody>
    {functions?.rows.map((r,i)=><tr key={i}><td>{printable(r.version)}</td><td>{printable(r.versionStatus)}</td><td>{printable(r.functionKey)}</td><td>{printable(r.functionName)}</td><td>{printable(r.actionKey)}</td></tr>)}
   </tbody></table></div><div className="scc-pager"><button className="scc-btn" disabled={functionPage===1} onClick={()=>setFunctionPage(p=>p-1)}>← Trước</button>Trang {functionPage}<button className="scc-btn" disabled={!functions?.hasNext} onClick={()=>setFunctionPage(p=>p+1)}>Tiếp →</button></div>
  </section>}
 </div>;
}
