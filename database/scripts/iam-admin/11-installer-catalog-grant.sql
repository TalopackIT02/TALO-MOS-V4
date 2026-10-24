-- TALO-MOS-V4 FOUNDATION REV01-D2 — minimal COLUMN-level grants for the Installer IAM catalog (talo_iam_admin).
-- Owner-approved scope: talo_mos_v4_test ONLY, after backup + 10-installer-catalog-precheck.sql. Run as the owner role.
-- Idempotent (GRANT of an existing privilege is a no-op). No table-wide INSERT, no UPDATE / DELETE / DDL / ALL,
-- no schema-wide grant, no role attribute change.
-- STATUS 2026-10-24: NOT EXECUTED — the precheck showed every privilege below already granted on talo_mos_v4_test
-- (column grants of IAM-NEXT); the Installer's IAM_DB_GRANT_MISSING was a false negative of a table-level check.
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'refused: target database is %, expected talo_mos_v4_test', current_database();
  END IF;
END $$;
BEGIN;
GRANT INSERT (permission_code, module_code, resource_code, operation, minimum_assurance_level, permission_description) ON iam.iam_permissions TO talo_iam_admin;
GRANT SELECT (permission_id, permission_code, module_code, resource_code, operation, minimum_assurance_level) ON iam.iam_permissions TO talo_iam_admin;
GRANT INSERT (actor_account_id, action_code, target_type, target_id, outcome, metadata) ON iam.iam_audit_logs TO talo_iam_admin;
COMMIT;
