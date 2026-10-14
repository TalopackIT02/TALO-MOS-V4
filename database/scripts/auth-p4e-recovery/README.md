# P-4e recovery — SECURITY DEFINER proposal (REVIEW ONLY, NOT EXECUTED)

Re-issue of a temporary password without giving `talo_provisioner` any direct UPDATE on IAM. `talo_provisioner` gets
only `EXECUTE` on `iam.reissue_temporary_credential`; the function runs as the NOLOGIN owner `talo_credential_recovery`.
Client code: `backend/src/modules/auth/provisioning/reissueTemporaryPassword.ts` (CLI `--reissue`).

| File | Content | Target |
|---|---|---|
| `01-create-owner-role.sql` | NOLOGIN owner role | `postgres` |
| `02-grant-owner-test-database.sql` | column-level grants of the owner | `talo_mos_v4_test` |
| `03-create-function.sql` | function, owner, `REVOKE … FROM PUBLIC`, `GRANT EXECUTE` to `talo_provisioner` | `talo_mos_v4_test` |
| `04-verify.sql` | read-only checks (expected values inline) | `talo_mos_v4_test` |
| `90-rollback-test-database.sql` | drop function, revoke owner grants | `talo_mos_v4_test` |

## Permission matrix (after 01–03)

| Object | `talo_provisioner` (caller) | `talo_credential_recovery` (owner, NOLOGIN) | `talo_app` |
|---|---|---|---|
| function `iam.reissue_temporary_credential` | **EXECUTE** (only new privilege) | owner | — |
| `iam_user_accounts` | SELECT, INSERT (unchanged) | SELECT (user_account_id, membership_id, username, account_status, disabled_at); UPDATE (account_status) **only for the row lock** | unchanged |
| `iam_memberships` | SELECT, INSERT (unchanged) | SELECT (membership_id, membership_status, left_at) | unchanged |
| `iam_credentials` | INSERT (unchanged), **no UPDATE** | SELECT (user_account_id, updated_at); UPDATE (password_hash, must_change_password, failed_attempt_count, locked_until, updated_at) | unchanged |
| `iam_sessions` | — | SELECT (user_account_id, revoked_at); UPDATE (revoked_at) | unchanged |
| `iam_user_roles`, `iam_user_permissions` | — | SELECT (user_account_id, revoked_at) | — |
| `iam_audit_logs` | INSERT (unchanged) | INSERT | unchanged |

## Controls

- `SECURITY DEFINER` + `SET search_path = pg_catalog, pg_temp` (temp schema last) + every object schema-qualified;
  `REVOKE ALL … FROM PUBLIC` in the same transaction as `CREATE`; `SET lock_timeout = '5s'`.
- Caller: `session_user` must be `talo_provisioner`. Input: Argon2id PHC string only (the database never sees plaintext).
- Operator: `p_operator_account_id` must be an ACTIVE, eligible account ≠ target; stored as `actor_account_id`.
- Target: locked `FOR NO KEY UPDATE` first (writer protocol), then re-checked: PROVISIONED/ACTIVE, not disabled,
  membership ACTIVE/ON_LEAVE and `left_at` after today; accounts with an active role or direct permission are refused.
- Atomic: credential replaced (version bump), all sessions revoked, audit `CREDENTIAL_REISSUED` — one call, all or nothing.
- Audit metadata `{v, reason, requestId, ip, ua}`: no hash, no plaintext.

## Risks (for review)

1. **Operator identity is asserted, not authenticated by the database.** Anyone holding `talo_provisioner` credentials can
   name any eligible ACTIVE account as operator. Mitigation outside SQL: per-person provisioning credentials or an
   authenticated IT front end; until then the audit trail proves the DB role and claimed operator only.
2. **Account takeover capability by design.** The caller chooses the new hash, so whoever runs recovery knows the
   temporary password. Limited by: forced change at next login, all sessions revoked, privileged accounts refused, audit.
3. **Refusals are not audited in the database** (a raised error rolls the call back). The CLI must log a structured
   line (requestId, reason code — no secrets) for failed attempts.
4. **No rate limit** on recovery calls per operator (not in this proposal).
5. Hard-coded caller name `talo_provisioner`; renaming the role requires replacing the function.
6. **Not executed:** syntax and privileges of the function were not validated on PostgreSQL (no DDL allowed). The SQL
   statements it contains were validated earlier as plain statements (see provisioning.db.test.ts).
