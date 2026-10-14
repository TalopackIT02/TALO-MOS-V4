-- TALO-MOS-V4 · Foundation F1 · 05 — negative & positive privilege tests for talo_app
-- STATUS: PREPARED, NOT EXECUTED. Requires a separate execution approval.
-- TARGET: database talo_mos_v4_test, CONNECTED AS talo_app (not as a superuser).
-- Everything runs inside one transaction that is ROLLED BACK; nothing persists. The TRUNCATE/DELETE/DDL
-- statements below are attempts that MUST be refused with insufficient_privilege (SQLSTATE 42501);
-- any attempt that succeeds aborts the script with "FAIL".

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'Abort: run against talo_mos_v4_test only (connected to "%")', current_database();
  END IF;
  IF current_user <> 'talo_app' THEN
    RAISE EXCEPTION 'Abort: connect as talo_app (currently %)', current_user;
  END IF;
  IF (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'FAIL: talo_app has elevated role attributes';
  END IF;
END
$$;

BEGIN;

-- 1) Statements that must be DENIED (42501)
DO $$
DECLARE
  attempt text;
  attempts text[] := ARRAY[
    'DELETE FROM iam.iam_sessions',
    'DELETE FROM iam.iam_credentials',
    'DELETE FROM iam.iam_user_accounts',
    'DELETE FROM iam.iam_audit_logs',
    'TRUNCATE iam.iam_audit_logs',
    'UPDATE iam.iam_user_accounts SET username = username',
    'UPDATE iam.iam_user_accounts SET membership_id = membership_id',
    'UPDATE iam.iam_user_accounts SET disabled_at = disabled_at',
    'UPDATE iam.iam_credentials SET user_account_id = user_account_id',
    'UPDATE iam.iam_sessions SET session_token_hash = session_token_hash',
    'UPDATE iam.iam_sessions SET expires_at = expires_at',
    'UPDATE iam.iam_audit_logs SET outcome = outcome',
    'UPDATE iam.iam_memberships SET membership_status = membership_status',
    'SELECT 1 FROM iam.iam_audit_logs',
    'SELECT 1 FROM iam.iam_roles',
    'SELECT 1 FROM iam.iam_permissions',
    'SELECT 1 FROM iam.iam_role_permissions',
    'SELECT 1 FROM iam.iam_user_roles',
    'SELECT 1 FROM iam.iam_user_permissions',
    'SELECT 1 FROM iam.iam_account_verifications',
    'INSERT INTO iam.iam_memberships (employee_id, employee_code, full_name, membership_status, joined_at) VALUES (gen_random_uuid(), ''X'', ''X'', ''ACTIVE'', current_date)',
    'INSERT INTO iam.iam_roles (role_code, role_name) VALUES (''X'', ''X'')',
    'CREATE TABLE iam.f1_privilege_probe (id int)',
    'CREATE TABLE public.f1_privilege_probe (id int)',
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

-- 2) Privileges that must be PRESENT (checked without writing data)
DO $$
DECLARE
  failures text[] := '{}';
BEGIN
  -- One privilege per call: with a comma-separated list has_*_privilege returns true if ANY is held.
  IF NOT has_table_privilege('iam.iam_memberships', 'SELECT') THEN failures := failures || 'SELECT iam_memberships'; END IF;
  IF NOT has_table_privilege('iam.iam_user_accounts', 'SELECT') THEN failures := failures || 'SELECT iam_user_accounts'; END IF;
  IF NOT has_column_privilege('iam.iam_user_accounts', 'account_status', 'UPDATE') THEN failures := failures || 'UPDATE account_status'; END IF;
  IF NOT has_column_privilege('iam.iam_user_accounts', 'activated_at', 'UPDATE') THEN failures := failures || 'UPDATE activated_at'; END IF;
  IF NOT has_table_privilege('iam.iam_credentials', 'SELECT') THEN failures := failures || 'SELECT iam_credentials'; END IF;
  IF NOT has_column_privilege('iam.iam_credentials', 'password_hash', 'UPDATE') THEN failures := failures || 'UPDATE password_hash'; END IF;
  IF NOT has_column_privilege('iam.iam_credentials', 'failed_attempt_count', 'UPDATE') THEN failures := failures || 'UPDATE failed_attempt_count'; END IF;
  IF NOT has_column_privilege('iam.iam_credentials', 'locked_until', 'UPDATE') THEN failures := failures || 'UPDATE locked_until'; END IF;
  IF NOT has_table_privilege('iam.iam_sessions', 'SELECT') THEN failures := failures || 'SELECT iam_sessions'; END IF;
  IF NOT has_table_privilege('iam.iam_sessions', 'INSERT') THEN failures := failures || 'INSERT iam_sessions'; END IF;
  IF NOT has_column_privilege('iam.iam_sessions', 'revoked_at', 'UPDATE') THEN failures := failures || 'UPDATE revoked_at'; END IF;
  IF NOT has_column_privilege('iam.iam_sessions', 'last_seen_at', 'UPDATE') THEN failures := failures || 'UPDATE last_seen_at'; END IF;
  IF NOT has_table_privilege('iam.iam_audit_logs', 'INSERT') THEN failures := failures || 'INSERT iam_audit_logs'; END IF;
  IF array_length(failures, 1) > 0 THEN
    RAISE EXCEPTION 'FAIL: missing privileges: %', array_to_string(failures, ', ');
  END IF;
  RAISE NOTICE 'OK: all expected privileges present';
END
$$;

-- 3) Row locking used by SC-5 / first-change must be permitted (works on an empty table)
SELECT count(*) AS locked_rows FROM (SELECT 1 FROM iam.iam_credentials FOR UPDATE) AS locked;

ROLLBACK;

-- PENDING VALIDATION (needs test data, therefore a later approved step): run the backend integration tests
-- with DATABASE_URL pointing to talo_mos_v4_test as talo_app, covering INSERT ... RETURNING on iam_sessions,
-- audit inserts without RETURNING, and the column-restricted UPDATEs issued by Prisma.
