import { useEffect,useState } from 'react';
import {controllerList,exportAll,printable} from './controllerApi';
import type {ListResult} from './controllerApi';
import './controller.css';
export function AccessMatrixTab({onSessionLost}:{onSessionLost:()=>void}){
 const [accountsPage,setAccountsPage]=useState(1),[matrixPage,setMatrixPage]=useState(1);
 const [accounts,setAccounts]=useState<ListResult|null>(null),[matrix,setMatrix]=useState<ListResult|null>(null);
 const [accountId,setAccountId]=useState(''),[username,setUsername]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let live=true;setError('');void controllerList(`access/accounts?page=${accountsPage}`,onSessionLost).then(r=>{if(live)setAccounts(r);}).catch(e=>{if(live)setError(String(e));});return()=>{live=false;};},[accountsPage,onSessionLost]);
 useEffect(()=>{if(!accountId){setMatrix(null);return;}let live=true;setError('');void controllerList(`access/matrix?accountId=${encodeURIComponent(accountId)}&page=${matrixPage}`,onSessionLost).then(r=>{if(live)setMatrix(r);}).catch(e=>{if(live)setError(String(e));});return()=>{live=false;};},[accountId,matrixPage,onSessionLost]);
 return <div className="scc-page"><header className="scc-header"><div><h2>Ma trận phân quyền IAM</h2><p>Đọc role và nguồn cấp quyền cho từng tài khoản; không xem mật khẩu, credential, session hoặc thông tin cá nhân.</p></div></header>
  {error&&<p className="scc-error" role="alert">{error}</p>}
  <section className="scc-card"><h3>Danh sách tài khoản (chỉ định danh tối thiểu)</h3>
   <div className="scc-table"><table><thead><tr><th>Tài khoản</th><th>Trạng thái</th><th>Role ACTIVE</th><th></th></tr></thead><tbody>
    {accounts?.rows.map((r,i)=><tr key={i}><td>{printable(r.username)}</td><td>{printable(r.status)}</td><td>{printable(r.roles)}</td><td><button className="scc-btn" onClick={()=>{setAccountId(String(r.accountId));setUsername(String(r.username));setMatrixPage(1);}}>Xem ma trận</button></td></tr>)}
   </tbody></table></div><div className="scc-pager"><button className="scc-btn" disabled={accountsPage===1} onClick={()=>setAccountsPage(p=>p-1)}>← Trước</button>Trang {accountsPage}<button className="scc-btn" disabled={!accounts?.hasNext} onClick={()=>setAccountsPage(p=>p+1)}>Tiếp →</button></div>
  </section>
  {accountId&&<section className="scc-card"><div className="scc-header"><div><h3>Quyền của {username}</h3><p>{matrix?.assumption||'Đang tải nguồn quyền…'}</p></div>
    <button className="scc-btn" disabled={!matrix} onClick={()=>void exportAll(`access/matrix?accountId=${encodeURIComponent(accountId)}`,'IAM_GRANT_MATRIX',onSessionLost,`${username} / ${accountId}\n${matrix?.assumption??''}`).catch(e=>setError(String(e)))}>Xuất TXT toàn bộ</button></div>
   <div className="scc-table"><table><thead><tr><th>Permission</th><th>Module</th><th>Thao tác</th><th>Role</th><th>Direct ALLOW</th><th>Direct DENY</th><th>Min AL</th></tr></thead><tbody>
   {matrix?.rows.map((r,i)=><tr key={i}><td>{printable(r.permissionCode)}</td><td>{printable(r.moduleCode)}</td><td>{printable(r.operation)}</td><td>{r.viaRole?'Có':'—'}</td><td>{r.directAllow?'Có':'—'}</td><td>{r.directDeny?'Có':'—'}</td><td>{printable(r.minimumAssuranceLevel)}</td></tr>)}
   </tbody></table></div><div className="scc-pager"><button className="scc-btn" disabled={matrixPage===1} onClick={()=>setMatrixPage(p=>p-1)}>← Trước</button>Trang {matrixPage}<button className="scc-btn" disabled={!matrix?.hasNext} onClick={()=>setMatrixPage(p=>p+1)}>Tiếp →</button></div></section>}
  </div>;
}
