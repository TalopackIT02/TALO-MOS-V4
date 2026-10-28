-- TALO-MOS-V4 · SCC Audit Read · 02 — exact source-column grants for the NOLOGIN owner
-- STATUS: PROPOSAL FOR OWNER APPROVAL — NOT EXECUTED.
-- TARGET: talo_mos_v4_test only, as database/object owner.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'Abort: run on talo_mos_v4_test (currently "%")', current_database();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talo_audit_reader'
                   AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'Abort: talo_audit_reader must be a restricted NOLOGIN role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid IN (m.member, m.roleid)
              WHERE r.rolname = 'talo_audit_reader')
     OR has_schema_privilege('talo_audit_reader', 'foundation', 'USAGE')
     OR has_schema_privilege('talo_audit_reader', 'iam', 'USAGE')
     OR EXISTS (SELECT 1 FROM pg_class c
                 WHERE c.relnamespace IN ('foundation'::regnamespace, 'iam'::regnamespace)
                   AND c.relkind IN ('r','v','m')
                   AND (has_any_column_privilege('talo_audit_reader', c.oid, 'SELECT')
                        OR has_any_column_privilege('talo_audit_reader', c.oid, 'INSERT')
                        OR has_any_column_privilege('talo_audit_reader', c.oid, 'UPDATE')
                        OR has_table_privilege('talo_audit_reader', c.oid, 'DELETE'))) THEN
    RAISE EXCEPTION 'Abort: talo_audit_reader already has privileges or memberships; review manually';
  END IF;
END
$$;

BEGIN;
GRANT USAGE ON SCHEMA foundation, iam TO talo_audit_reader;

GRANT SELECT (event_id, actor_account_id, action_code, target_type, target_id,
              outcome, occurred_at, correlation_id, metadata)
  ON foundation.fnd_audit_logs TO talo_audit_reader;
GRANT SELECT (audit_id, actor_account_id, action_code, target_type, target_id,
              outcome, occurred_at, metadata)
  ON iam.iam_audit_logs TO talo_audit_reader;
GRANT SELECT (user_account_id, username)
  ON iam.iam_user_accounts TO talo_audit_reader;
COMMIT;
