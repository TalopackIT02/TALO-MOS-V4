-- TALO-MOS-V4 · P-4e recovery · 90 — rollback of 02/03 on the test database (function + owner grants).
-- STATUS: PROPOSAL FOR REVIEW — NOT EXECUTED. The NOLOGIN role from 01 is removed manually after this, if decided.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'Abort: run on talo_mos_v4_test (currently "%")', current_database();
  END IF;
END
$$;

BEGIN;
DROP FUNCTION IF EXISTS iam.reissue_temporary_credential(text, text, uuid, uuid);
REVOKE ALL ON iam.iam_user_accounts, iam.iam_memberships, iam.iam_user_roles, iam.iam_user_permissions,
              iam.iam_credentials, iam.iam_sessions, iam.iam_audit_logs FROM talo_credential_recovery;
REVOKE USAGE ON SCHEMA iam FROM talo_credential_recovery;
COMMIT;
