import { useEffect } from 'react';
import { describeSystemTestFailure } from './systemTestApi';
import type { ApiResult, CheckResult, CheckStatus } from './systemTestApi';
import './system-controller-center.css';

export interface Feedback { readonly tone: 'error' | 'success' | 'info'; readonly text: string }
export function FeedbackLine({feedback}:{feedback:Feedback|null}) {
  return feedback ? <div className={`st-feedback st-feedback-${feedback.tone}`} role={feedback.tone==='error'?'alert':'status'}>{feedback.text}</div> : null;
}
export function formatTime(value: string | null): string {
  if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
}
export function settleSt<T>(result: ApiResult<T>, onSessionLost: () => void, report: (f: Feedback) => void): T | null {
  if (result.ok) return result.data;
  if (result.status === 401) { onSessionLost(); return null; }
  report({tone:'error',text:describeSystemTestFailure(result)}); return null;
}
export type Level = 'critical' | 'warning' | 'normal';
export function severity(status: CheckStatus | string): Level {
  return status === 'FAIL' || status === 'TIMEOUT' ? 'critical' : status === 'PASS' ? 'normal' : 'warning';
}
export function StatusBadge({status}:{status:string}) {
  return <span className={`st-pill st-pill-${severity(status)}`}>{status.replace('_',' ')}</span>;
}
export const CHECK_GROUPS: Record<string,string> = {
  AUTHENTICATION:'ACCESS',SESSION:'ACCESS',IAM:'ACCESS',MODULE_API:'ACCESS',
  POSTGRESQL:'DATABASE',DB_CONNECTIONS:'DATABASE',DB_DEADLOCKS:'DATABASE',DB_ROLLBACKS:'DATABASE',
  REGISTRY:'FOUNDATION',VERSION_MIC:'FOUNDATION',FUNCTION_ACTION:'FOUNDATION',DATA_CONTRACTS:'FOUNDATION',COMPATIBILITY:'FOUNDATION',LIFECYCLE:'FOUNDATION',NAVIGATION:'FOUNDATION',
  FLEET_DISCOVERY:'MODULES',FLEET_LIFECYCLE:'MODULES',FLEET_RELEASES:'MODULES',DEPLOYMENT_SYNC:'MODULES',
  AUDIT_DENIED:'AUDIT',AUDIT_FAILURE:'AUDIT',REGRESSION:'TESTS',
};
export const GROUP_LABELS: Record<string,string> = {ALL:'Tất cả',ACCESS:'Access / IAM',DATABASE:'PostgreSQL',FOUNDATION:'Foundation',MODULES:'Module fleet',AUDIT:'Audit',TESTS:'Regression'};
const HELP: Record<string,string> = {
  FLEET_DISCOVERY:'Kiểm tra các module đã đăng ký trong Foundation B01. Không khẳng định package đang chạy có mã nguồn tương ứng.',
  FLEET_LIFECYCLE:'Đếm ACTIVE version theo trạng thái ENABLED. Module DISABLED có thể là lựa chọn chủ động.',
  DEPLOYMENT_SYNC:'Muốn kiểm tra package đã sync cần capability/runner riêng được phê duyệt. Không tự truy cập file hệ thống từ request.',
  DB_CONNECTIONS:'Chỉ báo áp lực kết nối hiện tại theo max_connections, không thay thế giám sát tài nguyên của PostgreSQL.',
  DB_DEADLOCKS:'Số liệu cộng dồn của pg_stat_database từ stats_reset, không phải số deadlock hiện tại.',
  DB_ROLLBACKS:'Chỉ cung cấp số liệu tham khảo; không suy diễn rollback luôn là lỗi.',
  AUDIT_DENIED:'DENIED có thể thể hiện an ninh hoạt động đúng. Cần phân tích theo nguyên nhân và lưu lượng.',
  AUDIT_FAILURE:'FAILURE xuất hiện trong B08 chỉ là tín hiệu cần xem xét, không suy diễn sự cố toàn hệ thống.',
  REGRESSION:'Regression không chạy qua browser/API; chỉ đọc artifact đã được runner CLI của Host sinh ra.',
};
export function StatusBars({counts}:{counts:{critical:number;warning:number;normal:number}}) {
  const total=counts.critical+counts.warning+counts.normal;
  const definitions: {key:Level;label:string;note:string}[]=[
    {key:'critical',label:'CRITICAL',note:'Cần xử lý'},
    {key:'warning',label:'WARNING',note:'Cần theo dõi / chưa xác minh'},
    {key:'normal',label:'NORMAL',note:'Đạt kiểm tra'},
  ];
  return <div className="st-meter" aria-label="Ba mức trạng thái hệ thống">
    {definitions.map(({key,label,note})=><div className={`st-meter-line st-${key}`} key={key}>
      <div className="st-meter-label"><span className="st-led"/><b>{label}</b><small>{note}</small><strong>{counts[key]}</strong></div>
      <div className="st-meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={counts[key]}>
        <div className="st-meter-fill" style={{width:`${total?Math.max(0,counts[key]/total*100):0}%`}}/>
      </div>
    </div>)}
    <p className="st-meter-footnote">{total ? `${total} tín hiệu đã tổng hợp từ kết quả thực tế.` : 'Chưa có kết quả đo. Không hiển thị trạng thái xanh mặc định.'}</p>
  </div>;
}
export function checkCounts(items:readonly {status:string}[]) {
  return items.reduce((acc,x)=>{acc[severity(x.status)]+=1;return acc;},{critical:0,warning:0,normal:0});
}
export interface DrawerData {title:string;status:string;group?:string;description:string;lines?:readonly string[];reference?:string}
export function DetailDrawer({data,onClose}:{data:DrawerData|null;onClose:()=>void}) {
  useEffect(()=>{
    if(!data) return;
    const close=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};
    window.addEventListener('keydown',close);return ()=>window.removeEventListener('keydown',close);
  },[data,onClose]);
  if(!data) return null;
  return <div className="st-drawer-overlay" onMouseDown={(e)=>{if(e.target===e.currentTarget)onClose();}}>
    <section className="st-drawer" role="dialog" aria-modal="true" aria-label={`Chi tiết ${data.title}`}>
      <div className="st-drawer-head"><div><small className="st-eyebrow">CHECK DETAILS · {data.group??'SYSTEM'}</small><h2>{data.title}</h2></div>
        <button type="button" className="st-icon-btn" onClick={onClose} aria-label="Đóng chi tiết">✕</button></div>
      <div className="st-drawer-body"><StatusBadge status={data.status}/><h3>Thông tin kiểm tra</h3><p className="st-detail-text">{data.description}</p>
        {data.lines && data.lines.length>0 && <><h3>Chi tiết / kết quả</h3><div className="st-detail-lines">{data.lines.map((l,i)=><p key={i}>{l}</p>)}</div></>}
        {data.reference&&<><h3>Mã tham chiếu</h3><code className="st-detail-code">{data.reference}</code></>}
        {data.group&&HELP[data.group]&&<div className="st-drawer-hint">{HELP[data.group]}</div>}
      </div><div className="st-drawer-bottom"><button type="button" className="st-button" onClick={onClose}>Đóng panel</button></div>
    </section>
  </div>;
}
export function CheckTable({results,onPick}:{results:readonly CheckResult[];onPick:(x:CheckResult)=>void}) {
  return <div className="st-matrix" role="list" aria-label="Danh sách phép kiểm tra">
    {results.map((r,i)=><button type="button" key={r.key} className="st-matrix-row" role="listitem" onClick={()=>onPick(r)}>
      <span className="st-row-index">{String(i+1).padStart(2,'0')}</span>
      <span className={`st-row-led st-${severity(r.status)}`}/>
      <span className="st-row-main"><strong>{r.label}</strong><small>{CHECK_GROUPS[r.key]??'DIAGNOSTICS'} · {r.key}</small></span>
      <span className="st-row-detail">{r.detail}</span>
      <StatusBadge status={r.status}/><span className="st-row-arrow">↗</span>
    </button>)}
  </div>;
}
