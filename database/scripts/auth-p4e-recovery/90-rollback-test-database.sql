-- TALO-MOS-V4 · P-4e recovery · 90 — rollback of 02/03 on the test database (function + owner grants only).
-- STATUS: APPROVED WITH CHANGES (review 2) — NOT EXECUTED.
-- Revokes EXACTLY the privileges granted by 02 (no REVOKE ALL), so nothing that existed before is removed. 02 refuses
-- to run unless the owner starts without any iam privilege, which makes "exactly 02" equal to "everything the owner has".
-- Aborts — touching nothing — when the function is not the one from 03, or when the owner has privileges, objects or
-- memberships outside this proposal. The NOLOGIN role from 01 is NOT dropped here (manual decision).

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_owner oid := (SELECT oid FROM pg_roles WHERE rolname = 'talo_credential_recovery');
  v_fn    regprocedure := to_regprocedure('iam.reissue_temporary_credential(text,text,uuid)');
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'Abort: run on talo_mos_v4_test (currently "%")', current_database();
  END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Abort: talo_credential_recovery does not exist; nothing to roll back';
  END IF;
  IF v_fn IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn AND proowner = v_owner AND prosecdef) THEN
    RAISE EXCEPTION 'Abort: iam.reissue_temporary_credential exists but is not the P-4e function (owner/SECURITY DEFINER differ)';
  END IF;
  -- Owner must hold nothing beyond the 02 set (table level) and own nothing but this function.
  IF EXISTS (
      SELECT 1 FROM pg_class c CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
       WHERE c.relnamespace = 'iam'::regnamespace AND c.relkind = 'r'
         AND CASE WHEN p.priv IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') THEN has_any_column_privilege(v_owner, c.oid, p.priv)
                  ELSE has_table_privilege(v_owner, c.oid, p.priv) END
         AND (c.relname::text, p.priv) NOT IN (
               ('iam_user_accounts', 'SELECT'), ('iam_user_accounts', 'UPDATE'), ('iam_memberships', 'SELECT'),
               ('iam_user_roles', 'SELECT'), ('iam_user_permissions', 'SELECT'), ('iam_credentials', 'SELECT'),
               ('iam_credentials', 'UPDATE'), ('iam_sessions', 'SELECT'), ('iam_sessions', 'UPDATE'), ('iam_audit_logs', 'INSERT')))
     OR (SELECT count(*) FROM pg_proc WHERE proowner = v_owner) > CASE WHEN v_fn IS NULL THEN 0 ELSE 1 END
     OR EXISTS (SELECT 1 FROM pg_class WHERE relowner = v_owner)
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = v_owner OR roleid = v_owner) THEN
    RAISE EXCEPTION 'Abort: talo_credential_recovery has privileges, objects or memberships outside the P-4e proposal; review manually';
  END IF;
END
$$;

BEGIN;
DROP FUNCTION IF EXISTS iam.reissue_temporary_credential(text, text, uuid);   -- removes its EXECUTE grant with it

-- Mirror of 02, statement by statement.
REVOKE INSERT ON iam.iam_audit_logs FROM talo_credential_recovery;
REVOKE UPDATE (revoked_at) ON iam.iam_sessions FROM talo_credential_recovery;
REVOKE SELECT (user_account_id, revoked_at) ON iam.iam_sessions FROM talo_credential_recovery;
REVOKE UPDATE (password_hash, must_change_password, failed_attempt_count, locked_until, updated_at) ON iam.iam_credentials FROM talo_credential_recovery;
REVOKE SELECT (user_account_id, updated_at) ON iam.iam_credentials FROM talo_credential_recovery;
REVOKE SELECT (user_account_id, revoked_at) ON iam.iam_user_permissions FROM talo_credential_recovery;
REVOKE SELECT (user_account_id, revoked_at) ON iam.iam_user_roles FROM talo_credential_recovery;
REVOKE SELECT (membership_id, membership_status, left_at) ON iam.iam_memberships FROM talo_credential_recovery;
REVOKE UPDATE (account_status) ON iam.iam_user_accounts FROM talo_credential_recovery;
REVOKE SELECT (user_account_id, membership_id, username, account_status, disabled_at) ON iam.iam_user_accounts FROM talo_credential_recovery;
REVOKE USAGE ON SCHEMA iam FROM talo_credential_recovery;

-- Post-check inside the transaction: owner left with nothing in iam; talo_provisioner unchanged (F2 baseline).
DO $$
BEGIN
  IF has_schema_privilege('talo_credential_recovery', 'iam', 'USAGE') OR EXISTS (
       SELECT 1 FROM pg_class c WHERE c.relnamespace = 'iam'::regnamespace AND c.relkind = 'r'
          AND (has_any_column_privilege('talo_credential_recovery', c.oid, 'SELECT')
               OR has_any_column_privilege('talo_credential_recovery', c.oid, 'INSERT')
               OR has_any_column_privilege('talo_credential_recovery', c.oid, 'UPDATE'))) THEN
    RAISE EXCEPTION 'Rollback post-check failed: owner still holds iam privileges';
  END IF;
  IF NOT (has_table_privilege('talo_provisioner', 'iam.iam_memberships', 'SELECT')
          AND has_table_privilege('talo_provisioner', 'iam.iam_memberships', 'INSERT')
          AND has_table_privilege('talo_provisioner', 'iam.iam_user_accounts', 'SELECT')
          AND has_table_privilege('talo_provisioner', 'iam.iam_user_accounts', 'INSERT')
          AND has_table_privilege('talo_provisioner', 'iam.iam_credentials', 'INSERT')
          AND has_table_privilege('talo_provisioner', 'iam.iam_audit_logs', 'INSERT')) THEN
    RAISE EXCEPTION 'Rollback post-check failed: talo_provisioner baseline privileges changed';
  END IF;
END
$$;
COMMIT;
