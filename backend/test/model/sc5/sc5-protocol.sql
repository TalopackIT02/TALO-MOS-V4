-- AUTH-SC5-V1 — SQL prototypes of the login concurrency / lockout protocol (recommended H-b).
-- STATUS: DESIGN PROTOTYPES. Never executed. Privileges are verified with EXPLAIN (no ANALYZE) inside READ ONLY
-- transactions on talo_mos_v4_test (see README.md §6): EXPLAIN runs the executor permission check but not the statement.
--
-- Conventions
--   * psql variables stand for application parameters (:'account_id', :'version', …).
--   * All security time comes from PostgreSQL: statement_timestamp() (stable inside one statement, taken AFTER any
--     lock wait of a previous statement in the same transaction). Never the application clock (F2-07b).
--   * Business date for left_at: (statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date.
--   * updated_at is the credential VERSION: every credential write sets
--       updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 microsecond')
--     (strictly increasing per row; writes to one row are serialised by its row lock). It is returned and compared
--     as text (::text → ::timestamptz) because JavaScript Date would truncate microseconds.
--   * Each "@stmt" marker: name, executing role, expected privilege result.

-- ============================== talo_app — login ==============================

-- @stmt RESERVE role=talo_app expect=ALLOW
-- Single autocommit statement = linearization point of an attempt. Grants a slot only when not locked and the cycle
-- budget is not exhausted; restarts the cycle lazily when the lock has expired; slot N sets locked_until immediately.
-- No row returned = rejected (locked) → dummy Argon2 verification, uniform 401.
UPDATE iam.iam_credentials AS c
   SET failed_attempt_count = CASE WHEN c.locked_until IS NOT NULL AND c.locked_until <= statement_timestamp()
                                   THEN 1 ELSE c.failed_attempt_count + 1 END,
       locked_until = CASE
                        WHEN c.locked_until IS NOT NULL AND c.locked_until <= statement_timestamp()
                          THEN CASE WHEN 1 >= :max_attempts THEN statement_timestamp() + :'lock_interval'::interval END
                        WHEN c.failed_attempt_count + 1 >= :max_attempts
                          THEN statement_timestamp() + :'lock_interval'::interval
                        ELSE c.locked_until
                      END,
       updated_at = GREATEST(statement_timestamp(), c.updated_at + interval '1 microsecond')
 WHERE c.user_account_id = :'account_id'::uuid
   AND (c.locked_until IS NULL OR c.locked_until <= statement_timestamp())
   AND (c.failed_attempt_count < :max_attempts OR c.locked_until <= statement_timestamp())
RETURNING c.failed_attempt_count AS slot, c.locked_until::text AS locked_until, c.updated_at::text AS version,
          c.password_hash, statement_timestamp()::text AS reserved_at;

-- (Argon2id verify happens here, outside any transaction and without a database connection.)

-- SUCCESS transaction (READ COMMITTED). Lock order everywhere: account → credential → (sessions).

-- @stmt SUCCESS_LOCK_ACCOUNT role=talo_app expect=ALLOW
SELECT a.user_account_id, a.membership_id, a.account_status, a.disabled_at
  FROM iam.iam_user_accounts AS a
 WHERE a.user_account_id = :'account_id'::uuid
   FOR NO KEY UPDATE;

-- @stmt SUCCESS_LOCK_CREDENTIAL role=talo_app expect=ALLOW
SELECT c.password_hash, c.failed_attempt_count, c.locked_until::text AS locked_until, c.updated_at::text AS version,
       c.must_change_password
  FROM iam.iam_credentials AS c
 WHERE c.user_account_id = :'account_id'::uuid
   FOR NO KEY UPDATE;

-- @stmt SUCCESS_READ_ELIGIBILITY role=talo_app expect=ALLOW
-- New statement after the locks → fresh READ COMMITTED snapshot. Membership is READ, never locked (F2-04);
-- concurrency with membership/account writers is guaranteed by the writer protocol (account-row lock coupling).
SELECT m.membership_status,
       (m.left_at IS NULL OR m.left_at > (statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS before_left_at,
       (c.locked_until IS NOT NULL AND c.locked_until > statement_timestamp()) AS locked_now,
       (statement_timestamp() - :'reserved_at'::timestamptz) <= :'attempt_deadline'::interval AS within_deadline,
       statement_timestamp()::text AS decided_at
  FROM iam.iam_user_accounts AS a
  JOIN iam.iam_memberships AS m ON m.membership_id = a.membership_id
  JOIN iam.iam_credentials AS c ON c.user_account_id = a.user_account_id
 WHERE a.user_account_id = :'account_id'::uuid;

-- @stmt SUCCESS_CAS_RESET role=talo_app expect=ALLOW
-- H-b: reset only the exact state this attempt reserved (no other credential write since). 0 rows = no reset.
UPDATE iam.iam_credentials
   SET failed_attempt_count = 0,
       locked_until = NULL,
       updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 microsecond')
 WHERE user_account_id = :'account_id'::uuid
   AND updated_at = :'version'::timestamptz;

-- @stmt SUCCESS_REVOKE_OTHER_SESSIONS role=talo_app expect=ALLOW
-- Activation login (must_change_password = true): AS-1, revoke every other live session under the account lock.
UPDATE iam.iam_sessions
   SET revoked_at = statement_timestamp()
 WHERE user_account_id = :'account_id'::uuid
   AND revoked_at IS NULL;

-- @stmt SUCCESS_INSERT_SESSION role=talo_app expect=ALLOW
-- Raw INSERT so created_at/expires_at/last_seen_at come from the database (Prisma create would send the app clock).
-- Activation session: interval '15 minutes', assurance 0. Full session: interval '10 hours', assurance 1.
INSERT INTO iam.iam_sessions (user_account_id, session_token_hash, assurance_level_snapshot, created_at, expires_at, last_seen_at)
VALUES (:'account_id'::uuid, :'token_hash', 1, statement_timestamp(), statement_timestamp() + interval '10 hours', statement_timestamp())
RETURNING session_id, expires_at::text;

-- @stmt AUDIT_INSERT role=talo_app expect=ALLOW
-- Append-only: no RETURNING (talo_app has no SELECT on iam_audit_logs). Same transaction as the state change.
INSERT INTO iam.iam_audit_logs (actor_account_id, membership_id, session_id, action_code, target_type, target_id, outcome, occurred_at, metadata)
VALUES (NULL, NULL, NULL, 'LOGIN', 'USER_ACCOUNT', :'account_id'::uuid, 'FAILURE', statement_timestamp(), '{"v":1,"reason":"BAD_PASSWORD","slot":3}'::jsonb);

-- ============================== talo_app — session use ==============================

-- @stmt VALIDATE_SESSION role=talo_app expect=ALLOW
-- Every request: one read, all decisions on database time. Linearization point of an authenticated request.
SELECT s.session_id, s.user_account_id,
       (s.revoked_at IS NULL) AS not_revoked,
       (s.expires_at > statement_timestamp()) AS not_expired,
       (s.last_seen_at > statement_timestamp() - interval '60 minutes') AS not_idle,
       a.account_status, (a.disabled_at IS NULL) AS not_disabled,
       c.must_change_password,
       m.membership_status,
       (m.left_at IS NULL OR m.left_at > (statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS before_left_at,
       (SELECT count(*) FROM iam.iam_sessions AS s2
         WHERE s2.user_account_id = s.user_account_id AND s2.revoked_at IS NULL AND s2.expires_at > statement_timestamp()) AS live_sessions
  FROM iam.iam_sessions AS s
  JOIN iam.iam_user_accounts AS a ON a.user_account_id = s.user_account_id
  JOIN iam.iam_credentials AS c ON c.user_account_id = s.user_account_id
  JOIN iam.iam_memberships AS m ON m.membership_id = a.membership_id
 WHERE s.session_token_hash = :'token_hash';

-- @stmt TOUCH_SESSION role=talo_app expect=ALLOW
-- Idle tracking, at most once per minute; never revives a revoked session.
UPDATE iam.iam_sessions
   SET last_seen_at = statement_timestamp()
 WHERE session_id = :'session_id'::uuid
   AND revoked_at IS NULL
   AND last_seen_at <= statement_timestamp() - interval '1 minute';

-- @stmt LOGOUT role=talo_app expect=ALLOW
UPDATE iam.iam_sessions
   SET revoked_at = statement_timestamp()
 WHERE session_token_hash = :'token_hash'
   AND revoked_at IS NULL;

-- ============================== talo_app — first-time password change ==============================
-- Same transaction and lock order as SUCCESS: SUCCESS_LOCK_ACCOUNT, SUCCESS_LOCK_CREDENTIAL, then:

-- @stmt FIRST_CHANGE_CREDENTIAL role=talo_app expect=ALLOW
UPDATE iam.iam_credentials
   SET password_hash = :'new_hash',
       password_changed_at = statement_timestamp(),
       must_change_password = false,
       failed_attempt_count = 0,
       locked_until = NULL,
       updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 microsecond')
 WHERE user_account_id = :'account_id'::uuid
   AND must_change_password = true;

-- @stmt FIRST_CHANGE_ACTIVATE role=talo_app expect=ALLOW
UPDATE iam.iam_user_accounts
   SET account_status = 'ACTIVE',
       activated_at = statement_timestamp()
 WHERE user_account_id = :'account_id'::uuid
   AND account_status = 'PROVISIONED';

-- (then SUCCESS_REVOKE_OTHER_SESSIONS revokes every session of the account, and AUDIT_INSERT)

-- ============================== H-a alternative (cycle anchor) ==============================

-- @stmt HA_RESERVE role=talo_app expect=ALLOW
-- updated_at changes only when a cycle starts (repurposes the column: it no longer means "last update").
UPDATE iam.iam_credentials AS c
   SET failed_attempt_count = CASE WHEN c.locked_until IS NOT NULL AND c.locked_until <= statement_timestamp()
                                   THEN 1 ELSE c.failed_attempt_count + 1 END,
       locked_until = CASE
                        WHEN c.locked_until IS NOT NULL AND c.locked_until <= statement_timestamp() THEN NULL
                        WHEN c.failed_attempt_count + 1 >= :max_attempts THEN statement_timestamp() + :'lock_interval'::interval
                        ELSE c.locked_until
                      END,
       updated_at = CASE WHEN c.locked_until IS NOT NULL AND c.locked_until <= statement_timestamp()
                         THEN GREATEST(statement_timestamp(), c.updated_at + interval '1 microsecond')
                         ELSE c.updated_at END
 WHERE c.user_account_id = :'account_id'::uuid
   AND (c.locked_until IS NULL OR c.locked_until <= statement_timestamp())
   AND (c.failed_attempt_count < :max_attempts OR c.locked_until <= statement_timestamp())
RETURNING c.failed_attempt_count AS slot, c.updated_at::text AS cycle_anchor, c.password_hash;

-- ============================== must be DENIED for talo_app ==============================

-- @stmt DENY_LOCK_MEMBERSHIP_UPDATE role=talo_app expect=DENY
SELECT 1 FROM iam.iam_memberships WHERE membership_id = :'membership_id'::uuid FOR UPDATE;

-- @stmt DENY_LOCK_MEMBERSHIP_KEY_SHARE role=talo_app expect=DENY
SELECT 1 FROM iam.iam_memberships WHERE membership_id = :'membership_id'::uuid FOR KEY SHARE;

-- @stmt DENY_AUDIT_RETURNING role=talo_app expect=DENY
INSERT INTO iam.iam_audit_logs (action_code, target_type, outcome) VALUES ('LOGIN', 'USER_ACCOUNT', 'FAILURE') RETURNING audit_id;

-- @stmt DENY_ACCOUNT_DISABLE role=talo_app expect=DENY
UPDATE iam.iam_user_accounts SET disabled_at = statement_timestamp() WHERE user_account_id = :'account_id'::uuid;

-- @stmt DENY_WRITER_MEMBERSHIP_EXIT role=talo_app expect=DENY
UPDATE iam.iam_memberships SET membership_status = 'EXITED' WHERE membership_id = :'membership_id'::uuid;

-- ============================== privileged writer protocol (future, not talo_app) ==============================
-- Any change that can make an account ineligible (membership EXITED / left_at, account LOCKED / DISABLED) must, in ONE
-- transaction: lock the affected account rows FOR NO KEY UPDATE (ordered by user_account_id), write, revoke the
-- sessions, audit. This lock couples with SUCCESS_LOCK_ACCOUNT, which is what makes AD-3 hold without talo_app ever
-- locking the membership row.

-- @stmt WRITER_LOCK_ACCOUNTS role=admin expect=ALLOW
SELECT a.user_account_id FROM iam.iam_user_accounts AS a
 WHERE a.membership_id = :'membership_id'::uuid
 ORDER BY a.user_account_id
   FOR NO KEY UPDATE;

-- @stmt WRITER_EXIT_MEMBERSHIP role=admin expect=ALLOW
UPDATE iam.iam_memberships
   SET membership_status = 'EXITED',
       left_at = (statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
 WHERE membership_id = :'membership_id'::uuid;

-- @stmt WRITER_REVOKE_SESSIONS role=admin expect=ALLOW
UPDATE iam.iam_sessions
   SET revoked_at = statement_timestamp()
 WHERE revoked_at IS NULL
   AND user_account_id IN (SELECT a.user_account_id FROM iam.iam_user_accounts AS a WHERE a.membership_id = :'membership_id'::uuid);
