-- Guarded rollback of 02-03 on talo_mos_v4_test. The cluster role is intentionally retained for manual review.
-- STATUS: PROPOSAL FOR OWNER APPROVAL — NOT EXECUTED.
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_owner oid := (SELECT oid FROM pg_roles WHERE rolname = 'talo_audit_reader');
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'Abort: run on talo_mos_v4_test (currently "%")', current_database();
  END IF;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Abort: talo_audit_reader missing'; END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = v_owner OR roleid = v_owner)
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proowner = v_owner
                 AND oid NOT IN (
                   coalesce(to_regprocedure('audit_api.read_foundation_audit(timestamptz,timestamptz,text,text,uuid,integer)')::oid,0),
                   coalesce(to_regprocedure('audit_api.read_iam_audit(timestamptz,timestamptz,text,text,uuid,integer)')::oid,0),
                   coalesce(to_regprocedure('audit_api.read_foundation_audit_summary(timestamptz,timestamptz)')::oid,0)))
     OR EXISTS (SELECT 1 FROM pg_class WHERE relowner = v_owner) THEN
    RAISE EXCEPTION 'Abort: owner has memberships or objects outside this proposal';
  END IF;
  IF to_regnamespace('audit_api') IS NOT NULL AND EXISTS (
       SELECT 1 FROM pg_proc WHERE pronamespace='audit_api'::regnamespace
         AND oid NOT IN (
           coalesce(to_regprocedure('audit_api.read_foundation_audit(timestamptz,timestamptz,text,text,uuid,integer)')::oid,0),
           coalesce(to_regprocedure('audit_api.read_iam_audit(timestamptz,timestamptz,text,text,uuid,integer)')::oid,0),
           coalesce(to_regprocedure('audit_api.read_foundation_audit_summary(timestamptz,timestamptz)')::oid,0))) THEN
    RAISE EXCEPTION 'Abort: audit_api contains functions outside this proposal';
  END IF;
END
$$;

BEGIN;
DROP FUNCTION IF EXISTS audit_api.read_foundation_audit(timestamptz,timestamptz,text,text,uuid,integer);
DROP FUNCTION IF EXISTS audit_api.read_iam_audit(timestamptz,timestamptz,text,text,uuid,integer);
DROP FUNCTION IF EXISTS audit_api.read_foundation_audit_summary(timestamptz,timestamptz);
REVOKE USAGE ON SCHEMA audit_api FROM talo_app, talo_audit_reader;
DROP SCHEMA audit_api;

REVOKE SELECT (user_account_id, username) ON iam.iam_user_accounts FROM talo_audit_reader;
REVOKE SELECT (audit_id, actor_account_id, action_code, target_type, target_id,
               outcome, occurred_at, metadata) ON iam.iam_audit_logs FROM talo_audit_reader;
REVOKE SELECT (event_id, actor_account_id, action_code, target_type, target_id,
               outcome, occurred_at, correlation_id, metadata) ON foundation.fnd_audit_logs FROM talo_audit_reader;
REVOKE USAGE ON SCHEMA foundation, iam FROM talo_audit_reader;
COMMIT;
