-- TALO-MOS-V4 · AUTH-SC5-V1 · harness 02 — least-privilege grants for talo_test_harness on the TEST database
-- TARGET: talo_mos_v4_test only. Privilege matrix: README.md. Contains no DROP/TRUNCATE; changes no schema object.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'Abort: grants are for talo_mos_v4_test only (connected to "%")', current_database();
  END IF;
  IF (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'iam') <> 11 THEN
    RAISE EXCEPTION 'Abort: schema iam must contain the 11 IAM v0.3 tables';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talo_test_harness' AND NOT rolsuper AND NOT rolcreatedb
                 AND NOT rolcreaterole AND NOT rolbypassrls AND NOT rolreplication) THEN
    RAISE EXCEPTION 'Abort: talo_test_harness must exist without elevated attributes';
  END IF;
END
$$;

BEGIN;

GRANT CONNECT ON DATABASE talo_mos_v4_test TO talo_test_harness;
GRANT USAGE ON SCHEMA iam TO talo_test_harness;

GRANT SELECT, INSERT, DELETE ON iam.iam_memberships TO talo_test_harness;
GRANT UPDATE (membership_status, left_at) ON iam.iam_memberships TO talo_test_harness;

GRANT SELECT, INSERT, DELETE ON iam.iam_user_accounts TO talo_test_harness;
GRANT UPDATE (account_status, disabled_at) ON iam.iam_user_accounts TO talo_test_harness;

GRANT SELECT, INSERT, DELETE ON iam.iam_credentials TO talo_test_harness;
GRANT UPDATE (locked_until, password_hash, updated_at) ON iam.iam_credentials TO talo_test_harness;

GRANT SELECT, DELETE ON iam.iam_sessions TO talo_test_harness;
GRANT UPDATE (revoked_at) ON iam.iam_sessions TO talo_test_harness;

GRANT SELECT, DELETE ON iam.iam_audit_logs TO talo_test_harness;

COMMIT;

SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'iam' AND grantee = 'talo_test_harness' ORDER BY table_name, privilege_type;

SELECT table_name, column_name FROM information_schema.column_privileges
WHERE table_schema = 'iam' AND grantee = 'talo_test_harness' AND privilege_type = 'UPDATE' ORDER BY 1, 2;
