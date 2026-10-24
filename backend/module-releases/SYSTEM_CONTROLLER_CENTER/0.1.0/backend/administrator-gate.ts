import type { ModuleHost, ModuleActor } from './host.js';

/** Immutable backend role gate. Merely assigning a module permission to Manager never grants access.
 *  No privilege switching; any uncertain query is a 503, not an allow.
 *  role_code is the platform's existing role identifier (NOT a caller-controlled param).
 */
export const SCC_ADMIN_ROLE = 'TALO_SYSTEM_ADMIN';
export const ROLE_SQL = `SELECT EXISTS (
  SELECT 1 FROM iam.iam_user_accounts a
  JOIN iam.iam_user_roles ur ON ur.user_account_id=a.user_account_id
  JOIN iam.iam_roles r ON r.role_id=ur.role_id
  WHERE a.user_account_id=$1::uuid AND a.account_status='ACTIVE' AND a.disabled_at IS NULL
    AND ur.revoked_at IS NULL AND r.is_active=TRUE AND r.role_code='TALO_SYSTEM_ADMIN'
) AS allowed`;

export async function isAdministrator(host:Pick<ModuleHost,'readOnly'>,actor:ModuleActor):Promise<boolean>{
  const rows=await host.readOnly(tx=>tx.query(ROLE_SQL,[actor.userAccountId]));
  const row=rows[0];
  if(!row || typeof row!=='object' || !('allowed' in row) || typeof row.allowed!=='boolean')
    throw new Error('ADMIN_ROLE_QUERY_UNAVAILABLE');
  return row.allowed;
}

/** Every HTTP route in this module is forced through the same Host session and role gate.
 *  This is in addition to the K05 Host.authorize permission per action and the module lifecycle gate.
 */
export function administratorOnlyHost(host:ModuleHost):ModuleHost {
  return { ...host, session: handler=>host.session(async(req,res,actor)=>{
    let approved=false;
    try { approved=await isAdministrator(host,actor); }
    catch {
      host.logger.error('SCC administrator role check unavailable',{requestId:actor.requestId});
      res.status(503).json({error:{code:'ADMIN_ROLE_CHECK_UNAVAILABLE',message:'Không xác minh được vai trò Administrator.',requestId:actor.requestId}});
      return;
    }
    if(!approved){
      host.logger.warn('SCC administrator role denied',{requestId:actor.requestId,userAccountId:actor.userAccountId});
      res.status(403).json({error:{code:'ADMIN_ROLE_REQUIRED',message:'Chỉ Administrator được truy cập System Controller Center.',requestId:actor.requestId}});
      return;
    }
    await handler(req,res,actor);
  })};
}
