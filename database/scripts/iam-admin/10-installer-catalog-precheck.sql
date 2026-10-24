-- TALO-MOS-V4 FOUNDATION REV01-D2 — Installer IAM catalog: READ-ONLY privilege precheck.
-- Run TWICE: (1) as the owner role (admin) to see grants of talo_iam_admin; (2) through the Installer's own IAM connection
-- (IAM_ADMIN_DATABASE_URL → talo_iam_admin) to confirm current_user / session_user. Never prints a secret.
-- Expected target: talo_mos_v4_test only.
SET default_transaction_read_only = on;
SELECT current_database() AS database_name, current_user AS execution_role, session_user AS login_role;

-- Role attributes: none of superuser / bypassrls / createrole / createdb may be granted for this purpose.
SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'talo_iam_admin';

-- The exact column privileges the write path needs (IamAdminRepository.createPermission + mutation() audit).
SELECT 'iam.iam_permissions' AS tbl, c AS col, 'INSERT' AS priv, has_column_privilege('talo_iam_admin', 'iam.iam_permissions', c, 'INSERT') AS granted
  FROM unnest(ARRAY['permission_code','module_code','resource_code','operation','minimum_assurance_level','permission_description']) AS c
UNION ALL
SELECT 'iam.iam_permissions', c, 'SELECT', has_column_privilege('talo_iam_admin', 'iam.iam_permissions', c, 'SELECT')
  FROM unnest(ARRAY['permission_id','permission_code','module_code','resource_code','operation','minimum_assurance_level']) AS c
UNION ALL
SELECT 'iam.iam_audit_logs', c, 'INSERT', has_column_privilege('talo_iam_admin', 'iam.iam_audit_logs', c, 'INSERT')
  FROM unnest(ARRAY['actor_account_id','action_code','target_type','target_id','outcome','metadata']) AS c
UNION ALL
SELECT 'foundation.fnd_modules', '(table)', 'SELECT', has_table_privilege('talo_iam_admin', 'foundation.fnd_modules', 'SELECT')
UNION ALL
SELECT 'foundation.fnd_module_versions', '(table)', 'SELECT', has_table_privilege('talo_iam_admin', 'foundation.fnd_module_versions', 'SELECT');

-- Forbidden for this purpose (must all be false): UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER on iam_permissions,
-- schema CREATE (DDL).
SELECT p AS priv, has_table_privilege('talo_iam_admin', 'iam.iam_permissions', p) AS granted
  FROM unnest(ARRAY['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p
UNION ALL
SELECT 'CREATE ON SCHEMA iam', has_schema_privilege('talo_iam_admin', 'iam', 'CREATE');

-- Raw ACLs (for the before / after report).
SELECT 'table' AS level, relacl::text AS acl FROM pg_class WHERE oid = 'iam.iam_permissions'::regclass
UNION ALL
SELECT 'column ' || attname, attacl::text FROM pg_attribute WHERE attrelid = 'iam.iam_permissions'::regclass AND attacl IS NOT NULL;
