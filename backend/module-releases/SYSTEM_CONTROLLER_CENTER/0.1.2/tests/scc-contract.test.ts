import { describe,expect,it } from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {SCC_ADMIN_ROLE,ROLE_SQL,isAdministrator} from '../backend/administrator-gate.js';
import {isProtectedAccountTable,maskModeOf} from '../backend/data-inspector.masking.js';
import {SYSTEM_CONTROLLER_CENTER_BINDING} from '../backend/system-controller-center.permissions.js';
import {SystemAuditService} from '../backend/system-audit.service.js';
import {ControllerOverviewService,dataUnavailable} from '../backend/controller-overview.service.js';
import type {ModuleHost} from '../backend/host.js';
const root=join(import.meta.dirname,'..');
const manifest=JSON.parse(readFileSync(join(root,'module.json'),'utf8')) as {moduleKey:string;packageVersion:string;frontend:{screens:{tabs:{path:string}[]}[]}};
const mic=JSON.parse(readFileSync(join(root,'mic','module.mic.json'),'utf8')) as {
 mic01Identity:{moduleKey:string;moduleVersion:string};mic02Functions:{functionKey:string}[];
 mic03Actions:{functionKey:string;actionKey:string}[];mic05Api:{functionKey:string;actionKey:string;path:string}[];
 mic07IamMapping:{functionKey:string;actionKey:string;moduleCode:string;resourceCode:string;operation:string}[];
 mic09Compatibility:{kind:string};mic10Manifest:{testEvidence:{result:string}[]};
};
describe('SYSTEM_CONTROLLER_CENTER independent package',()=>{
 it('uses a separate module key and new route namespace',()=>{
  expect(manifest.moduleKey).toBe('SYSTEM_CONTROLLER_CENTER');
  expect(manifest.frontend.screens[0]?.tabs.every(t=>t.path.startsWith('/system-controller-center'))).toBe(true);
  expect(mic.mic09Compatibility.kind).toBe('CHANGE');
  expect(mic.mic01Identity.moduleVersion).toBe(manifest.packageVersion);
 });
 it('maps every action exactly once under K05 and every API to an action',()=>{
  const pairs=mic.mic03Actions.map(a=>`${a.functionKey}.${a.actionKey}`);
  expect(mic.mic07IamMapping.map(m=>`${m.functionKey}.${m.actionKey}`)).toEqual(pairs);
  expect(mic.mic07IamMapping.every(m=>m.moduleCode==='SYSTEM_CONTROLLER_CENTER' && m.resourceCode===m.functionKey && m.operation===m.actionKey)).toBe(true);
  expect(mic.mic05Api.every(a=>pairs.includes(`${a.functionKey}.${a.actionKey}`))).toBe(true);
 });
 it('binds AUDIT_LOG.READ to the deterministic catalog permission code',()=>{
  const permission=SYSTEM_CONTROLLER_CENTER_BINDING.auditRead;
  const canonical=`${permission.moduleCode}.${permission.resourceCode}.${permission.operation}`.toLowerCase();
  expect(canonical).toBe('system_controller_center.audit_log.read');
  expect(permission.permissionCode).toBe(canonical);
 });
 it('reads audit through the least-privilege database API instead of raw audit tables',()=>{
  const source=readFileSync(join(root,'backend','system-audit.service.ts'),'utf8');
  const diagnostics=readFileSync(join(root,'backend','system-controller-center.repository.ts'),'utf8');
  expect(source).toContain('audit_api.read_foundation_audit');
  expect(source).toContain('audit_api.read_iam_audit');
  expect(diagnostics).toContain('audit_api.read_foundation_audit_summary');
  expect(source).not.toMatch(/FROM\s+foundation\.fnd_audit_logs/i);
  expect(source).not.toMatch(/FROM\s+iam\.iam_audit_logs/i);
  expect(diagnostics).not.toMatch(/FROM\s+foundation\.fnd_audit_logs/i);
 });
 it('reports a successful function query as AVAILABLE and returns the recorded event',async()=>{
  const queries:string[]=[];
  const host={
   authorize:async()=>undefined,
   lifecycle:async()=>({isEnabled:true,activeVersions:1}),
   readOnly:async<T>(fn:(tx:{query:(sql:string,args:readonly unknown[])=>Promise<unknown[]>})=>Promise<T>):Promise<T>=>fn({
    query:async(sql)=>{queries.push(sql);return [{
     event_id:'00000000-0000-4000-8000-000000000099',source:'FOUNDATION',occurred_at:'2026-10-26T08:00:00.000000Z',
     actor_account_id:null,actor_username:null,action_code:'LOGIN',target_type:'SESSION',target_id:null,
     outcome:'SUCCESS',reason:'OK',error_code:null,correlation_id:'REQ-1',
    }];},
   }),
   sqlstate:()=>undefined,
   logger:{warn:()=>undefined},
  } as unknown as ModuleHost;
  const result=await new SystemAuditService(host).list(
   {userAccountId:'00000000-0000-4000-8000-000000000001',assuranceLevel:1,requestId:'REQ-1'},
   {source:'FOUNDATION',from:'2026-10-26T00:00:00+00:00',to:'2026-10-26T23:00:00+00:00'});
  expect(queries).toHaveLength(1);
  expect(queries[0]).toContain('audit_api.read_foundation_audit');
  expect(result).toMatchObject({complete:true,sources:{FOUNDATION:{state:'AVAILABLE'},IAM:{state:'NOT_REQUESTED'}}});
  expect(result.events).toHaveLength(1);
 });
 it('database proposal grants talo_app function execution without raw audit SELECT',()=>{
  const proposalRoot=join(root,'database');
  const grants=readFileSync(join(proposalRoot,'02-grant-owner-test-database.sql'),'utf8');
  const functions=readFileSync(join(proposalRoot,'03-create-functions-test-database.sql'),'utf8');
  const statements=`${grants}\n${functions}`.split(';').map(s=>s.trim());
  expect(functions.match(/SECURITY DEFINER/g)).toHaveLength(3);
  expect(functions).toMatch(/REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC/i);
  expect(functions).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]+TO talo_app/i);
  expect(statements.filter(s=>/^GRANT\s+SELECT/i.test(s)&&/\bTO\s+talo_app\b/i.test(s))).toEqual([]);
 });
 it('admin role gate is backend-owned, fail closed; direct IAM grants cannot bypass it',async()=>{
  expect(SCC_ADMIN_ROLE).toBe('TALO_SYSTEM_ADMIN');expect(ROLE_SQL).toContain('ur.revoked_at IS NULL');
  const actor={userAccountId:'00000000-0000-4000-8000-000000000001',assuranceLevel:1,requestId:'T1'};
  const host={readOnly:async<T>(fn:(tx:{query:(sql:string,args:readonly unknown[])=>Promise<unknown[]>})=>Promise<T>):Promise<T>=>fn({query:async()=>[{allowed:false}]})};
  expect(await isAdministrator(host,actor)).toBe(false);
 });
 it('excludes account row data but shows other table values without masking',()=>{
  expect(isProtectedAccountTable('iam','iam_credentials')).toBe(true);
  expect(isProtectedAccountTable('iam','iam_user_accounts')).toBe(true);
  expect(isProtectedAccountTable('foundation','fnd_module_versions')).toBe(false);
  expect(maskModeOf('payload','jsonb')).toBe('NONE');
 });
 it('does not counterfeit preflight evidence',()=>expect(mic.mic10Manifest.testEvidence[0]?.result).toBe('NOT_TESTED'));
});

// SCC DB access closure: a PostgreSQL refusal must never look like an IAM refusal, and the Access Matrix must show the
// TALO_SYSTEM_ADMIN dynamic inheritance (the evaluator's source) while Direct DENY still wins.
describe('SCC database access errors and IAM sources',()=>{
 const actor={userAccountId:'00000000-0000-4000-8000-000000000001',assuranceLevel:1,requestId:'REQ-DB'};
 const dbError=(code:string)=>Object.assign(new Error(`db ${code}`),{code});
 function hostWith(opts:{authorize?:()=>Promise<void>;fail?:string}){
  const queries:string[]=[];
  const host={
   authorize:opts.authorize??(async()=>undefined),
   lifecycle:async()=>({isEnabled:true,activeVersions:1}),
   readOnly:async<T>(fn:(tx:{query:(sql:string,args:readonly unknown[])=>Promise<unknown[]>})=>Promise<T>):Promise<T>=>fn({
    query:async(sql)=>{queries.push(sql);if(opts.fail)throw dbError(opts.fail);return [{present:1}];}}),
   sqlstate:(e:unknown)=>(typeof e==='object'&&e!==null&&'code' in e?String((e as {code:unknown}).code):undefined),
   logger:{warn:()=>undefined,error:()=>undefined},
  } as unknown as ModuleHost;
  return {host,queries};
 }
 it('overview: 42501 → 503 DB_PRIVILEGE_MISSING with the SQLSTATE; missing object → DB_OBJECT_MISSING; other → DATA_UNAVAILABLE',async()=>{
  for(const [code,expected] of [['42501','DB_PRIVILEGE_MISSING'],['3F000','DB_OBJECT_MISSING'],['42883','DB_OBJECT_MISSING'],['57014','DATA_UNAVAILABLE']] as const){
   const {host}=hostWith({fail:code});
   await expect(new ControllerOverviewService(host).modules(actor,{})).rejects.toMatchObject({status:503,code:expected,sqlstate:code});
  }
  expect(dataUnavailable('42501').message).toContain('không phải lỗi phân quyền IAM');
  expect(dataUnavailable(undefined)).toMatchObject({code:'DATA_UNAVAILABLE',sqlstate:undefined});
 });
 it('overview: an IAM refusal stays an IAM refusal (no database call, not mapped to a DB error)',async()=>{
  const forbidden=Object.assign(new Error('forbidden'),{status:403,code:'FORBIDDEN'});
  const {host,queries}=hostWith({authorize:async()=>{throw forbidden;}});
  await expect(new ControllerOverviewService(host).matrix(actor,{accountId:'00000000-0000-4000-8000-000000000002'})).rejects.toBe(forbidden);
  expect(queries).toEqual([]);
 });
 it('access matrix: TALO_SYSTEM_ADMIN inheritance is a reported source; every source uses the evaluator validity rules',()=>{
  const source=readFileSync(join(root,'backend','controller-overview.service.ts'),'utf8');
  const matrix=/const MATRIX_SQL=`([\s\S]*?)`/.exec(source)?.[1]??'';
  expect(matrix).toContain(`r.role_code='TALO_SYSTEM_ADMIN') AS "viaAdministrator"`);
  expect(matrix.match(/ur\.assigned_at<=statement_timestamp\(\)/g)).toHaveLength(2);
  expect(matrix.match(/up\.assigned_at<=statement_timestamp\(\)/g)).toHaveLength(2);
  expect(matrix).toMatch(/up\.effect='DENY'[\s\S]+AS "directDeny"/);
  const tab=readFileSync(join(root,'frontend','AccessMatrixTab.tsx'),'utf8');
  expect(tab).toContain('Admin kế thừa');
  expect(tab).toMatch(/if\(r\.directDeny===true\)return 'DENY \(Direct\)'/);
 });
 it('audit: a 42501 source is UNAVAILABLE with its SQLSTATE (complete=false, HTTP-level success is not data); IAM refusal is thrown before any query',async()=>{
  const {host}=hostWith({fail:'42501'});
  const view=await new SystemAuditService(host).list(actor,{source:'ALL'});
  expect(view).toMatchObject({complete:false,sources:{FOUNDATION:{state:'UNAVAILABLE',sqlstate:'42501'},IAM:{state:'UNAVAILABLE',sqlstate:'42501'}},events:[]});
  const forbidden=Object.assign(new Error('forbidden'),{status:403,code:'FORBIDDEN'});
  const denied=hostWith({authorize:async()=>{throw forbidden;}});
  await expect(new SystemAuditService(denied.host).list(actor,{})).rejects.toBe(forbidden);
  expect(denied.queries).toEqual([]);
  const tab=readFileSync(join(root,'frontend','SystemLogsTab.tsx'),'utf8');
  expect(tab).toContain('không phải phân quyền IAM');
  expect(tab).not.toContain('Kiểm tra quyền SELECT của DB role');
 });
 it('database package: extended verification 06 is read-only, talo_app-only and checks every negative rule',()=>{
  const sql=readFileSync(join(root,'database','06-verify-extended-as-app-read-only.sql'),'utf8');
  expect(sql).toContain('SET default_transaction_read_only = on');
  expect(sql).toMatch(/current_user <> 'talo_app' OR session_user <> 'talo_app'/);
  expect(sql).not.toMatch(/^\s*(GRANT|REVOKE|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/im);
  expect(sql).toContain("interval '31 days'");
  expect(sql).toContain('invalid_parameter_value');
  expect(sql).toContain('SET LOCAL ROLE talo_audit_reader');
 });
});
