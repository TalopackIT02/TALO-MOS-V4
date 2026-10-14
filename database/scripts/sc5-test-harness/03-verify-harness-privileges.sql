-- TALO-MOS-V4 · AUTH-SC5-V1 · harness 03 — verify talo_test_harness is least-privilege
-- TARGET: talo_mos_v4_test, CONNECTED AS talo_test_harness. Everything inside a transaction that is rolled back.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'talo_mos_v4_test' OR current_user <> 'talo_test_harness' THEN
    RAISE EXCEPTION 'Abort: run on talo_mos_v4_test as talo_test_harness (got %, %)', current_database(), current_user;
  END IF;
  IF (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'FAIL: elevated role attributes';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = current_user)) THEN
    RAISE EXCEPTION 'FAIL: member of other roles';
  END IF;
END
$$;

BEGIN;

DO $$
DECLARE
  attempt text;
  attempts text[] := ARRAY[
    'TRUNCATE iam.iam_audit_logs',
    'CREATE TABLE iam.sc5_probe (id int)',
    'CREATE TABLE public.sc5_probe (id int)',
    'CREATE TEMP TABLE sc5_probe (id int)',
    'INSERT INTO iam.iam_sessions (user_account_id, session_token_hash, expires_at) VALUES (gen_random_uuid(), ''x'', now() + interval ''1 minute'')',
    'INSERT INTO iam.iam_audit_logs (action_code, target_type, outcome) VALUES (''X'', ''X'', ''SUCCESS'')',
    'UPDATE iam.iam_memberships SET full_name = full_name',
    'UPDATE iam.iam_memberships SET employee_code = employee_code',
    'UPDATE iam.iam_user_accounts SET username = username',
    'UPDATE iam.iam_user_accounts SET membership_id = membership_id',
    'UPDATE iam.iam_credentials SET failed_attempt_count = failed_attempt_count',
    'UPDATE iam.iam_credentials SET must_change_password = must_change_password',
    'UPDATE iam.iam_sessions SET expires_at = expires_at',
    'UPDATE iam.iam_audit_logs SET outcome = outcome',
    'SELECT 1 FROM iam.iam_roles',
    'SELECT 1 FROM iam.iam_permissions',
    'SELECT 1 FROM iam.iam_role_permissions',
    'SELECT 1 FROM iam.iam_user_roles',
    'SELECT 1 FROM iam.iam_user_permissions',
    'SELECT 1 FROM iam.iam_account_verifications',
    'DELETE FROM iam.iam_roles'
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
  t text;
BEGIN
  -- One privilege per call (a comma-separated list returns true if ANY is held).
  FOREACH t IN ARRAY ARRAY['iam.iam_memberships', 'iam.iam_user_accounts', 'iam.iam_credentials'] LOOP
    IF NOT has_table_privilege(t, 'SELECT') THEN failures := failures || ('SELECT ' || t); END IF;
    IF NOT has_table_privilege(t, 'INSERT') THEN failures := failures || ('INSERT ' || t); END IF;
    IF NOT has_table_privilege(t, 'DELETE') THEN failures := failures || ('DELETE ' || t); END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['iam.iam_sessions', 'iam.iam_audit_logs'] LOOP
    IF NOT has_table_privilege(t, 'SELECT') THEN failures := failures || ('SELECT ' || t); END IF;
    IF NOT has_table_privilege(t, 'DELETE') THEN failures := failures || ('DELETE ' || t); END IF;
  END LOOP;
  IF NOT has_column_privilege('iam.iam_memberships', 'membership_status', 'UPDATE') THEN failures := failures || 'UPDATE membership_status'::text; END IF;
  IF NOT has_column_privilege('iam.iam_memberships', 'left_at', 'UPDATE') THEN failures := failures || 'UPDATE left_at'::text; END IF;
  IF NOT has_column_privilege('iam.iam_user_accounts', 'account_status', 'UPDATE') THEN failures := failures || 'UPDATE account_status'::text; END IF;
  IF NOT has_column_privilege('iam.iam_user_accounts', 'disabled_at', 'UPDATE') THEN failures := failures || 'UPDATE disabled_at'::text; END IF;
  IF NOT has_column_privilege('iam.iam_credentials', 'locked_until', 'UPDATE') THEN failures := failures || 'UPDATE locked_until'::text; END IF;
  IF NOT has_column_privilege('iam.iam_credentials', 'password_hash', 'UPDATE') THEN failures := failures || 'UPDATE password_hash'::text; END IF;
  IF NOT has_column_privilege('iam.iam_credentials', 'updated_at', 'UPDATE') THEN failures := failures || 'UPDATE updated_at'::text; END IF;
  IF NOT has_column_privilege('iam.iam_sessions', 'revoked_at', 'UPDATE') THEN failures := failures || 'UPDATE revoked_at'::text; END IF;
  IF has_database_privilege(current_database(), 'TEMP') THEN failures := failures || 'TEMP must be denied'::text; END IF;
  IF has_schema_privilege('iam', 'CREATE') OR has_schema_privilege('public', 'CREATE') THEN failures := failures || 'CREATE must be denied'::text; END IF;
  IF array_length(failures, 1) > 0 THEN
    RAISE EXCEPTION 'FAIL: %', array_to_string(failures, ', ');
  END IF;
  RAISE NOTICE 'OK: privileges match the matrix';
END
$$;

-- Writer lock coupling must be possible for the harness (FOR NO KEY UPDATE on accounts; empty table is fine).
SELECT count(*) AS lockable_accounts FROM (SELECT 1 FROM iam.iam_user_accounts FOR NO KEY UPDATE) AS l;

ROLLBACK;
