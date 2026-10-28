-- TALO-MOS-V4 · SCC 0.1.2 Foundation controlled read · 02 — column SELECT for the restricted owner
-- STATUS: PROPOSAL FOR OWNER APPROVAL — NOT EXECUTED ON TEST.
-- TARGET: talo_mos_v4_test, as admin (grantor must hold GRANT OPTION through ownership / superuser).
-- Only the two target tables, only listed columns. talo_app receives NOTHING on these tables.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'Abort: run on talo_mos_v4_test (currently "%")', current_database();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talo_foundation_reader'
                   AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolbypassrls AND NOT rolinherit) THEN
    RAISE EXCEPTION 'Abort: talo_foundation_reader must be a restricted NOLOGIN NOINHERIT role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid IN (m.member, m.roleid)
              WHERE r.rolname = 'talo_foundation_reader')
     OR has_schema_privilege('talo_foundation_reader', 'foundation', 'USAGE')
     OR EXISTS (SELECT 1 FROM pg_class c
                 WHERE c.relnamespace IN ('foundation'::regnamespace, 'iam'::regnamespace)
                   AND c.relkind IN ('r','p','v','m')
                   AND (has_any_column_privilege('talo_foundation_reader', c.oid, 'SELECT')
                        OR has_any_column_privilege('talo_foundation_reader', c.oid, 'INSERT')
                        OR has_any_column_privilege('talo_foundation_reader', c.oid, 'UPDATE')
                        OR has_table_privilege('talo_foundation_reader', c.oid, 'DELETE'))) THEN
    RAISE EXCEPTION 'Abort: talo_foundation_reader already has privileges or memberships; review manually';
  END IF;
  IF has_table_privilege('talo_app', 'foundation.fnd_module_events', 'SELECT')
     OR has_table_privilege('talo_app', 'foundation.fnd_data_access_rules', 'SELECT') THEN
    RAISE EXCEPTION 'Abort: baseline changed — talo_app already reads a target table directly';
  END IF;
END
$$;

BEGIN;
GRANT USAGE ON SCHEMA foundation TO talo_foundation_reader;
GRANT SELECT (event_id, module_id, version_id, event_type, actor_account_id, before_state, after_state, occurred_at, correlation_id)
  ON foundation.fnd_module_events TO talo_foundation_reader;
GRANT SELECT (access_rule_id, data_contract_id, version_action_id, data_operation, approval_mode, workflow_key, is_enabled, created_at)
  ON foundation.fnd_data_access_rules TO talo_foundation_reader;
COMMIT;
