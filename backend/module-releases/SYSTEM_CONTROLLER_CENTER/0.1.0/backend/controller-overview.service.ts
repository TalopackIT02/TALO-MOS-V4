import type { ModuleActor, ModuleHost, ModulePermission, ReadOnlyQuery } from './host.js';

const MODULE_KEY='SYSTEM_CONTROLLER_CENTER';
const MODULE_PERMISSION:ModulePermission={permissionCode:'system_controller_center.architecture.read',moduleCode:MODULE_KEY,resourceCode:'ARCHITECTURE',operation:'READ'};
const ACCESS_PERMISSION:ModulePermission={permissionCode:'system_controller_center.access_matrix.read',moduleCode:MODULE_KEY,resourceCode:'ACCESS_MATRIX',operation:'READ'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class OverviewError extends Error {
  constructor(readonly status:number,readonly code:string, message:string){super(message);this.name='OverviewError';}
}
const page=(v:unknown):number=>{
  const n=v===undefined?1:Number(v);
  if(typeof v!=='undefined' && (typeof v!=='string'||!/^[0-9]{1,6}$/.test(v))) throw new OverviewError(400,'VALIDATION_ERROR','Trang không hợp lệ.');
  if(!Number.isSafeInteger(n)||n<1||n>100000)throw new OverviewError(400,'VALIDATION_ERROR','Trang không hợp lệ.');
  return n;
};
const queryValue=(query:unknown,key:string):unknown=>query!==null&&typeof query==='object'?Reflect.get(query,key):undefined;
function uniqueQuery(query:unknown, keys:readonly string[]) {
  if(query===null||typeof query!=='object'||Array.isArray(query)||Object.keys(query).some(k=>!keys.includes(k)))
    throw new OverviewError(400,'VALIDATION_ERROR','Bộ lọc không hợp lệ.');
}
const MODULES_SQL=`SELECT m.module_key AS "moduleKey",m.module_name AS "moduleName",m.is_enabled AS "enabled",
 v.module_version AS "version",v.status AS "status",v.manifest_hash AS "manifestHash",
 to_char(v.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
 FROM foundation.fnd_modules m LEFT JOIN foundation.fnd_module_versions v ON v.module_id=m.module_id
 ORDER BY m.module_key COLLATE "C",v.created_at DESC,v.version_id LIMIT $1 OFFSET $2`;
const FUNCTIONS_SQL=`SELECT m.module_key AS "moduleKey", f.function_key AS "functionKey",
 v.module_version AS "version",v.status AS "versionStatus",vf.display_name AS "functionName",
 a.action_key AS "actionKey",va.action_spec->>'name' AS "actionName"
 FROM foundation.fnd_modules m JOIN foundation.fnd_functions f ON f.module_id=m.module_id
 LEFT JOIN foundation.fnd_version_functions vf ON vf.function_id=f.function_id
 LEFT JOIN foundation.fnd_module_versions v ON v.version_id=vf.version_id
 LEFT JOIN foundation.fnd_version_actions va ON va.version_function_id=vf.version_function_id
 LEFT JOIN foundation.fnd_actions a ON a.action_id=va.action_id
 WHERE m.module_key=$1 ORDER BY v.created_at DESC,f.function_key,a.action_key LIMIT $2 OFFSET $3`;
const ACCOUNTS_SQL=`SELECT a.user_account_id::text AS "accountId",a.username AS "username",a.account_status AS "status",
 COALESCE(array_remove(array_agg(DISTINCT r.role_code ORDER BY r.role_code),NULL),ARRAY[]::text[]) AS "roles"
 FROM iam.iam_user_accounts a
 LEFT JOIN iam.iam_user_roles ur ON ur.user_account_id=a.user_account_id AND ur.revoked_at IS NULL
 LEFT JOIN iam.iam_roles r ON r.role_id=ur.role_id AND r.is_active=TRUE
 GROUP BY a.user_account_id,a.username,a.account_status ORDER BY a.username,a.user_account_id LIMIT $1 OFFSET $2`;
const MATRIX_SQL=`SELECT p.permission_code AS "permissionCode",p.module_code AS "moduleCode",
 p.resource_code AS "resourceCode",p.operation AS "operation",p.minimum_assurance_level::int AS "minimumAssuranceLevel",
 EXISTS(SELECT 1 FROM iam.iam_user_roles ur JOIN iam.iam_roles r ON r.role_id=ur.role_id
   JOIN iam.iam_role_permissions rp ON rp.role_id=r.role_id
   WHERE ur.user_account_id=$1::uuid AND ur.revoked_at IS NULL AND r.is_active=TRUE AND rp.permission_id=p.permission_id) AS "viaRole",
 EXISTS(SELECT 1 FROM iam.iam_user_permissions up WHERE up.user_account_id=$1::uuid AND up.permission_id=p.permission_id
   AND up.effect='ALLOW' AND up.revoked_at IS NULL AND (up.expires_at IS NULL OR up.expires_at>statement_timestamp())) AS "directAllow",
 EXISTS(SELECT 1 FROM iam.iam_user_permissions up WHERE up.user_account_id=$1::uuid AND up.permission_id=p.permission_id
   AND up.effect='DENY' AND up.revoked_at IS NULL AND (up.expires_at IS NULL OR up.expires_at>statement_timestamp())) AS "directDeny"
 FROM iam.iam_permissions p ORDER BY p.module_code,p.resource_code,p.operation,p.permission_code LIMIT $2 OFFSET $3`;

export class ControllerOverviewService {
  constructor(private readonly host:ModuleHost){}
  private async enter(actor:ModuleActor,permission:ModulePermission):Promise<void>{
    await this.host.authorize(actor,permission,`${MODULE_KEY}.${permission.resourceCode}.READ`,'SYSTEM_CONTROLLER_API');
    const s=await this.host.lifecycle(MODULE_KEY);
    if(!s||!s.isEnabled||s.activeVersions!==1)throw new OverviewError(503,'MODULE_UNAVAILABLE','Module chưa ACTIVE hoặc chưa bật.');
  }
  private async read<R>(actor:ModuleActor,permission:ModulePermission,query:(tx:ReadOnlyQuery)=>Promise<R>):Promise<R>{
    await this.enter(actor,permission);
    try{return await this.host.readOnly(query);}
    catch(e){if(e instanceof OverviewError)throw e;this.host.logger.error('SCC overview read unavailable',{requestId:actor.requestId,sqlstate:this.host.sqlstate(e)});
      throw new OverviewError(503,'DATA_UNAVAILABLE','Không đọc được dữ liệu với quyền PostgreSQL hiện tại.');}
  }
  async modules(actor:ModuleActor,query:unknown){
    uniqueQuery(query,['page']);const p=page(queryValue(query,'page'));
    const rows=await this.read(actor,MODULE_PERMISSION,tx=>tx.query(MODULES_SQL,[101,(p-1)*100]));
    return {scope:'ALL_FOUNDATION_REGISTERED_VERSIONS',page:p,pageSize:100,hasNext:rows.length>100,rows:rows.slice(0,100)};
  }
  async functions(actor:ModuleActor,query:unknown){
    uniqueQuery(query,['page','moduleKey']);const p=page(queryValue(query,'page'));
    const key=queryValue(query,'moduleKey');
    if(typeof key!=='string'||!/^[A-Z][A-Z0-9_]{0,79}$/.test(key))throw new OverviewError(400,'VALIDATION_ERROR','Mã module không hợp lệ.');
    const rows=await this.read(actor,MODULE_PERMISSION,tx=>tx.query(FUNCTIONS_SQL,[key,101,(p-1)*100]));
    return {scope:'DECLARED_VERSION_FUNCTION_ACTIONS',moduleKey:key,page:p,pageSize:100,hasNext:rows.length>100,rows:rows.slice(0,100)};
  }
  async accounts(actor:ModuleActor,query:unknown){
    uniqueQuery(query,['page']);const p=page(queryValue(query,'page'));
    const rows=await this.read(actor,ACCESS_PERMISSION,tx=>tx.query(ACCOUNTS_SQL,[51,(p-1)*50]));
    return {scope:'MINIMAL_ACCOUNT_IDENTITY_AND_ACTIVE_ROLES',page:p,pageSize:50,hasNext:rows.length>50,rows:rows.slice(0,50)};
  }
  async matrix(actor:ModuleActor,query:unknown){
    uniqueQuery(query,['accountId','page']);const p=page(queryValue(query,'page'));const id=queryValue(query,'accountId');
    if(typeof id!=='string'||!UUID.test(id))throw new OverviewError(400,'VALIDATION_ERROR','Account ID không hợp lệ.');
    const rows=await this.read(actor,ACCESS_PERMISSION,async tx=>{
      // account must exist: never return a matrix for an unknown/deleted identity.
      const exists=await tx.query('SELECT 1 AS present FROM iam.iam_user_accounts WHERE user_account_id=$1::uuid',[id]);
      if(exists.length!==1)throw new OverviewError(404,'ACCOUNT_NOT_FOUND','Tài khoản không tồn tại.');
      return tx.query(MATRIX_SQL,[id,101,(p-1)*100]);
    });
    return {scope:'IAM_GRANT_SOURCES_NOT_SESSION_EFFECTIVE',accountId:id,page:p,pageSize:100,hasNext:rows.length>100,
      assumption:'Nguồn quyền được liệt kê từ role/direct grants; runtime còn xét assurance, trạng thái tài khoản và IAM evaluator. Quyền System Controller Center chỉ hợp lệ khi có TALO_SYSTEM_ADMIN.',rows:rows.slice(0,100)};
  }
}
