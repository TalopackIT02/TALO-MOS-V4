import type { ApiResult } from '../foundation/foundationApi';

export type Account={accountId:string;username:string;accountStatus:string;disabled:boolean;employeeCode:string;fullName:string;membershipStatus:string};
export type Role={roleId:string;roleCode:string;roleName:string;description:string|null;isActive:boolean;isSystem:boolean};
export type Permission={permissionId:string;permissionCode:string;moduleCode:string;resourceCode:string;operation:string;minimumAssuranceLevel:number;description:string|null};
export type Row=Record<string,unknown>;
type Payload=Record<string,unknown>;
async function request<T>(method:string,path:string,body?:unknown):Promise<ApiResult<T>> {
  let response:Response;
  try {
    response=await fetch('/api/iam/admin'+path,{method,credentials:'same-origin',cache:'no-store',headers:method==='GET'?{Accept:'application/json'}:{Accept:'application/json','Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body??{})})});
  } catch {return {ok:false,status:0,code:'NETWORK',details:[],requestId:''};}
  let raw:unknown;
  try {raw=await response.json();} catch {raw={};}
  const json=(typeof raw==='object'&&raw!==null&&!Array.isArray(raw)?raw:{}) as Payload;
  if(response.ok)return {ok:true,data:json as T};
  const err=(typeof json.error==='object'&&json.error!==null?json.error:{}) as Payload;
  return {ok:false,status:response.status,code:String(err.code??'UNKNOWN'),details:[],requestId:String(err.requestId??'')};
}
const e=encodeURIComponent;
export const iamApi={
 accounts:(search='')=>request<{accounts:Account[];total:number}>('GET','/accounts?search='+e(search)),
 account:(id:string)=>request<{account:Account}>('GET','/accounts/'+e(id)),
 roles:()=>request<{roles:Role[]}>('GET','/roles'),
 permissions:()=>request<{permissions:Permission[]}>('GET','/permissions'),
 accountRoles:(id:string)=>request<{roles:Row[]}>('GET','/accounts/'+e(id)+'/roles'),
 accountPermissions:(id:string)=>request<{direct:Row[];effective:Row[]}>('GET','/accounts/'+e(id)+'/permissions'),
 rolePermissions:(id:string)=>request<{permissions:Row[]}>('GET','/roles/'+e(id)+'/permissions'),
 addRole:(data:object)=>request('POST','/roles',data),
 updateRole:(id:string,data:object)=>request('PATCH','/roles/'+e(id),data),
 addPermission:(data:object)=>request('POST','/permissions',data),
 assignRole:(id:string,roleId:string)=>request('POST','/accounts/'+e(id)+'/roles',{roleId}),
 revokeRole:(id:string,assignmentId:string)=>request('POST','/accounts/'+e(id)+'/roles/'+e(assignmentId)+'/revoke',{}),
 assignDirect:(id:string,data:object)=>request('POST','/accounts/'+e(id)+'/permissions',data),
 revokeDirect:(id:string,assignmentId:string)=>request('POST','/accounts/'+e(id)+'/permissions/'+e(assignmentId)+'/revoke',{}),
 assignRolePermission:(roleId:string,permissionId:string)=>request('POST','/roles/'+e(roleId)+'/permissions',{permissionId}),
 revokeRolePermission:(roleId:string,permissionId:string)=>request('DELETE','/roles/'+e(roleId)+'/permissions/'+e(permissionId),{}),
 navigationItems:()=>request<{items:Row[]}>('GET','/foundation/navigation/items'),
 functions:(id:string)=>request<{functions:Row[]}>('GET','/foundation/modules/'+e(id)+'/functions'),
};
