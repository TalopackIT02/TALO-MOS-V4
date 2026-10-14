-- TALO-MOS-V4 · Foundation F1 · 04 — least-privilege grants on the TEST database
-- STATUS: PREPARED, NOT EXECUTED. Requires a separate execution approval.
-- TARGET: database talo_mos_v4_test only (after 01, 02 + IAM v0.3 baseline, and 03).
-- Derived from the approved Phase B0 Security Contract (SC-8). Items marked PENDING VALIDATION must be
-- proven by 05/06 and by running the backend integration tests as talo_app before reuse on any other database.
-- Does not change the IAM v0.3 schema. Contains no DROP/TRUNCATE.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'Abort: grants are prepared for talo_mos_v4_test only (connected to "%")', current_database();
  END IF;
  IF (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'iam') <> 11 THEN
    RAISE EXCEPTION 'Abort: schema iam must contain the 11 IAM v0.3 tables';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('talo_app', 'talo_provisioner') AND NOT rolsuper) <> 2 THEN
    RAISE EXCEPTION 'Abort: roles talo_app and talo_provisioner must exist and must not be superusers';
  END IF;
END
$$;

BEGIN;

-- Database: only the two application roles may connect; no TEMP for anyone else.
REVOKE ALL ON DATABASE talo_mos_v4_test FROM PUBLIC;
GRANT CONNECT ON DATABASE talo_mos_v4_test TO talo_app, talo_provisioner;

-- Schemas: nothing in "public" for PUBLIC; read access path to "iam" only.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA iam TO talo_app, talo_provisioner;

-- ---------------------------------------------------------------------------------------------
-- talo_app — backend runtime (login, session, first-time password change, audit insert)
-- No DELETE, TRUNCATE, DDL or TEMP anywhere. IAM v0.3 uses UUID keys: no sequences to grant.
-- ---------------------------------------------------------------------------------------------
-- Membership eligibility (AD-3). SELECT only: talo_app cannot lock membership rows (FOR UPDATE/SHARE need an
-- UPDATE privilege). Intentional — the SC-5 SUCCESS transaction re-reads the membership instead (finding F2-04).
GRANT SELECT ON iam.iam_memberships TO talo_app;

-- Account lookup; activation PROVISIONED -> ACTIVE (AD-1/AD-2)
GRANT SELECT ON iam.iam_user_accounts TO talo_app;
GRANT UPDATE (account_status, activated_at) ON iam.iam_user_accounts TO talo_app;

-- Credential verify, lockout reservation (SC-5, PENDING VALIDATION), password change.
-- Column UPDATE privilege also satisfies SELECT ... FOR UPDATE; SELECT covers RETURNING and WHERE/SET reads.
GRANT SELECT ON iam.iam_credentials TO talo_app;
GRANT UPDATE (password_hash, password_changed_at, must_change_password, failed_attempt_count, locked_until, updated_at)
  ON iam.iam_credentials TO talo_app;

-- Sessions: create, validate, revoke, idle tracking
GRANT SELECT, INSERT ON iam.iam_sessions TO talo_app;
GRANT UPDATE (revoked_at, last_seen_at) ON iam.iam_sessions TO talo_app;

-- Audit: append-only. Inserts must not use RETURNING (no SELECT is granted). Statically verified in F2:
-- Prisma createMany emits INSERT without RETURNING; Prisma create emits RETURNING and would be denied.
GRANT INSERT ON iam.iam_audit_logs TO talo_app;

-- Not granted in Phase B: iam_roles, iam_permissions, iam_role_permissions, iam_user_roles,
-- iam_user_permissions, iam_account_verifications (authorization / email verification are out of scope).

-- ---------------------------------------------------------------------------------------------
-- talo_provisioner — IT account provisioning (membership + PROVISIONED account + credential + audit)
-- PENDING VALIDATION: exact needs depend on the provisioning tool, which is not implemented yet.
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT ON iam.iam_memberships TO talo_provisioner;
GRANT SELECT, INSERT ON iam.iam_user_accounts TO talo_provisioner;
GRANT INSERT ON iam.iam_credentials TO talo_provisioner;
GRANT INSERT ON iam.iam_audit_logs TO talo_provisioner;

COMMIT;

-- Post-check: effective table and column grants for the two roles
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'iam' AND grantee IN ('talo_app', 'talo_provisioner')
ORDER BY grantee, table_name, privilege_type;

SELECT grantee, table_name, column_name, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'iam' AND grantee IN ('talo_app', 'talo_provisioner') AND privilege_type = 'UPDATE'
ORDER BY grantee, table_name, column_name;
