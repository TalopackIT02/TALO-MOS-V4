# SC5 test harness role — `talo_test_harness`

Approved in AUTH-SC5-V1 (user authorization §4). Used **only** by the SC5 integration tests on `talo_mos_v4_test`
to create synthetic `SC5T-` fixtures, simulate eligibility writers (writer protocol) and clean up. It is never an
authentication actor: every authentication statement in the tests runs as `talo_app`.

## Connection model

`talo_test_harness` has **no password**. From the Windows host every TCP connection uses `scram-sha-256`, so the
role cannot log in from outside the container at all. The tests reach it only through
`docker exec talo-mos-v4-postgres psql -U talo_test_harness -d talo_mos_v4_test` (unix socket, `trust` in the
local development container — F2-06). Nothing secret is stored anywhere.

## Privilege matrix (derived from the operations the tests perform)

| Table | Privilege | Needed for | Columns |
|---|---|---|---|
| `iam_memberships` | SELECT | fixture checks, ownership proof (`employee_code LIKE 'SC5T-%'`), assertions | all |
| | INSERT | fixtures | all (table level) |
| | UPDATE (columns) | writer simulation: EXITED, `left_at` | `membership_status`, `left_at` |
| | DELETE | scoped cleanup by fixture UUID | — |
| `iam_user_accounts` | SELECT | assertions; `FOR NO KEY UPDATE` writer lock (needs ≥1 UPDATE column) | all |
| | INSERT | fixtures | all |
| | UPDATE (columns) | writer simulation: LOCKED / DISABLED | `account_status`, `disabled_at` |
| | DELETE | cleanup | — |
| `iam_credentials` | SELECT | assertions (counter, lock, version) | all |
| | INSERT | fixtures | all |
| | UPDATE (columns) | simulate lock expiry and a password change (both bump `updated_at` per the version rule) | `locked_until`, `password_hash`, `updated_at` |
| | DELETE | cleanup | — |
| `iam_sessions` | SELECT | assertions (live sessions, AS-1) | all |
| | UPDATE (column) | writer simulation: revoke sessions | `revoked_at` |
| | DELETE | cleanup | — |
| `iam_audit_logs` | SELECT | assertions; ownership proof (`metadata->>'run'`) | all |
| | DELETE | cleanup (audit rows reference sessions/accounts/memberships) | — |
| roles, permissions, role_permissions, user_roles, user_permissions, account_verifications | none | not used | — |

Database `talo_mos_v4_test`: CONNECT only (no TEMP). Schema `iam`: USAGE only (no CREATE). Schema `public`: nothing.
Role attributes: LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, NOINHERIT, CONNECTION LIMIT 5.

Why no more:
- **No DDL**: fixtures are rows only; no CREATE on any schema, no TRUNCATE (cleanup deletes by UUID).
- **No INSERT on sessions/audit**: sessions and audit rows are produced by `talo_app` (the protocol under test).
- **Foreign keys**: RI checks and `ON DELETE RESTRICT` checks run with the table owner's rights, so no privileges
  on referenced tables are needed beyond the ones above. Cleanup order: audit → sessions → credentials → accounts →
  memberships.
- **No development database privileges**: nothing is granted outside `talo_mos_v4_test`. (PostgreSQL's PUBLIC
  defaults still allow CONNECT/TEMP on `postgres` and `talo_mos_v4_dev` for every role — finding F2-05, deferred.)

## Files

| File | Connect to | As | Effect |
|---|---|---|---|
| `01-create-role.sql` | `postgres` | admin | creates `talo_test_harness` (no password) |
| `02-grant-test-database.sql` | `talo_mos_v4_test` | admin | grants exactly the matrix above |
| `03-verify-harness-privileges.sql` | `talo_mos_v4_test` | talo_test_harness | negative/positive checks, rolled back |

Same conventions as `foundation-f1`: `ON_ERROR_STOP`, guard first, one transaction per change set, no DROP/TRUNCATE.
Lifecycle: the role is kept for later verifications (no DROP ROLE unless requested). To remove it later:
`DROP OWNED BY talo_test_harness` in `talo_mos_v4_test`, then `DROP ROLE talo_test_harness` on `postgres`.
