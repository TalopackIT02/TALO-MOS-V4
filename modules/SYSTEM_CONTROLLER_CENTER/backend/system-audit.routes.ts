import express from 'express';
import type { Response, Router } from 'express';
import type { ModuleHost } from './host.js';
import { AuditError, SystemAuditService } from './system-audit.service.js';
function answerError(res:Response,error:AuditError){
  res.status(error.status).json({error:{code:error.code,message:error.message,requestId:res.locals.requestId,
    ...(error.fields.length?{details:{fields:error.fields}}:{})}});
}
export function systemAuditRouter({host,service}:{host:ModuleHost;service:SystemAuditService}):Router{
  const router=express.Router();
  router.get('/system-controller-center/audit/logs',host.session(async(req,res,actor)=>{
    try{res.status(200).json({logs:await service.list(actor,req.query)});}
    catch(error){if(error instanceof AuditError)return answerError(res,error);throw error;}
  }));
  return router;
}
