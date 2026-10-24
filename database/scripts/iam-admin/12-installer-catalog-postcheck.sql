-- TALO-MOS-V4 FOUNDATION REV01-D2 — postcheck (READ-ONLY). Fails (division by zero) when a needed privilege is missing or
-- a forbidden one is present, so a CI / psql -v ON_ERROR_STOP=1 run stops.
SET default_transaction_read_only = on;
SELECT current_database() AS database_name, current_user AS execution_role;
SELECT 1 / CASE WHEN
    (SELECT bool_and(has_column_privilege('talo_iam_admin', 'iam.iam_permissions', c, 'INSERT')) FROM unnest(ARRAY['permission_code','module_code','resource_code','operation','minimum_assurance_level','permission_description']) AS c)
AND (SELECT bool_and(has_column_privilege('talo_iam_admin', 'iam.iam_permissions', c, 'SELECT')) FROM unnest(ARRAY['permission_id','permission_code','module_code','resource_code','operation','minimum_assurance_level']) AS c)
AND (SELECT bool_and(has_column_privilege('talo_iam_admin', 'iam.iam_audit_logs', c, 'INSERT')) FROM unnest(ARRAY['actor_account_id','action_code','target_type','target_id','outcome','metadata']) AS c)
AND NOT (SELECT bool_or(has_table_privilege('talo_iam_admin', 'iam.iam_permissions', p)) FROM unnest(ARRAY['UPDATE','DELETE','TRUNCATE']) AS p)
AND NOT has_schema_privilege('talo_iam_admin', 'iam', 'CREATE')
AND NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = 'talo_iam_admin')
THEN 1 ELSE 0 END AS postcheck_ok;
