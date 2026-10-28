import { createPrismaClient } from '../src/infrastructure/prisma/client.js';

// Read-only SCC access inventory. The database/role guard prevents accidental use outside the approved TEST target.
// Output contains object names, status and role names only; the connection string and data rows are never printed.
const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL missing');

const needed = [
  ['DIAGNOSTICS', 'foundation', 'fnd_modules'], ['DIAGNOSTICS', 'foundation', 'fnd_module_versions'],
  ['DIAGNOSTICS', 'foundation', 'fnd_version_functions'], ['DIAGNOSTICS', 'foundation', 'fnd_functions'],
  ['DIAGNOSTICS', 'foundation', 'fnd_version_actions'], ['DIAGNOSTICS', 'foundation', 'fnd_actions'],
  ['DIAGNOSTICS', 'foundation', 'fnd_data_contracts'], ['DIAGNOSTICS', 'foundation', 'fnd_data_fields'],
  ['DIAGNOSTICS', 'foundation', 'fnd_compatibility_checks'], ['DIAGNOSTICS', 'foundation', 'fnd_compatibility_changes'],
  ['ARCHITECTURE', 'foundation', 'fnd_modules'], ['ARCHITECTURE', 'foundation', 'fnd_module_versions'],
  ['ARCHITECTURE', 'foundation', 'fnd_functions'], ['ARCHITECTURE', 'foundation', 'fnd_version_functions'],
  ['ARCHITECTURE', 'foundation', 'fnd_version_actions'], ['ARCHITECTURE', 'foundation', 'fnd_actions'],
  ['ACCESS_MATRIX', 'iam', 'iam_user_accounts'], ['ACCESS_MATRIX', 'iam', 'iam_user_roles'],
  ['ACCESS_MATRIX', 'iam', 'iam_roles'], ['ACCESS_MATRIX', 'iam', 'iam_role_permissions'],
  ['ACCESS_MATRIX', 'iam', 'iam_permissions'], ['ACCESS_MATRIX', 'iam', 'iam_user_permissions'],
  ['AUDIT_LOG', 'foundation', 'fnd_audit_logs'], ['AUDIT_LOG', 'iam', 'iam_audit_logs'],
] as const;

const db = createPrismaClient(url);
try {
  const report = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const [identity] = await tx.$queryRawUnsafe<{ db: string; usr: string; sess: string; ro: string }[]>(
      `SELECT current_database() db,current_user usr,session_user sess,current_setting('transaction_read_only') ro`,
    );
    if (identity?.db !== 'talo_mos_v4_test' || identity.usr !== 'talo_app' || identity.sess !== 'talo_app' || identity.ro !== 'on') {
      throw new Error('guard: inventory requires a read-only talo_app session on talo_mos_v4_test');
    }
    const module = await tx.$queryRawUnsafe(`SELECT m.module_key,m.is_enabled,v.module_version,v.status
      FROM foundation.fnd_modules m LEFT JOIN foundation.fnd_module_versions v ON v.module_id=m.module_id
      WHERE m.module_key='SYSTEM_CONTROLLER_CENTER' ORDER BY v.created_at`);
    const functions = await tx.$queryRawUnsafe(`SELECT
      to_regprocedure('audit_api.read_foundation_audit(timestamptz,timestamptz,text,text,uuid,integer)')::text foundation_reader,
      to_regprocedure('audit_api.read_iam_audit(timestamptz,timestamptz,text,text,uuid,integer)')::text iam_reader,
      to_regprocedure('audit_api.read_foundation_audit_summary(timestamptz,timestamptz)')::text foundation_summary`);
    const administrators = await tx.$queryRawUnsafe(`SELECT a.username,a.account_status,(a.disabled_at IS NULL) not_disabled,
      r.role_code,r.is_active,(ur.revoked_at IS NULL) not_revoked,(ur.assigned_at<=statement_timestamp()) started
      FROM iam.iam_user_accounts a JOIN iam.iam_user_roles ur ON ur.user_account_id=a.user_account_id
      JOIN iam.iam_roles r ON r.role_id=ur.role_id WHERE r.role_code='TALO_SYSTEM_ADMIN' ORDER BY a.username`);
    const iamPolicySources = await tx.$queryRawUnsafe(`SELECT
      (SELECT count(*)::int FROM iam.iam_role_permissions rp JOIN iam.iam_permissions p ON p.permission_id=rp.permission_id
        JOIN iam.iam_roles r ON r.role_id=rp.role_id JOIN iam.iam_user_roles ur ON ur.role_id=r.role_id
        JOIN iam.iam_user_accounts a ON a.user_account_id=ur.user_account_id
        WHERE p.module_code='SYSTEM_CONTROLLER_CENTER' AND r.is_active=TRUE AND ur.revoked_at IS NULL
          AND ur.assigned_at<=statement_timestamp() AND a.account_status='ACTIVE' AND a.disabled_at IS NULL) effective_role_allows,
      (SELECT count(*)::int FROM iam.iam_user_permissions up JOIN iam.iam_permissions p ON p.permission_id=up.permission_id
        WHERE p.module_code='SYSTEM_CONTROLLER_CENTER' AND up.effect='ALLOW' AND up.revoked_at IS NULL
          AND up.assigned_at<=statement_timestamp() AND (up.expires_at IS NULL OR up.expires_at>statement_timestamp())) direct_allows,
      (SELECT count(DISTINCT ur.user_account_id)::int FROM iam.iam_user_roles ur JOIN iam.iam_roles r ON r.role_id=ur.role_id
        JOIN iam.iam_user_accounts a ON a.user_account_id=ur.user_account_id
        WHERE r.role_code='TALO_SYSTEM_ADMIN' AND r.is_active=TRUE AND ur.revoked_at IS NULL
          AND ur.assigned_at<=statement_timestamp() AND a.account_status='ACTIVE' AND a.disabled_at IS NULL) eligible_system_admins`);
    const directDenies = await tx.$queryRawUnsafe(`SELECT a.username,p.permission_code FROM iam.iam_user_permissions up
      JOIN iam.iam_user_accounts a ON a.user_account_id=up.user_account_id
      JOIN iam.iam_permissions p ON p.permission_id=up.permission_id
      WHERE p.module_code='SYSTEM_CONTROLLER_CENTER' AND up.effect='DENY' AND up.revoked_at IS NULL
        AND up.assigned_at<=statement_timestamp() AND (up.expires_at IS NULL OR up.expires_at>statement_timestamp())
      ORDER BY a.username,p.permission_code`);
    const objects: object[] = [];
    for (const [feature, schema, table] of needed) {
      const [privilege] = await tx.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT to_regclass($1)::text relation,
        has_schema_privilege(current_user,$2,'USAGE') schema_usage,
        CASE WHEN to_regclass($1) IS NULL THEN false ELSE has_table_privilege(current_user,to_regclass($1),'SELECT') END table_select,
        CASE WHEN to_regclass($1) IS NULL THEN false ELSE has_any_column_privilege(current_user,to_regclass($1),'SELECT') END any_column_select`,
      `${schema}.${table}`, schema);
      objects.push({ feature, schema, table, ...privilege });
    }
    const permissionCatalog = await tx.$queryRawUnsafe(`SELECT permission_code,resource_code,operation,minimum_assurance_level
      FROM iam.iam_permissions WHERE module_code='SYSTEM_CONTROLLER_CENTER' ORDER BY permission_code`);
    return { identity, module, functions, administrators, iamPolicySources, directDenies, permissionCatalog, objects };
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await db.$disconnect();
}
