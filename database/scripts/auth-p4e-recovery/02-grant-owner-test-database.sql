-- TALO-MOS-V4 · P-4e recovery · 02 — column-level privileges of the function OWNER (test database)
-- STATUS: PROPOSAL FOR REVIEW — NOT EXECUTED. Run only after explicit approval.
-- TARGET: talo_mos_v4_test, as admin. These privileges are used ONLY through the SECURITY DEFINER function, because
-- talo_credential_recovery cannot log in. talo_provisioner receives NO new table privilege (see 03 / 04).

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'Abort: run on talo_mos_v4_test (currently "%")', current_database();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talo_credential_recovery' AND NOT rolcanlogin AND NOT rolsuper) THEN
    RAISE EXCEPTION 'Abort: talo_credential_recovery must exist, NOLOGIN, not superuser';
  END IF;
END
$$;

BEGIN;
GRANT USAGE ON SCHEMA iam TO talo_credential_recovery;

-- Target lookup + writer-protocol row lock (FOR NO KEY UPDATE needs UPDATE on one column; the function never updates it).
GRANT SELECT (user_account_id, membership_id, username, account_status, disabled_at) ON iam.iam_user_accounts TO talo_credential_recovery;
GRANT UPDATE (account_status) ON iam.iam_user_accounts TO talo_credential_recovery;

-- Eligibility of target and operator (AD-3).
GRANT SELECT (membership_id, membership_status, left_at) ON iam.iam_memberships TO talo_credential_recovery;

-- Privileged-target refusal: accounts holding any active role or direct permission are not recoverable by IT tooling.
GRANT SELECT (user_account_id, revoked_at) ON iam.iam_user_roles TO talo_credential_recovery;
GRANT SELECT (user_account_id, revoked_at) ON iam.iam_user_permissions TO talo_credential_recovery;

-- Credential replacement (version bump reads updated_at).
GRANT SELECT (user_account_id, updated_at) ON iam.iam_credentials TO talo_credential_recovery;
GRANT UPDATE (password_hash, must_change_password, failed_attempt_count, locked_until, updated_at) ON iam.iam_credentials TO talo_credential_recovery;

-- Revoke every live session of the target.
GRANT SELECT (user_account_id, revoked_at) ON iam.iam_sessions TO talo_credential_recovery;
GRANT UPDATE (revoked_at) ON iam.iam_sessions TO talo_credential_recovery;

-- Audit CREDENTIAL_REISSUED (INSERT without RETURNING).
GRANT INSERT ON iam.iam_audit_logs TO talo_credential_recovery;
COMMIT;
