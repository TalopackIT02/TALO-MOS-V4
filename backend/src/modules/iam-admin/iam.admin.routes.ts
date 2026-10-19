import express from 'express';
import type { Router, Request } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/auth.service.js';
import { sessionHandler } from '../foundation/foundation.http.js';
import type { Actor } from '../foundation/foundation.access.js';
import type { FoundationDb } from '../foundation/foundation.repository.js';
import { IAM_ADMIN_PERMISSIONS as P, IamAdminRepository, IamError, iamBody, iamId } from './iam.admin.repository.js';

const code = z.string().min(1).max(160).regex(/^[a-z][a-z0-9_.]*$/);
const role = z.strictObject({roleCode:code.max(80),roleName:z.string().trim().min(1).max(150),description:z.string().max(2000).optional()});
const rolePatch = z.strictObject({roleName:z.string().trim().min(1).max(150).optional(),description:z.string().max(2000).nullable().optional(),isActive:z.boolean().optional()}).refine(x=>Object.keys(x).length>0);
const permission = z.strictObject({permissionCode:code,moduleCode:z.string().min(1).max(80),resourceCode:z.string().min(1).max(100),operation:z.string().min(1).max(30),minimumAssuranceLevel:z.number().int().min(1).max(2),description:z.string().max(2000).optional()});
const uuid = z.uuid();
const idBody = z.strictObject({permissionId:uuid});
const roleBody = z.strictObject({roleId:uuid});
const direct = z.strictObject({permissionId:uuid,effect:z.enum(['ALLOW','DENY']),reason:z.string().trim().min(1).max(2000),expiresAt:z.iso.datetime({offset:true}).nullable().optional()});
const pageQuery=z.strictObject({search:z.string().max(100).optional(),page:z.coerce.number().int().min(1).max(100000).optional(),pageSize:z.coerce.number().int().min(1).max(100).optional()});
type Work=(req:Request,actor:Actor,repo:IamAdminRepository)=>Promise<object>;
export function iamAdminRouter({db,authService,secureCookie}:{db:FoundationDb;authService:Pick<AuthService,'describeSession'>;secureCookie:boolean}):Router {
  const router=express.Router();
  const repo=new IamAdminRepository(db);
  const session=sessionHandler({authService,secureCookie});
  const handler=(p:typeof P[keyof typeof P],fn:Work,status=200)=>session(async(req,res,actor)=>{
    try {
      await repo.authorize(actor,p);
      res.status(status).json(await fn(req,actor,repo));
    } catch(e) {
      if(e instanceof IamError){
        res.status(e.status).json({error:{code:e.code,message:e.code==='FORBIDDEN'?'Bạn không có quyền thực hiện thao tác này.':'Thông tin không hợp lệ hoặc không tìm thấy.',requestId:res.locals.requestId}});
        return;
      }
      throw e;
    }
  });
  const id=(req:Request,name:string)=>iamId(req.params[name]);
  router.get('/iam/admin/accounts',handler(P.accounts,async(req,_a,r)=>{const x=iamBody(pageQuery,req.query);return r.accounts(x.search??'',x.page??1,x.pageSize??25);}));
  router.get('/iam/admin/accounts/:accountId',handler(P.accounts,async(req,_a,r)=>({account:await r.account(id(req,'accountId'))})));
  router.get('/iam/admin/roles',handler(P.roles,async(_req,_a,r)=>({roles:await r.roles()})));
  router.post('/iam/admin/roles',handler(P.roles,async(req,a,r)=>({role:await r.createRole(a,iamBody(role,req.body))}),201));
  router.patch('/iam/admin/roles/:roleId',handler(P.roles,async(req,a,r)=>({role:await r.updateRole(a,id(req,'roleId'),iamBody(rolePatch,req.body))})));
  router.get('/iam/admin/permissions',handler(P.permissions,async(_req,_a,r)=>({permissions:await r.permissions()})));
  router.post('/iam/admin/permissions',handler(P.permissions,async(req,a,r)=>({permission:await r.createPermission(a,iamBody(permission,req.body))}),201));
  router.get('/iam/admin/roles/:roleId/permissions',handler(P.roles,async(req,_a,r)=>({permissions:await r.rolePermissions(id(req,'roleId'))})));
  router.post('/iam/admin/roles/:roleId/permissions',handler(P.assignments,async(req,a,r)=>({assignment:await r.assignRolePermission(a,id(req,'roleId'),iamBody(idBody,req.body).permissionId)}),201));
  router.delete('/iam/admin/roles/:roleId/permissions/:permissionId',handler(P.assignments,async(req,a,r)=>({assignment:await r.revokeRolePermission(a,id(req,'roleId'),id(req,'permissionId'))})));
  router.get('/iam/admin/accounts/:accountId/roles',handler(P.accounts,async(req,_a,r)=>({roles:await r.accountRoles(id(req,'accountId'))})));
  router.post('/iam/admin/accounts/:accountId/roles',handler(P.assignments,async(req,a,r)=>({assignment:await r.assignUserRole(a,id(req,'accountId'),iamBody(roleBody,req.body).roleId)}),201));
  router.post('/iam/admin/accounts/:accountId/roles/:assignmentId/revoke',handler(P.assignments,async(req,a,r)=>({assignment:await r.revokeUserRole(a,id(req,'accountId'),id(req,'assignmentId'))})));
  router.get('/iam/admin/accounts/:accountId/permissions',handler(P.accounts,async(req,a,r)=>({direct:await r.accountPermissions(id(req,'accountId')),effective:await r.effective(id(req,'accountId'),a.assuranceLevel)})));
  router.post('/iam/admin/accounts/:accountId/permissions',handler(P.assignments,async(req,a,r)=>({assignment:await r.assignDirect(a,id(req,'accountId'),iamBody(direct,req.body))}),201));
  router.post('/iam/admin/accounts/:accountId/permissions/:assignmentId/revoke',handler(P.assignments,async(req,a,r)=>({assignment:await r.revokeDirect(a,id(req,'accountId'),id(req,'assignmentId'))})));
  router.get('/iam/admin/foundation/navigation/items',handler(P.navigation,async(_req,_a,r)=>({items:await r.navigationItems()})));
  router.get('/iam/admin/foundation/modules/:moduleId/functions',handler(P.navigation,async(req,_a,r)=>({functions:await r.functions(id(req,'moduleId'))})));
  return router;
}
