-- TALO-MOS-V4 · P-4e recovery · 03 — SECURITY DEFINER function + EXECUTE for talo_provisioner (test database)
-- STATUS: PROPOSAL FOR REVIEW — NOT EXECUTED. Run only after explicit approval.
-- TARGET: talo_mos_v4_test, as admin (superuser: required to hand ownership to the NOLOGIN owner role).
--
-- Re-issues a temporary password after loss or suspected exposure, atomically and following the writer protocol:
--   1. caller must be talo_provisioner (session_user); inputs validated (Argon2id PHC hash only — never plaintext)
--   2. operator = an ACTIVE, eligible account (recorded as actor_account_id); operator ≠ target
--   3. target account row locked FOR NO KEY UPDATE (couples with the login SUCCESS transaction), then re-checked:
--      PROVISIONED/ACTIVE, not disabled, membership ACTIVE/ON_LEAVE with left_at after today (Asia/Ho_Chi_Minh),
--      no active role / direct permission (privileged accounts are out of scope for IT tooling)
--   4. credential replaced: new hash, must_change_password = true, counter/lock cleared, version bumped
--   5. every live session revoked; 6. audit CREDENTIAL_REISSUED (no hash, no plaintext); 7. returns id + revoked count
-- Any refusal raises (custom SQLSTATE class TA) and the whole call rolls back.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'Abort: run on talo_mos_v4_test (currently "%")', current_database();
  END IF;
  IF to_regprocedure('iam.reissue_temporary_credential(text,text,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Abort: iam.reissue_temporary_credential already exists';
  END IF;
END
$$;

BEGIN;

CREATE FUNCTION iam.reissue_temporary_credential(
    p_username            text,
    p_password_hash       text,
    p_operator_account_id uuid,
    p_request_id          uuid)
RETURNS TABLE (reissued_account_id uuid, revoked_sessions integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_today           date := (pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_target_id       uuid;
  v_target_member   uuid;
  v_target_status   text;
  v_target_disabled boolean;
  v_member_status   text;
  v_member_left     date;
  v_rows            integer;
  v_revoked         integer;
BEGIN
  -- 1. caller and inputs
  IF session_user <> 'talo_provisioner' THEN
    RAISE EXCEPTION USING ERRCODE = 'TA403', MESSAGE = 'reissue: caller not allowed';
  END IF;
  IF p_username IS NULL OR pg_catalog.length(pg_catalog.btrim(p_username)) NOT BETWEEN 1 AND 80
     OR p_operator_account_id IS NULL OR p_request_id IS NULL OR p_password_hash IS NULL
     OR p_password_hash !~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]{11,}\$[A-Za-z0-9+/]{16,}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'TA422', MESSAGE = 'reissue: invalid input';
  END IF;

  -- 2. operator identity (recorded as actor; must be an eligible ACTIVE account)
  IF NOT EXISTS (
      SELECT 1
        FROM iam.iam_user_accounts AS a
        JOIN iam.iam_memberships AS m ON m.membership_id = a.membership_id
       WHERE a.user_account_id = p_operator_account_id
         AND a.account_status = 'ACTIVE' AND a.disabled_at IS NULL
         AND m.membership_status IN ('ACTIVE', 'ON_LEAVE')
         AND (m.left_at IS NULL OR m.left_at > v_today)) THEN
    RAISE EXCEPTION USING ERRCODE = 'TA401', MESSAGE = 'reissue: operator account not eligible';
  END IF;

  -- 3. writer protocol: lock the target account row first
  SELECT a.user_account_id, a.membership_id, a.account_status, (a.disabled_at IS NOT NULL)
    INTO v_target_id, v_target_member, v_target_status, v_target_disabled
    FROM iam.iam_user_accounts AS a
   WHERE pg_catalog.lower(a.username) = pg_catalog.lower(pg_catalog.btrim(p_username))
     FOR NO KEY UPDATE OF a;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'TA404', MESSAGE = 'reissue: account not found';
  END IF;
  IF v_target_id = p_operator_account_id THEN
    RAISE EXCEPTION USING ERRCODE = 'TA403', MESSAGE = 'reissue: self-recovery not allowed';
  END IF;
  IF v_target_disabled OR v_target_status NOT IN ('PROVISIONED', 'ACTIVE') THEN
    RAISE EXCEPTION USING ERRCODE = 'TA409', MESSAGE = 'reissue: account disabled or locked';
  END IF;
  SELECT m.membership_status, m.left_at INTO v_member_status, v_member_left
    FROM iam.iam_memberships AS m WHERE m.membership_id = v_target_member;
  IF v_member_status IS NULL OR v_member_status NOT IN ('ACTIVE', 'ON_LEAVE')
     OR (v_member_left IS NOT NULL AND v_member_left <= v_today) THEN
    RAISE EXCEPTION USING ERRCODE = 'TA409', MESSAGE = 'reissue: membership not eligible';
  END IF;
  IF EXISTS (SELECT 1 FROM iam.iam_user_roles AS r WHERE r.user_account_id = v_target_id AND r.revoked_at IS NULL)
     OR EXISTS (SELECT 1 FROM iam.iam_user_permissions AS p WHERE p.user_account_id = v_target_id AND p.revoked_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'TA403', MESSAGE = 'reissue: privileged account, use the administrator procedure';
  END IF;

  -- 4. replace the credential (credential version rule: bump updated_at)
  UPDATE iam.iam_credentials AS c
     SET password_hash = p_password_hash, must_change_password = true, failed_attempt_count = 0, locked_until = NULL,
         updated_at = GREATEST(pg_catalog.statement_timestamp(), c.updated_at + interval '1 microsecond')
   WHERE c.user_account_id = v_target_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'TA409', MESSAGE = 'reissue: account has no credential';
  END IF;

  -- 5. revoke every live session of the target
  UPDATE iam.iam_sessions AS s SET revoked_at = pg_catalog.statement_timestamp()
   WHERE s.user_account_id = v_target_id AND s.revoked_at IS NULL;
  GET DIAGNOSTICS v_revoked = ROW_COUNT;

  -- 6. audit (closed metadata keys; never the hash or the temporary password)
  INSERT INTO iam.iam_audit_logs (actor_account_id, membership_id, session_id, action_code, target_type, target_id,
                                  outcome, occurred_at, metadata)
  VALUES (p_operator_account_id, v_target_member, NULL, 'CREDENTIAL_REISSUED', 'USER_ACCOUNT', v_target_id,
          'SUCCESS', pg_catalog.statement_timestamp(),
          pg_catalog.jsonb_build_object('v', 1, 'reason', 'OK', 'requestId', p_request_id::text,
                                        'ip', pg_catalog.host(pg_catalog.inet_client_addr()), 'ua', 'talo-provision-cli'));

  reissued_account_id := v_target_id;
  revoked_sessions := v_revoked;
  RETURN NEXT;
END
$fn$;

ALTER FUNCTION iam.reissue_temporary_credential(text, text, uuid, uuid) OWNER TO talo_credential_recovery;
REVOKE ALL ON FUNCTION iam.reissue_temporary_credential(text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iam.reissue_temporary_credential(text, text, uuid, uuid) TO talo_provisioner;
COMMENT ON FUNCTION iam.reissue_temporary_credential(text, text, uuid, uuid) IS
  'TALO-MOS P-4e: re-issue a temporary password (writer protocol, sessions revoked, audited). EXECUTE: talo_provisioner only.';

COMMIT;
