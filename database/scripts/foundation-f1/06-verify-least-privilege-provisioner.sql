-- TALO-MOS-V4 · Foundation F1 · 06 — negative & positive privilege tests for talo_provisioner
-- STATUS: PREPARED, NOT EXECUTED. Requires a separate execution approval.
-- TARGET: database talo_mos_v4_test, CONNECTED AS talo_provisioner. Rolled back; nothing persists.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'Abort: run against talo_mos_v4_test only (connected to "%")', current_database();
  END IF;
  IF current_user <> 'talo_provisioner' THEN
    RAISE EXCEPTION 'Abort: connect as talo_provisioner (currently %)', current_user;
  END IF;
  IF (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'FAIL: talo_provisioner has elevated role attributes';
  END IF;
END
$$;

BEGIN;

DO $$
DECLARE
  attempt text;
  attempts text[] := ARRAY[
    'UPDATE iam.iam_memberships SET full_name = full_name',
    'UPDATE iam.iam_user_accounts SET account_status = account_status',
    'UPDATE iam.iam_credentials SET password_hash = password_hash',
    'DELETE FROM iam.iam_memberships',
    'DELETE FROM iam.iam_user_accounts',
    'DELETE FROM iam.iam_credentials',
    'TRUNCATE iam.iam_audit_logs',
    'SELECT 1 FROM iam.iam_credentials',
    'SELECT 1 FROM iam.iam_sessions',
    'INSERT INTO iam.iam_sessions (user_account_id, session_token_hash, expires_at) VALUES (gen_random_uuid(), ''x'', now() + interval ''1 minute'')',
    'SELECT 1 FROM iam.iam_audit_logs',
    'SELECT 1 FROM iam.iam_roles',
    'SELECT 1 FROM iam.iam_user_roles',
    'CREATE TABLE iam.f1_privilege_probe (id int)',
    'CREATE TEMP TABLE f1_privilege_probe (id int)'
  ];
BEGIN
  FOREACH attempt IN ARRAY attempts LOOP
    BEGIN
      EXECUTE attempt;
      RAISE EXCEPTION 'FAIL: statement was allowed: %', attempt;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK denied: %', attempt;
    END;
  END LOOP;
END
$$;

DO $$
DECLARE
  failures text[] := '{}';
BEGIN
  -- One privilege per call: with a comma-separated list has_*_privilege returns true if ANY is held.
  IF NOT has_table_privilege('iam.iam_memberships', 'SELECT') THEN failures := failures || 'SELECT iam_memberships'; END IF;
  IF NOT has_table_privilege('iam.iam_memberships', 'INSERT') THEN failures := failures || 'INSERT iam_memberships'; END IF;
  IF NOT has_table_privilege('iam.iam_user_accounts', 'SELECT') THEN failures := failures || 'SELECT iam_user_accounts'; END IF;
  IF NOT has_table_privilege('iam.iam_user_accounts', 'INSERT') THEN failures := failures || 'INSERT iam_user_accounts'; END IF;
  IF NOT has_table_privilege('iam.iam_credentials', 'INSERT') THEN failures := failures || 'INSERT iam_credentials'; END IF;
  IF NOT has_table_privilege('iam.iam_audit_logs', 'INSERT') THEN failures := failures || 'INSERT iam_audit_logs'; END IF;
  IF array_length(failures, 1) > 0 THEN
    RAISE EXCEPTION 'FAIL: missing privileges: %', array_to_string(failures, ', ');
  END IF;
  RAISE NOTICE 'OK: all expected privileges present';
END
$$;

ROLLBACK;
