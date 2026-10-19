import { describe,expect,it } from 'vitest';
import { IamAdminRepository,IamError,IAM_ADMIN_PERMISSIONS } from '../../../src/modules/iam-admin/iam.admin.repository.js';
import { FOUNDATION_SQL } from '../../../src/modules/foundation/foundation.repository.js';
import type { FoundationDb,SqlExecutor } from '../../../src/modules/foundation/foundation.repository.js';

const actor={userAccountId:'11111111-1111-4111-8111-111111111111',assuranceLevel:1,requestId:'test-request'};
function fake(facts:'missing'|'denied'|'allowed') {
 const queries:{sql:string;params:readonly unknown[]}[]=[];
 const writes:{sql:string;params:readonly unknown[]}[]=[];
 const exec:SqlExecutor={
   query:async(sql,params)=>{
     queries.push({sql,params});
     if(sql===FOUNDATION_SQL.permissionDefinitions)return facts==='missing'?[]:[{permission_id:'22222222-2222-4222-8222-222222222222',minimum_assurance_level:1}];
     if(sql===FOUNDATION_SQL.accountFacts)return [{account_status:'ACTIVE',not_disabled:true}];
     if(sql===FOUNDATION_SQL.grantFacts)return facts==='allowed'?[{source:'DIRECT',effect:'ALLOW',role_active:true,not_revoked:true,started:true,not_expired:true}]:[];
     return [];
   },
   execute:async(sql,params)=>{writes.push({sql,params});return 1;}
 };
 const db:FoundationDb={...exec,transaction:async fn=>fn(exec)};
 return {repository:new IamAdminRepository(db),queries,writes};
}
describe('IAM admin deny-by-default',()=>{
 it('missing permission denies and audits without looking up management data',async()=>{
   const h=fake('missing');
   await expect(h.repository.authorize(actor,IAM_ADMIN_PERMISSIONS.accounts)).rejects.toMatchObject({status:403,code:'FORBIDDEN'});
   expect(h.writes).toHaveLength(1);
   expect(h.writes[0]?.sql).toContain('iam.iam_audit_logs');
 });
 it('permission definition without grant fails closed',async()=>{
   const h=fake('denied');
   await expect(h.repository.authorize(actor,IAM_ADMIN_PERMISSIONS.roles)).rejects.toBeInstanceOf(IamError);
 });
 it('valid direct ALLOW is evaluated by Foundation evaluator',async()=>{
   const h=fake('allowed');
   await expect(h.repository.authorize(actor,IAM_ADMIN_PERMISSIONS.roles)).resolves.toBeUndefined();
   expect(h.writes).toHaveLength(0);
 });
 it('invalid UUID returns a controlled error',async()=>{
   const {iamId}=await import('../../../src/modules/iam-admin/iam.admin.repository.js');
   expect(()=>iamId('non-uuid')).toThrowError(IamError);
 });
});
