# P-4e recovery — SECURITY DEFINER proposal (APPROVED WITH CHANGES, review 2 — NOT EXECUTED)

Re-issue of a temporary password without giving `talo_provisioner` any direct UPDATE on IAM. `talo_provisioner` gets
only `EXECUTE` on `iam.reissue_temporary_credential(text, text, uuid)`; the function runs as the NOLOGIN owner
`talo_credential_recovery`. Client: `backend/src/modules/auth/provisioning/reissueTemporaryPassword.ts`
(`npm run provision:account -- --reissue --username <login>`).

| File | Content | Target |
|---|---|---|
| `01-create-owner-role.sql` | NOLOGIN owner role | `postgres` |
| `02-grant-owner-test-database.sql` | column-level grants of the owner; aborts unless the owner starts with no iam privilege | `talo_mos_v4_test` |
| `03-create-function.sql` | function, owner, `REVOKE … FROM PUBLIC`, `GRANT EXECUTE` to `talo_provisioner` | `talo_mos_v4_test` |
| `04-verify.sql` | read-only, self-asserting checks (raises the list of violations) | `talo_mos_v4_test` |
| `90-rollback-test-database.sql` | guarded rollback: revokes exactly the 02 set, drops only the P-4e function, keeps the role | `talo_mos_v4_test` |

## Permission matrix (after 01–03; asserted by 04)

| Object | `talo_provisioner` (caller) | `talo_credential_recovery` (owner, NOLOGIN, NOINHERIT, no members) | others |
|---|---|---|---|
| function | **EXECUTE** (only new privilege) | owner | no EXECUTE (PUBLIC revoked) |
| `iam_user_accounts` | SELECT, INSERT (unchanged) | SELECT (user_account_id, membership_id, username, account_status, disabled_at); UPDATE (account_status) **only for the row lock** | unchanged |
| `iam_memberships` | SELECT, INSERT (unchanged) | SELECT (membership_id, membership_status, left_at) | unchanged |
| `iam_credentials` | INSERT (unchanged), **no UPDATE** | SELECT (user_account_id, updated_at); UPDATE (password_hash, must_change_password, failed_attempt_count, locked_until, updated_at) | unchanged |
| `iam_sessions` | — | SELECT (user_account_id, revoked_at); UPDATE (revoked_at) | unchanged |
| `iam_user_roles`, `iam_user_permissions` | — | SELECT (user_account_id, revoked_at) | — |
| `iam_audit_logs` | INSERT (unchanged) | INSERT | unchanged |

## Identity model (current stage)

The accountable principal is the **controlled service credential** `talo_provisioner` (`session_user`), not a person.
The function claims no human operator: `actor_account_id` is NULL and the audit `ua` reads
`talo-provision-cli; principal=talo_provisioner`. Controls that make the service credential attributable belong outside
SQL and must be in place before use: secret-store check-out per change ticket, rotation after use, `pg_hba` restricted to
the IT host, one active holder at a time. Per-person attribution needs an authenticated IT front end (not in scope).

## Race analysis

- **Account status / membership writers** follow the writer protocol (lock the account row `FOR NO KEY UPDATE`):
  they conflict with the function's `FOR UPDATE`, so either they commit first (the function's post-lock statements see
  the change) or they wait until the re-issue commits.
- **New role / direct-permission / session rows** reference the account through foreign keys; the FK check takes
  `KEY SHARE` on the account row, which conflicts with `FOR UPDATE` (not with `FOR NO KEY UPDATE` — hence the stronger
  lock). An in-flight insert is waited for and then seen; a later one waits until the re-issue commits.
- **Residual:** re-activating an existing role/permission row (`UPDATE … SET revoked_at = NULL`) takes no account lock.
  Privilege writers must also lock the account row (writer protocol extended to privilege changes) — a contract for the
  future authorization module, not enforceable here.
- **Login SUCCESS** of the target holds `FOR NO KEY UPDATE` → serialized with the re-issue; the version bump makes a
  stale SUCCESS fail its CAS (H-b).

## Input rule (same in client and function)

`$argon2id$v=19$m=<19456..1048576>,t=<2..10>,p=<1..16>$<22 base64>$<43 base64>`, at most 128 characters, nothing else.
Username: 1–80 characters after trim, no control characters.

## Risks (for review)

1. Service-credential identity only (see above); misuse of the credential is attributable to the credential, not a person.
2. The caller chooses the hash, so whoever runs recovery knows the temporary password (inherent; limited by forced
   change, session revocation, privileged-account refusal, audit).
3. Refusals roll back and are not audited in the database; the CLI prints requestId and SQLSTATE (no secrets).
4. No rate limit on recovery calls; caller name `talo_provisioner` is hard-coded.
5. Installed and accepted on `talo_mos_v4_test` only (04-verify OK; provisioning integration 10/10 twice, no skip).
   Not applied to dev or production. 90-rollback was not executed.

## Unverified limitations (recorded, not tested — no grant was opened to create test data)

- **Privileged-account refusal:** no approved role can INSERT into `iam_user_roles` / `iam_user_permissions`, so the
  refusal of a target with an active role or direct permission has not been exercised on PostgreSQL.
- **Role-reactivation race:** `UPDATE … SET revoked_at = NULL` on an existing role/permission row takes no account lock;
  the FK `KEY SHARE` coupling was verified only for new rows (simulated with `FOR KEY SHARE`). Closing this needs the
  future authorization module to follow the writer protocol.
- **CLI over TCP:** the end-to-end smoke (`test/integration/auth/provisioning.tcp.test.ts`, `TALO_PROVISIONER_TCP=1`)
  needs `PROVISIONER_DATABASE_URL` from a secure environment; it has not run yet. CLI guards were tested without a database.
