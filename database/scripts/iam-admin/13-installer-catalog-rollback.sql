-- TALO-MOS-V4 FOUNDATION REV01-D2 — rollback of 11-installer-catalog-grant.sql (talo_mos_v4_test only, owner role).
-- WARNING: on talo_mos_v4_test these column privileges PRE-EXIST this task (IAM-NEXT grants) and 11 was NOT executed.
-- Running this file would also remove privileges IAM Management already relies on (permission catalog, IAM audit).
-- Use it only to undo a run of 11 on a database where the precheck showed them missing BEFORE that run.
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'refused: target database is %, expected talo_mos_v4_test', current_database();
  END IF;
END $$;
BEGIN;
REVOKE INSERT (permission_code, module_code, resource_code, operation, minimum_assurance_level, permission_description) ON iam.iam_permissions FROM talo_iam_admin;
REVOKE INSERT (actor_account_id, action_code, target_type, target_id, outcome, metadata) ON iam.iam_audit_logs FROM talo_iam_admin;
-- SELECT is left in place: talo_iam_admin had table-level SELECT before (IAM Management reads).
COMMIT;
