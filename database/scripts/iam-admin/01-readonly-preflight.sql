-- TALO-MOS-V4 IAM Administration: READ-ONLY privilege and bootstrap preflight.
-- Run against the explicitly approved target database as the actual runtime role.
-- Do not infer DATABASE_URL or run writes in this step.
SELECT current_database() AS database_name,current_user AS execution_role,session_user AS login_role;
SELECT table_schema,table_name,
       has_table_privilege(current_user,format('%I.%I',table_schema,table_name),'SELECT') AS can_select,
       has_table_privilege(current_user,format('%I.%I',table_schema,table_name),'INSERT') AS can_insert,
       has_table_privilege(current_user,format('%I.%I',table_schema,table_name),'UPDATE') AS can_update,
       has_table_privilege(current_user,format('%I.%I',table_schema,table_name),'DELETE') AS can_delete
 FROM information_schema.tables
WHERE (table_schema='iam' AND table_name IN
('iam_user_accounts','iam_memberships','iam_roles','iam_permissions','iam_role_permissions','iam_user_roles','iam_user_permissions','iam_audit_logs'))
 OR (table_schema='foundation' AND table_name IN
('fnd_modules','fnd_module_versions','fnd_functions','fnd_version_functions','fnd_actions','fnd_version_actions','fnd_navigation_items'))
ORDER BY table_schema,table_name;
SELECT p.permission_code,p.module_code,p.resource_code,p.operation,
       p.minimum_assurance_level,
       count(ur.user_role_id) FILTER(WHERE ur.revoked_at IS NULL AND r.is_active)::int AS active_role_assignments,
       count(up.user_permission_id) FILTER(WHERE up.revoked_at IS NULL AND up.effect='ALLOW')::int AS active_direct_allows
FROM iam.iam_permissions p
LEFT JOIN iam.iam_role_permissions rp ON rp.permission_id=p.permission_id
LEFT JOIN iam.iam_roles r ON r.role_id=rp.role_id
LEFT JOIN iam.iam_user_roles ur ON ur.role_id=r.role_id
LEFT JOIN iam.iam_user_permissions up ON up.permission_id=p.permission_id
WHERE p.permission_code IN ('iam.accounts.read','iam.roles.manage','iam.permissions.manage','iam.assignments.manage','foundation.navigation.manage')
GROUP BY p.permission_code,p.module_code,p.resource_code,p.operation,p.minimum_assurance_level
ORDER BY p.permission_code;
SELECT m.module_id,m.module_key,m.is_enabled,v.module_version,v.status,v.manifest_hash,
       (SELECT count(*) FROM foundation.fnd_navigation_items n WHERE n.module_id=m.module_id) AS menu_items
FROM foundation.fnd_modules m
LEFT JOIN foundation.fnd_module_versions v ON v.module_id=m.module_id
WHERE m.module_key='SYSTEM_TEST'
ORDER BY v.module_version;
-- No GRANT, no INSERT, no UPDATE, no DELETE, no DDL.
