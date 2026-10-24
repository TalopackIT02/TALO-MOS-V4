import { z } from 'zod';
import type { ModuleActor, ModuleHost } from './host.js';

// Recorded audit events ONLY: Foundation B08 and IAM audit. This is not a comprehensive
// request logger, cannot reconstruct actions that were never audited, and never escalates
// PostgreSQL privileges or returns raw metadata with possibly sensitive fields.
export const AUDIT_PERMISSION = { permissionCode: 'system_controller_center.audit.read', moduleCode: 'SYSTEM_CONTROLLER_CENTER', resourceCode: 'AUDIT_LOG', operation: 'READ' } as const;
const uuid = z.string().uuid();
const querySchema = z.strictObject({
  source: z.enum(['ALL', 'FOUNDATION', 'IAM']).default('ALL'),
  outcome: z.enum(['ALL', 'ISSUES', 'SUCCESS', 'FAILURE', 'DENIED']).default('ALL'),
  action: z.string().max(80).regex(/^[A-Za-z0-9_.-]*$/).default(''),
  actorAccountId: uuid.optional(),
  from: z.iso.datetime({offset:true}).optional(),
  to: z.iso.datetime({offset:true}).optional(),
  page: z.coerce.number().int().min(1).max(10).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
});
export type AuditSource = 'FOUNDATION' | 'IAM';
export interface AuditEvent {
  eventId: string; source: AuditSource; occurredAt: string; actorAccountId: string | null;
  actorUsername: string | null; actionCode: string; targetType: string; targetId: string | null;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED'; reason: string | null; errorCode: string | null; correlationId: string | null;
}
export type SourceState = 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_REQUESTED';
export interface AuditView {
  scope: 'RECORDED_AUDIT_ONLY'; queriedAt: string; from: string; to: string;
  page: number; pageSize: number; hasNext: boolean; complete: boolean;
  sources: Record<AuditSource, {state:SourceState; sqlstate?:string}>;
  events: AuditEvent[];
}
export const AUDIT_MESSAGES = {
  VALIDATION_ERROR: 'Bộ lọc nhật ký không hợp lệ.',
  FORBIDDEN: 'Chỉ Administrator có quyền AUDIT_LOG.READ mới được xem nhật ký.',
  SERVICE_BUSY: 'Không xác minh được tài khoản hoặc trạng thái module.',
} as const;
export type AuditErrorCode = keyof typeof AUDIT_MESSAGES;
export class AuditError extends Error {
  constructor(readonly status:number, readonly code:AuditErrorCode, readonly fields:string[] = []) {
    super(AUDIT_MESSAGES[code]); this.name = 'AuditError';
  }
}

// Queries are static. Only bound parameters appear in predicates; no arbitrary SQL/paths.
const base = `
  FROM %SOURCE%.%TABLE% l
  LEFT JOIN iam.iam_user_accounts a ON a.user_account_id=l.actor_account_id
  WHERE l.occurred_at >= $1::timestamptz AND l.occurred_at <= $2::timestamptz
  AND ($3::text='ALL' OR ($3::text='ISSUES' AND l.outcome IN ('FAILURE','DENIED')) OR l.outcome=$3::text)
  AND ($4::text='' OR l.action_code ILIKE '%' || $4::text || '%')
  AND ($5::uuid IS NULL OR l.actor_account_id=$5::uuid)
  ORDER BY l.occurred_at DESC, l.%ID% DESC LIMIT $6::int`;
const foundationSQL = `SELECT l.event_id::text AS event_id, 'FOUNDATION'::text AS source,
  to_char(l.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
  l.actor_account_id::text AS actor_account_id, a.username AS actor_username,
  l.action_code, l.target_type, l.target_id::text AS target_id, l.outcome,
  l.metadata->>'reason' AS reason, l.metadata->>'errorCode' AS error_code,
  l.correlation_id AS correlation_id
  ${base.replace('%SOURCE%','foundation').replace('%TABLE%','fnd_audit_logs').replace('%ID%','event_id')}`;
const iamSQL = `SELECT l.audit_id::text AS event_id, 'IAM'::text AS source,
  to_char(l.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
  l.actor_account_id::text AS actor_account_id, a.username AS actor_username,
  l.action_code, l.target_type, l.target_id::text AS target_id, l.outcome,
  l.metadata->>'reason' AS reason, l.metadata->>'errorCode' AS error_code,
  NULL::text AS correlation_id
  ${base.replace('%SOURCE%','iam').replace('%TABLE%','iam_audit_logs').replace('%ID%','audit_id')}`;
const eventRow = z.object({
  event_id:z.string(),source:z.enum(['FOUNDATION','IAM']),occurred_at:z.string(),actor_account_id:z.string().nullable(),
  actor_username:z.string().nullable(),action_code:z.string(),target_type:z.string(),target_id:z.string().nullable(),
  outcome:z.enum(['SUCCESS','FAILURE','DENIED']),reason:z.string().nullable(),error_code:z.string().nullable(),
  correlation_id:z.string().nullable(),
});
// Only a short code-like string is allowed to leave the server; arbitrary metadata and
// free-form text might contain secrets and are intentionally withheld.
function safeCode(v:string|null):string|null {
  return v !== null && /^[A-Za-z0-9_. -]{1,100}$/.test(v) ? v : null;
}
function toEvent(raw:unknown):AuditEvent {
  const x=eventRow.parse(raw);
  return {eventId:x.event_id,source:x.source,occurredAt:x.occurred_at,
    actorAccountId:x.actor_account_id,actorUsername:x.actor_username,actionCode:x.action_code,
    targetType:x.target_type,targetId:x.target_id,outcome:x.outcome,
    reason:safeCode(x.reason),errorCode:safeCode(x.error_code),correlationId:x.correlation_id};
}
export class SystemAuditService {
  constructor(private readonly host:ModuleHost) {}
  async list(actor:ModuleActor, query:unknown):Promise<AuditView> {
    await this.host.authorize(actor,AUDIT_PERMISSION,'SYSTEM_CONTROLLER_CENTER.AUDIT_LOG.READ','SYSTEM_AUDIT_API');
    let state;
    try {state=await this.host.lifecycle('SYSTEM_CONTROLLER_CENTER');}
    catch {throw new AuditError(503,'SERVICE_BUSY');}
    if(!state || !state.isEnabled || state.activeVersions!==1) throw new AuditError(503,'SERVICE_BUSY');
    const raw=(query!==null && typeof query==='object')?query:{};
    const parsed=querySchema.safeParse(raw);
    if(!parsed.success)throw new AuditError(400,'VALIDATION_ERROR', [...new Set(parsed.error.issues.map(i=>String(i.path[0]??'query')))]);
    const q=parsed.data;
    const end=q.to ? new Date(q.to):new Date();
    const start=q.from ? new Date(q.from):new Date(end.getTime()-24*3600*1000);
    if(!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start>end || (end.getTime()-start.getTime())>31*24*3600*1000)
      throw new AuditError(400,'VALIDATION_ERROR',['from','to']);
    const sources:AuditView['sources']={FOUNDATION:{state:'NOT_REQUESTED'},IAM:{state:'NOT_REQUESTED'}};
    const events:AuditEvent[]=[];
    const limit=q.page*q.pageSize+1;
    for(const src of ['FOUNDATION','IAM'] as const){
      if(q.source!=='ALL' && q.source!==src)continue;
      try{
        const rows=await this.host.readOnly(async tx=>{
          return tx.query(src==='FOUNDATION'?foundationSQL:iamSQL,
            [start.toISOString(),end.toISOString(),q.outcome,q.action,q.actorAccountId??null,limit]);
        });
        events.push(...rows.map(toEvent));
        sources[src]={state:'AVAILABLE'};
      }catch(error){
        if(error instanceof AuditError && error.code==='FORBIDDEN')throw error;
        // An admin lookup failure cannot be mistaken for an empty audit table.
        const sqlstate=this.host.sqlstate(error);
        sources[src]={state:'UNAVAILABLE',...(sqlstate?{sqlstate}:{})};
        this.host.logger.warn('audit source unavailable',{requestId:actor.requestId,source:src,sqlstate});
      }
    }
    const requested=(['FOUNDATION','IAM'] as const).filter(src=>q.source==='ALL'||q.source===src);
    const complete=requested.every(src=>sources[src].state==='AVAILABLE');
    events.sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)||b.eventId.localeCompare(a.eventId));
    const offset=(q.page-1)*q.pageSize;
    return {scope:'RECORDED_AUDIT_ONLY',queriedAt:new Date().toISOString(),from:start.toISOString(),to:end.toISOString(),
      page:q.page,pageSize:q.pageSize,hasNext:events.length>offset+q.pageSize,
      complete,sources,events:events.slice(offset,offset+q.pageSize)};
  }
}
