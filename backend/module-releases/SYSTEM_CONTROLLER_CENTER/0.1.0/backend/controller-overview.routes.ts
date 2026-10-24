import express from 'express';
import type {Router, Response} from 'express';
import type {ModuleHost} from './host.js';
import {ControllerOverviewService,OverviewError} from './controller-overview.service.js';
async function answer(res:Response,fn:()=>Promise<object>) {
  try{res.status(200).json({data:await fn()});}
  catch(e){if(!(e instanceof OverviewError))throw e;
    res.status(e.status).json({error:{code:e.code,message:e.message,requestId:res.locals.requestId}});}
}
export function controllerOverviewRouter({host,service}:{host:ModuleHost;service:ControllerOverviewService}):Router {
 const r=express.Router();
 r.get('/system-controller-center/architecture/modules',host.session(async(req,res,actor)=>answer(res,()=>service.modules(actor,req.query))));
 r.get('/system-controller-center/architecture/functions',host.session(async(req,res,actor)=>answer(res,()=>service.functions(actor,req.query))));
 r.get('/system-controller-center/access/accounts',host.session(async(req,res,actor)=>answer(res,()=>service.accounts(actor,req.query))));
 r.get('/system-controller-center/access/matrix',host.session(async(req,res,actor)=>answer(res,()=>service.matrix(actor,req.query))));
 return r;
}
