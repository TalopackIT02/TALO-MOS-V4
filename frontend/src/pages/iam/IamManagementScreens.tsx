import { useCallback, useEffect, useState } from 'react';
import { iamApi } from '../../services/iam/iamApi';
import type { Account,Role,Permission,Row } from '../../services/iam/iamApi';
import { foundationApi } from '../../services/foundation/foundationApi';
import type { ModuleRecord } from '../../services/foundation/foundationApi';
import { FeedbackLine,settle } from '../foundation/common';
import type { Feedback } from '../foundation/common';

const val=(r:Row,key:string)=>String(r[key]??'—');
async function action(result:Promise<import('../../services/foundation/foundationApi').ApiResult<unknown>>,onSessionLost:()=>void,setFeedback:(v:Feedback|null)=>void,onDone:()=>void){
  const data=settle(await result,onSessionLost,(v)=>setFeedback(v));
  if(data!==null){setFeedback({tone:'success',text:'Thao tác đã được ghi nhận.'});onDone();}
}
export function AccountsScreen({onSessionLost}:{onSessionLost:()=>void}){
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState('');
  const [roleId,setRoleId]=useState('');
  const [permissionId,setPermissionId]=useState('');
  const [effect,setEffect]=useState<'ALLOW'|'DENY'>('ALLOW');
  const [reason,setReason]=useState('Cấp quyền theo yêu cầu quản trị');
  const [account,setAccount]=useState<Account|null>(null);
  const [roles,setRoles]=useState<Role[]>([]);
  const [permissions,setPermissions]=useState<Permission[]>([]);
  const [assignments,setAssignments]=useState<Row[]>([]);
  const [direct,setDirect]=useState<Row[]>([]);
  const [effective,setEffective]=useState<Row[]>([]);
  const [feedback,setFeedback]=useState<Feedback|null>(null);
  const load=useCallback(async()=>{const x=settle(await iamApi.accounts(search),onSessionLost,setFeedback);setAccount(null);return x;},[search,onSessionLost]);
  const [accounts,setAccounts]=useState<Account[]>([]);
  useEffect(()=>{void load().then(x=>setAccounts(x?.accounts??[]));},[load]);
  useEffect(()=>{void Promise.all([iamApi.roles(),iamApi.permissions()]).then(([r,p])=>{setRoles(settle(r,onSessionLost,setFeedback)?.roles??[]);setPermissions(settle(p,onSessionLost,setFeedback)?.permissions??[]);});},[onSessionLost]);
  const reload=useCallback(async()=>{if(!selected)return;const [a,r,p]=await Promise.all([iamApi.account(selected),iamApi.accountRoles(selected),iamApi.accountPermissions(selected)]);setAccount(settle(a,onSessionLost,setFeedback)?.account??null);setAssignments(settle(r,onSessionLost,setFeedback)?.roles??[]);const data=settle(p,onSessionLost,setFeedback);setDirect(data?.direct??[]);setEffective(data?.effective??[]);},[selected,onSessionLost]);
  useEffect(()=>{void reload();},[reload]);
  const doAction=(r:Promise<import('../../services/foundation/foundationApi').ApiResult<unknown>>)=>void action(r,onSessionLost,setFeedback,()=>void reload());
  return <div className="fx-section">
    <h3>Quản lý tài khoản</h3>
    <div className="fx-toolbar"><input aria-label="Tìm tài khoản" placeholder="Username / mã nhân viên / họ tên" value={search} onChange={e=>setSearch(e.target.value)}/><button className="fx-btn" onClick={()=>void load().then(x=>setAccounts(x?.accounts??[]))}>Tìm kiếm</button></div>
    <FeedbackLine feedback={feedback}/>
    <div className="tablewrap"><table><thead><tr><th>Tài khoản</th><th>Nhân viên</th><th>Trạng thái</th><th></th></tr></thead><tbody>{accounts.map(a=><tr key={a.accountId}><td>{a.username}</td><td>{a.employeeCode} — {a.fullName}</td><td>{a.accountStatus}</td><td><button className="fx-btn" onClick={()=>setSelected(a.accountId)}>Chi tiết</button></td></tr>)}</tbody></table></div>
    {account&&<section className="fx-section"><h3>{account.username} — {account.fullName}</h3><p>Account: {account.accountStatus}; Membership: {account.membershipStatus}</p>
      <h4>Vai trò được gán</h4><div className="tablewrap"><table><tbody>{assignments.map(a=><tr key={val(a,'userRoleId')}><td>{val(a,'roleCode')}</td><td>{val(a,'revokedAt')}</td><td>{!a.revokedAt&&<button className="fx-btn" onClick={()=>doAction(iamApi.revokeRole(account.accountId,val(a,'userRoleId')))}>Thu hồi</button>}</td></tr>)}</tbody></table></div>
      <div className="fx-toolbar"><select aria-label="Vai trò" value={roleId} onChange={e=>setRoleId(e.target.value)}><option value="">Chọn vai trò</option>{roles.map(r=><option key={r.roleId} value={r.roleId}>{r.roleCode}{!r.isActive?' (không hoạt động)':''}</option>)}</select><button className="fx-btn primary" disabled={!roleId} onClick={()=>doAction(iamApi.assignRole(account.accountId,roleId))}>Gán vai trò</button></div>
      <h4>Quyền trực tiếp</h4><div className="tablewrap"><table><tbody>{direct.map(a=><tr key={val(a,'userPermissionId')}><td>{val(a,'permissionCode')}</td><td>{val(a,'effect')}</td><td>{val(a,'revokedAt')}</td><td>{!a.revokedAt&&<button className="fx-btn" onClick={()=>doAction(iamApi.revokeDirect(account.accountId,val(a,'userPermissionId')))}>Thu hồi</button>}</td></tr>)}</tbody></table></div>
      <div className="fx-toolbar"><select aria-label="Permission" value={permissionId} onChange={e=>setPermissionId(e.target.value)}><option value="">Chọn permission</option>{permissions.map(p=><option key={p.permissionId} value={p.permissionId}>{p.permissionCode}</option>)}</select><select value={effect} onChange={e=>setEffect(e.target.value as 'ALLOW'|'DENY')}><option>ALLOW</option><option>DENY</option></select><input aria-label="Lý do" value={reason} onChange={e=>setReason(e.target.value)}/><button className="fx-btn primary" disabled={!permissionId||!reason.trim()} onClick={()=>doAction(iamApi.assignDirect(account.accountId,{permissionId,effect,reason}))}>Cấp quyền trực tiếp</button></div>
      <h4>Quyền hiệu lực (assurance phiên quản trị hiện tại)</h4><div className="tablewrap"><table><thead><tr><th>Permission</th><th>Hiệu lực</th><th>Lý do</th></tr></thead><tbody>{effective.map(x=><tr key={val(x,'permissionId')}><td>{val(x,'permissionCode')}</td><td>{x.allowed?'ALLOW':'DENY'}</td><td>{val(x,'reason')}</td></tr>)}</tbody></table></div>
    </section>}
  </div>;
}
export function RolesScreen({onSessionLost}:{onSessionLost:()=>void}){
  const [roles,setRoles]=useState<Role[]>([]);
  const [permissions,setPermissions]=useState<Permission[]>([]);
  const [selected,setSelected]=useState('');
  const [roleCode,setRoleCode]=useState('');
  const [roleName,setRoleName]=useState('');
  const [permissionId,setPermissionId]=useState('');
  const [assigned,setAssigned]=useState<Row[]>([]);
  const [feedback,setFeedback]=useState<Feedback|null>(null);
  const [modules,setModules]=useState<ModuleRecord[]>([]);
  const [moduleId,setModuleId]=useState('');
  const [functions,setFunctions]=useState<Row[]>([]);
  const [items,setItems]=useState<Row[]>([]);
  const [menuTitle,setMenuTitle]=useState('');
  const [functionId,setFunctionId]=useState('');
  const reload=useCallback(async()=>{const [r,p,n]=await Promise.all([iamApi.roles(),iamApi.permissions(),iamApi.navigationItems()]);setRoles(settle(r,onSessionLost,setFeedback)?.roles??[]);setPermissions(settle(p,onSessionLost,setFeedback)?.permissions??[]);setItems(settle(n,onSessionLost,setFeedback)?.items??[]);},[onSessionLost]);
  useEffect(()=>{void reload();void foundationApi.listModules().then(r=>setModules(settle(r,onSessionLost,setFeedback)??[]));},[reload,onSessionLost]);
  useEffect(()=>{if(selected)void iamApi.rolePermissions(selected).then(r=>setAssigned(settle(r,onSessionLost,setFeedback)?.permissions??[]));},[selected,onSessionLost]);
  useEffect(()=>{setFunctions([]);if(moduleId)void iamApi.functions(moduleId).then(r=>setFunctions(settle(r,onSessionLost,setFeedback)?.functions??[]));},[moduleId,onSessionLost]);
  const doAction=(result:Promise<import('../../services/foundation/foundationApi').ApiResult<unknown>>)=>void action(result,onSessionLost,setFeedback,()=>{void reload();if(selected)void iamApi.rolePermissions(selected).then(r=>setAssigned(settle(r,onSessionLost,setFeedback)?.permissions??[]));});
  return <div className="fx-section">
    <h3>Vai trò và quyền</h3><FeedbackLine feedback={feedback}/>
    <div className="fx-form"><label>Mã vai trò<input value={roleCode} onChange={e=>setRoleCode(e.target.value)}/></label><label>Tên vai trò<input value={roleName} onChange={e=>setRoleName(e.target.value)}/></label></div><button className="fx-btn primary" disabled={!roleCode||!roleName} onClick={()=>doAction(iamApi.addRole({roleCode,roleName}))}>Tạo vai trò</button>
    <div className="tablewrap"><table><thead><tr><th>Role</th><th>Tên</th><th>Trạng thái</th><th></th></tr></thead><tbody>{roles.map(r=><tr key={r.roleId}><td>{r.roleCode}</td><td>{r.roleName}</td><td>{r.isActive?'ACTIVE':'INACTIVE'}</td><td><button className="fx-btn" onClick={()=>setSelected(r.roleId)}>Quản lý quyền</button>{!r.isSystem&&<button className="fx-btn" onClick={()=>doAction(iamApi.updateRole(r.roleId,{isActive:!r.isActive}))}>{r.isActive?'Vô hiệu hóa':'Kích hoạt'}</button>}</td></tr>)}</tbody></table></div>
    {selected&&<section className="fx-section"><h4>Permissions của vai trò</h4>{assigned.map(a=><p key={val(a,'permissionId')}>{val(a,'permissionCode')} <button className="fx-btn" onClick={()=>doAction(iamApi.revokeRolePermission(selected,val(a,'permissionId')))}>Bỏ quyền</button></p>)}<div className="fx-toolbar"><select aria-label="Quyền cho role" value={permissionId} onChange={e=>setPermissionId(e.target.value)}><option value="">Chọn permission</option>{permissions.map(p=><option key={p.permissionId} value={p.permissionId}>{p.permissionCode}</option>)}</select><button className="fx-btn primary" disabled={!permissionId} onClick={()=>doAction(iamApi.assignRolePermission(selected,permissionId))}>Gán quyền</button></div></section>}
    <section className="fx-section"><h3>Danh mục Permission</h3><div className="tablewrap"><table><thead><tr><th>Permission code</th><th>Module</th><th>Resource</th><th>Operation</th></tr></thead><tbody>{permissions.map(p=><tr key={p.permissionId}><td>{p.permissionCode}</td><td>{p.moduleCode}</td><td>{p.resourceCode}</td><td>{p.operation}</td></tr>)}</tbody></table></div></section>
    <section className="fx-section"><h3>Foundation — Danh mục Function / B09</h3><p>Chỉ tra cứu trong IAM, thao tác tạo menu dùng API Foundation hiện hữu.</p><select aria-label="Module" value={moduleId} onChange={e=>setModuleId(e.target.value)}><option value="">Chọn module</option>{modules.map(m=><option key={m.moduleId} value={m.moduleId}>{m.moduleKey}</option>)}</select><div className="tablewrap"><table><thead><tr><th>Function</th><th>Hành động</th><th>Chọn</th></tr></thead><tbody>{functions.map(f=><tr key={val(f,'functionId')+val(f,'actionKey')}><td>{val(f,'functionKey')} — {val(f,'displayName')}</td><td>{val(f,'actionKey')}</td><td><button className="fx-btn" onClick={()=>{setFunctionId(val(f,'functionId'));setMenuTitle(val(f,'displayName'));}}>Chọn</button></td></tr>)}</tbody></table></div>
    <div className="fx-form"><label>Function UUID<input readOnly value={functionId}/></label><label>Tiêu đề menu<input value={menuTitle} onChange={e=>setMenuTitle(e.target.value)}/></label></div><button className="fx-btn primary" disabled={!moduleId||!functionId||!menuTitle.trim()} onClick={()=>doAction(foundationApi.createItem({parentId:null,moduleId,functionId,menuTitle,sortOrder:0,isVisible:true}))}>Tạo menu chức năng B09</button>
    <h4>B09 đang lưu</h4><div className="tablewrap"><table><thead><tr><th>Menu</th><th>Function ID</th><th>Hiển thị</th></tr></thead><tbody>{items.map(x=><tr key={val(x,'navigationId')}><td>{val(x,'menuTitle')}</td><td>{val(x,'functionId')}</td><td>{x.isVisible?'Có':'Không'}</td></tr>)}</tbody></table></div></section>
  </div>;
}
