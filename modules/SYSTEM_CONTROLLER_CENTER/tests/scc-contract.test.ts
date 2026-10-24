import { describe,expect,it } from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {SCC_ADMIN_ROLE,ROLE_SQL,isAdministrator} from '../backend/administrator-gate.js';
import {isProtectedAccountTable,maskModeOf} from '../backend/data-inspector.masking.js';
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
  expect(mic.mic09Compatibility.kind).toBe('INITIAL_REGISTRATION');
  expect(mic.mic01Identity.moduleVersion).toBe(manifest.packageVersion);
 });
 it('maps every action exactly once under K05 and every API to an action',()=>{
  const pairs=mic.mic03Actions.map(a=>`${a.functionKey}.${a.actionKey}`);
  expect(mic.mic07IamMapping.map(m=>`${m.functionKey}.${m.actionKey}`)).toEqual(pairs);
  expect(mic.mic07IamMapping.every(m=>m.moduleCode==='SYSTEM_CONTROLLER_CENTER' && m.resourceCode===m.functionKey && m.operation===m.actionKey)).toBe(true);
  expect(mic.mic05Api.every(a=>pairs.includes(`${a.functionKey}.${a.actionKey}`))).toBe(true);
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
