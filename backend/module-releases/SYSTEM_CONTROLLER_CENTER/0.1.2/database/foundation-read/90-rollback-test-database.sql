-- TALO-MOS-V4 · SCC 0.1.2 Foundation controlled read · 90 — guarded rollback of 02–03 on talo_mos_v4_test
-- STATUS: PROPOSAL FOR OWNER APPROVAL — NOT EXECUTED ON TEST.
-- Independent of the SCC 0.1.1 audit_api gate (separate role and schema): this script never touches audit_api.
-- Run SCC back on 0.1.1 first (or accept that 0.1.2 Data Inspection reports DB_OBJECT_MISSING for the two tables).
-- The cluster role is dropped by 91 (cluster level), only after this script succeeded.
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_owner oid := (SELECT oid FROM pg_roles WHERE rolname = 'talo_foundation_reader');
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'Abort: run on talo_mos_v4_test (currently "%")', current_database();
  END IF;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Abort: talo_foundation_reader missing'; END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = v_owner OR roleid = v_owner)
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proowner = v_owner
                 AND oid NOT IN (
                   coalesce(to_regprocedure('foundation_read_api.read_module_events(timestamptz,timestamptz,uuid,text,integer,integer)')::oid,0),
                   coalesce(to_regprocedure('foundation_read_api.read_data_access_rules(uuid,boolean,integer,integer)')::oid,0)))
     OR EXISTS (SELECT 1 FROM pg_class WHERE relowner = v_owner) THEN
    RAISE EXCEPTION 'Abort: owner has memberships or objects outside this proposal';
  END IF;
  IF to_regnamespace('foundation_read_api') IS NOT NULL AND EXISTS (
       SELECT 1 FROM pg_class WHERE relnamespace = 'foundation_read_api'::regnamespace
       UNION ALL
       SELECT 1 FROM pg_proc WHERE pronamespace = 'foundation_read_api'::regnamespace
         AND oid NOT IN (
           coalesce(to_regprocedure('foundation_read_api.read_module_events(timestamptz,timestamptz,uuid,text,integer,integer)')::oid,0),
           coalesce(to_regprocedure('foundation_read_api.read_data_access_rules(uuid,boolean,integer,integer)')::oid,0))) THEN
    RAISE EXCEPTION 'Abort: foundation_read_api contains objects outside this proposal';
  END IF;
END
$$;

BEGIN;
DROP FUNCTION IF EXISTS foundation_read_api.read_module_events(timestamptz,timestamptz,uuid,text,integer,integer);
DROP FUNCTION IF EXISTS foundation_read_api.read_data_access_rules(uuid,boolean,integer,integer);
DROP SCHEMA IF EXISTS foundation_read_api;
REVOKE SELECT (access_rule_id, data_contract_id, version_action_id, data_operation, approval_mode, workflow_key, is_enabled, created_at)
  ON foundation.fnd_data_access_rules FROM talo_foundation_reader;
REVOKE SELECT (event_id, module_id, version_id, event_type, actor_account_id, before_state, after_state, occurred_at, correlation_id)
  ON foundation.fnd_module_events FROM talo_foundation_reader;
REVOKE USAGE ON SCHEMA foundation FROM talo_foundation_reader;
COMMIT;
