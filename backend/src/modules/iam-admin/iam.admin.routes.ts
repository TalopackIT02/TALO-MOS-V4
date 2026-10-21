import express from 'express';
import type { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/auth.service.js';
import { sessionHandler } from '../foundation/foundation.http.js';
import type { Actor } from '../foundation/foundation.access.js';
import type { PermissionRef } from '../foundation/foundation.permissions.js';
import type { FoundationDb } from '../foundation/foundation.repository.js';
import { IAM_ADMIN_PERMISSIONS as P, IAM_MESSAGES, IamAdminRepository, IamError, iamBody, iamId } from './iam.admin.repository.js';
import type { PasswordHasher } from '../auth/passwordHasher.js';
import { IamAccountLifecycle, STATUS_ACTIONS } from './iam.admin.lifecycle.js';
import type { ProvisionerConnection } from './iam.admin.provisioner.js';

// IAM Management routes (/api/iam/admin/*). Same session wrapper (AuthService.describeSession), origin / JSON protection,
// request id and error envelope as the Foundation routers. Every route authorises first (403 + IAM audit DENIED when no
// listed permission is effective), then validates, then reads / writes.

const roleCodeRule = z.string().trim().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9_.-]*$/);
const permissionCodeRule = z.string().trim().min(1).max(160).regex(/^[a-z][a-z0-9_.]*$/);
const role = z.strictObject({roleCode:roleCodeRule,roleName:z.string().trim().min(1).max(150),description:z.string().max(2000).optional()});
const rolePatch = z.strictObject({roleName:z.string().trim().min(1).max(150).optional(),description:z.string().max(2000).nullable().optional(),isActive:z.boolean().optional()}).refine(x=>Object.keys(x).length>0);
const permission = z.strictObject({permissionCode:permissionCodeRule,moduleCode:z.string().min(1).max(80),resourceCode:z.string().min(1).max(100),operation:z.string().min(1).max(30),minimumAssuranceLevel:z.number().int().min(1).max(2),description:z.string().max(2000).optional()});
const uuid = z.uuid();
const idBody = z.strictObject({permissionId:uuid});
const roleBody = z.strictObject({roleId:uuid});
const direct = z.strictObject({permissionId:uuid,effect:z.enum(['ALLOW','DENY']),reason:z.string().trim().min(1).max(2000),expiresAt:z.iso.datetime({offset:true}).nullable().optional()});
const accountField=z.enum(['username','employeeCode','fullName','accountStatus']);
const pageQuery=z.strictObject({search:z.string().max(100).optional(),field:z.union([accountField,z.literal('all')]).optional(),status:z.string().regex(/^[A-Z_]{1,30}$/).optional(),
  sort:accountField.optional(),dir:z.enum(['asc','desc']).optional(),page:z.coerce.number().int().min(1).max(100000).optional(),pageSize:z.coerce.number().int().min(1).max(100).optional()});
// IAM Phase B bodies / queries. Reasons are mandatory, bounded, without control characters (stored in the IAM audit).
const CONTROL = /[\u0000-\u001F\u007F]/;
const reasonRule = z.string().trim().min(1).max(500).refine((v) => !CONTROL.test(v));
const statusBody = z.strictObject({action:z.enum(STATUS_ACTIONS),reason:reasonRule});
const reasonBody = z.strictObject({reason:reasonRule});
const revokeSessionsBody = z.strictObject({sessionId:uuid.nullable().optional(),reason:reasonRule});
// IAM Phase C PC-01: username only (same rule as the P-4e service and the database function: 1-80, no whitespace / control).
const pendingAccountBody = z.strictObject({username:z.string().trim().min(1).max(80).regex(/^[^\s\p{Cc}]+$/u)});
const auditQuery = z.strictObject({accountId:uuid.optional(),action:z.string().max(80).regex(/^[A-Za-z0-9_.]*$/).optional(),outcome:z.enum(['SUCCESS','FAILURE','DENIED']).optional(),
  from:z.iso.datetime({offset:true}).optional(),to:z.iso.datetime({offset:true}).optional(),
  page:z.coerce.number().int().min(1).max(100000).optional(),pageSize:z.coerce.number().int().min(1).max(100).optional()});
// Answers carrying a temporary password: never cached, never stored by an intermediary.
const noStore = (res: Response) => { res.set('Cache-Control','no-store'); res.set('Pragma','no-cache'); };
// Catalog reads used by several admin screens (accounts, roles, permissions, assignments): any one admin permission.
const CATALOG: readonly PermissionRef[] = [P.roles, P.permissions, P.assignments, P.accounts];
type Work=(req:Request,actor:Actor,repo:IamAdminRepository)=>Promise<object>;

const NO_PROVISIONER: ProvisionerConnection = { state: 'DISABLED', executor: null, close: async () => undefined };

export function iamAdminRouter({db,authService,secureCookie,rootAccountId=null,provisioner=NO_PROVISIONER,hasher=null}:{db:FoundationDb;authService:Pick<AuthService,'describeSession'>;secureCookie:boolean;rootAccountId?:string|null;provisioner?:ProvisionerConnection;hasher?:PasswordHasher|null}):Router {
  const router=express.Router();
  const repo=new IamAdminRepository(db,rootAccountId);
  const life=new IamAccountLifecycle(db,rootAccountId,provisioner,hasher);
  const session=sessionHandler({authService,secureCookie});
  const handler=(p:PermissionRef|readonly PermissionRef[],fn:Work,status=200,headers?:(res:Response)=>void)=>session(async(req,res,actor)=>{
    try {
      headers?.(res);
      await repo.authorize(actor,...(Array.isArray(p)?p:[p]));
      res.status(status).json(await fn(req,actor,repo));
    } catch(e) {
      if(e instanceof IamError){
        res.status(e.status).json({error:{code:e.code,message:IAM_MESSAGES[e.code]??IAM_MESSAGES['VALIDATION_ERROR'],requestId:res.locals.requestId}});
        return;
      }
      throw e;
    }
  });
  const id=(req:Request,name:string)=>iamId(req.params[name]);
  // The actor's OWN admin capabilities (AppShell menus / screens): any authenticated session, evaluated by evaluateAccess().
  router.get('/iam/admin/me/capabilities',session(async(_req,res,actor)=>{res.status(200).json({permissions:await repo.capabilities(actor),features:{temporaryCredentials:life.credentialState()}});}));
  router.get('/iam/admin/accounts',handler(P.accounts,async(req,_a,r)=>{const x=iamBody(pageQuery,req.query);
    return r.accounts({search:x.search?.trim()??'',field:x.field??'all',status:x.status??null,sort:x.sort??'username',dir:x.dir??'asc',page:x.page??1,pageSize:x.pageSize??25});}));
  router.get('/iam/admin/permission-tree',handler(CATALOG,async(_req,_a,r)=>({tree:await r.permissionTree()})));
  router.get('/iam/admin/accounts/:accountId',handler(P.accounts,async(req,_a,r)=>({account:await r.account(id(req,'accountId'))})));
  router.get('/iam/admin/roles',handler(CATALOG,async(_req,_a,r)=>({roles:await r.roles()})));
  router.post('/iam/admin/roles',handler(P.roles,async(req,a,r)=>({role:await r.createRole(a,iamBody(role,req.body))}),201));
  router.patch('/iam/admin/roles/:roleId',handler(P.roles,async(req,a,r)=>({role:await r.updateRole(a,id(req,'roleId'),iamBody(rolePatch,req.body))})));
  router.get('/iam/admin/permissions',handler(CATALOG,async(_req,_a,r)=>({permissions:await r.permissions()})));
  router.post('/iam/admin/permissions',handler(P.permissions,async(req,a,r)=>({permission:await r.createPermission(a,iamBody(permission,req.body))}),201));
  router.get('/iam/admin/roles/:roleId/permissions',handler(CATALOG,async(req,_a,r)=>({permissions:await r.rolePermissions(id(req,'roleId'))})));
  router.post('/iam/admin/roles/:roleId/permissions',handler(P.assignments,async(req,a,r)=>({assignment:await r.assignRolePermission(a,id(req,'roleId'),iamBody(idBody,req.body).permissionId)}),201));
  router.delete('/iam/admin/roles/:roleId/permissions/:permissionId',handler(P.assignments,async(req,a,r)=>({assignment:await r.revokeRolePermission(a,id(req,'roleId'),id(req,'permissionId'))})));
  router.get('/iam/admin/accounts/:accountId/roles',handler(P.accounts,async(req,_a,r)=>({roles:await r.accountRoles(id(req,'accountId'))})));
  router.post('/iam/admin/accounts/:accountId/roles',handler(P.assignments,async(req,a,r)=>({assignment:await r.assignUserRole(a,id(req,'accountId'),iamBody(roleBody,req.body).roleId)}),201));
  router.post('/iam/admin/accounts/:accountId/roles/:assignmentId/revoke',handler(P.assignments,async(req,a,r)=>({assignment:await r.revokeUserRole(a,id(req,'accountId'),id(req,'assignmentId'))})));
  // Effective permissions of the TARGET account: assumption = the target's session reaches each minimum assurance
  // (the viewer's own session assurance is never used for another account).
  router.get('/iam/admin/accounts/:accountId/permissions',handler(P.accounts,async(req,_a,r)=>{const accountId=id(req,'accountId');return {direct:await r.accountPermissions(accountId),effective:await r.effective(accountId),assumption:'TARGET_SESSION_MEETS_MINIMUM_ASSURANCE'};}));
  router.post('/iam/admin/accounts/:accountId/permissions',handler(P.assignments,async(req,a,r)=>({assignment:await r.assignDirect(a,id(req,'accountId'),iamBody(direct,req.body))}),201));
  router.post('/iam/admin/accounts/:accountId/permissions/:assignmentId/revoke',handler(P.assignments,async(req,a,r)=>({assignment:await r.revokeDirect(a,id(req,'accountId'),id(req,'assignmentId'))})));
  // IAM Phase B — account lifecycle (writer protocol in SECURITY DEFINER functions), sessions, IAM audit, credentials.
  router.get('/iam/admin/accounts/:accountId/details',handler(P.accounts,async(req)=>({details:await life.details(id(req,'accountId'))})));
  router.post('/iam/admin/accounts/:accountId/status',handler(P.accountsManage,async(req,a)=>{const b=iamBody(statusBody,req.body);return {result:await life.setStatus(a,id(req,'accountId'),b.action,b.reason)};}));
  router.post('/iam/admin/accounts/:accountId/login-lock/clear',handler(P.accountsManage,async(req,a)=>({result:await life.clearLoginLock(a,id(req,'accountId'),iamBody(reasonBody,req.body).reason)})));
  router.get('/iam/admin/accounts/:accountId/sessions',handler(P.sessionsManage,async(req)=>({sessions:await life.sessions(id(req,'accountId'))})));
  router.post('/iam/admin/accounts/:accountId/sessions/revoke',handler(P.sessionsManage,async(req,a)=>{const b=iamBody(revokeSessionsBody,req.body);return {result:await life.revokeSessions(a,id(req,'accountId'),b.sessionId??null,b.reason)};}));
  router.get('/iam/admin/audit',handler(P.auditRead,async(req)=>{const q=iamBody(auditQuery,req.query);
    return life.audit({accountId:q.accountId??null,action:q.action??'',outcome:q.outcome??null,from:q.from??null,to:q.to??null,page:q.page??1,pageSize:q.pageSize??25});}));
  // Create a User Account PENDING_MEMBERSHIP (no membership, no credential, no P-4e).
  router.post('/iam/admin/accounts/pending',handler(P.accountsCreate,async(req,a)=>({account:await life.createPending(a,iamBody(pendingAccountBody,req.body).username)}),201,noStore));
  // Owner decision (PC-01 G2): the legacy combined form (account + membership + temporary credential in one call) is BLOCKED
  // until the D-1 permission boundary of PC-02 is reviewed and approved — iam.accounts.create alone must not lead to a
  // membership and a credential. Session + permission gate as before, then 410 before any body parsing or P-4e call:
  // nothing is written. Reopening is an owner decision (D-1, PC-02): life.createAccount is kept; its body schema returns then.
  // The P-4e CLI, the pending-account route and the credential re-issue are not affected.
  router.post('/iam/admin/accounts',handler(P.accountsCreate,async()=>{ throw new IamError(410,'LEGACY_ACCOUNT_CREATE_BLOCKED'); },201,noStore));
  router.post('/iam/admin/accounts/:accountId/credential/reissue',handler(P.credentialsReissue,async(req,a)=>({credential:await life.reissue(a,id(req,'accountId'),iamBody(reasonBody,req.body).reason)}),200,noStore));
  // Navigation adapter (read only; writes stay POST / PATCH /api/foundation/navigation/items).
  router.get('/iam/admin/foundation/navigation/items',handler(P.navigation,async(_req,_a,r)=>({items:await r.navigationItems()})));
  router.get('/iam/admin/foundation/modules',handler([P.navigation,P.permissions],async(_req,_a,r)=>({modules:await r.activeModules()})));
  router.get('/iam/admin/foundation/modules/:moduleId/functions',handler([P.navigation,P.permissions],async(req,_a,r)=>({functions:await r.functions(id(req,'moduleId'))})));
  return router;
}
