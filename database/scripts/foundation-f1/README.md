# Foundation F1 — test database & least-privilege roles

**Status: PREPARED, NOT EXECUTED.** Nothing in this folder has been run. Creating the database, creating roles,
applying grants or running any of these files requires a **separate execution approval**.

Scope: an isolated database `talo_mos_v4_test` with the unchanged IAM v0.3 schema, and two login roles:

| Role | Purpose | Never |
|---|---|---|
| `talo_app` | Backend runtime (login, session, first-time password change, audit insert) | superuser, DDL, DELETE/TRUNCATE, TEMP |
| `talo_provisioner` | IT provisioning tool (membership + PROVISIONED account + credential + audit) | superuser, UPDATE/DELETE, sessions |

The backend runtime must never use `admin` (the Docker bootstrap superuser).

## Files and order

| # | File | Connect to | As | Changes |
|---|---|---|---|---|
| 1 | `01-create-test-database.sql` | `postgres` | role with CREATEDB | creates `talo_mos_v4_test` (UTF8, en_US.utf8, libc — same as dev) |
| 2 | `02-guard-before-iam-baseline.sql` **+** `database/sql/TALO-MOS-IAM-Security-PostgreSQL-v0.3.sql` | `talo_mos_v4_test` | owner/admin | guard, then the **unchanged** IAM v0.3 baseline (in one psql run) |
| 3 | `03-create-roles.sql` | `postgres` | role with CREATEROLE | creates `talo_app`, `talo_provisioner` (no password) |
| 3b | `\password talo_app`, `\password talo_provisioner` (interactive psql) | any | admin | sets passwords as SCRAM hashes; never stored in files |
| 4 | `04-grant-test-database.sql` | `talo_mos_v4_test` | owner/admin | REVOKE PUBLIC on the test DB; grants per Security Contract SC-8 |
| 5 | `05-verify-least-privilege-app.sql` | `talo_mos_v4_test` | **talo_app** | none (transaction rolled back) |
| 6 | `06-verify-least-privilege-provisioner.sql` | `talo_mos_v4_test` | **talo_provisioner** | none (transaction rolled back) |
| R1 | `90-rollback-test-database.sql` | `postgres` | admin | drops `talo_mos_v4_test` only |
| R2 | `91-rollback-roles.sql` | `postgres` | admin | drops the two roles (after R1, or after `DROP OWNED` in the test DB) |

Every file starts with `\set ON_ERROR_STOP on` and a guard (`DO $$ … RAISE EXCEPTION …`) that checks the connected
database, the current role and pre-existing objects, so running a file against the wrong target aborts before any
change. `talo_mos_v4_dev` is never a target.

## Example commands (for the approved execution step — do not run before approval)

Copy the files into the container and run them with `psql -f`. Do **not** pipe files from Windows PowerShell 5.1
(`Get-Content … | docker exec -i …`): it re-encodes piped text as ASCII and would corrupt the Vietnamese
`COMMENT ON …` text of the IAM baseline. `docker cp` keeps the bytes unchanged and works the same in PowerShell and bash.

```text
# copy (repository root)
docker exec talo-mos-v4-postgres mkdir -p /tmp/f1
docker cp database/scripts/foundation-f1/. talo-mos-v4-postgres:/tmp/f1/
docker cp database/sql/TALO-MOS-IAM-Security-PostgreSQL-v0.3.sql talo-mos-v4-postgres:/tmp/f1/iam-v0.3.sql

# 1. test database
docker exec talo-mos-v4-postgres psql -U admin -d postgres -v ON_ERROR_STOP=1 -f /tmp/f1/01-create-test-database.sql

# 2. guard + unchanged IAM v0.3 baseline in ONE psql session (the guard stops the baseline on the wrong target)
docker exec talo-mos-v4-postgres psql -U admin -d talo_mos_v4_test -v ON_ERROR_STOP=1 -f /tmp/f1/02-guard-before-iam-baseline.sql -f /tmp/f1/iam-v0.3.sql

# 3. roles, then set passwords interactively
docker exec talo-mos-v4-postgres psql -U admin -d postgres -v ON_ERROR_STOP=1 -f /tmp/f1/03-create-roles.sql
docker exec -it talo-mos-v4-postgres psql -U admin -d postgres -c "\password talo_app"
docker exec -it talo-mos-v4-postgres psql -U admin -d postgres -c "\password talo_provisioner"

# 4. grants
docker exec talo-mos-v4-postgres psql -U admin -d talo_mos_v4_test -v ON_ERROR_STOP=1 -f /tmp/f1/04-grant-test-database.sql

# 5/6. verification as the restricted roles (password prompted interactively)
docker exec -it talo-mos-v4-postgres psql -h 127.0.0.1 -U talo_app -d talo_mos_v4_test -v ON_ERROR_STOP=1 -f /tmp/f1/05-verify-least-privilege-app.sql
docker exec -it talo-mos-v4-postgres psql -h 127.0.0.1 -U talo_provisioner -d talo_mos_v4_test -v ON_ERROR_STOP=1 -f /tmp/f1/06-verify-least-privilege-provisioner.sql

# afterwards
docker exec talo-mos-v4-postgres rm -rf /tmp/f1
```

Confirm the baseline file hash before step 2 (`3D1D27AE…F080`, see the IAM handoff). The SQL files themselves have
not been executed or syntax-checked against a server; expect to fix trivial issues during the approved run.

## Post-run checks

- `01`: `SELECT datname, pg_encoding_to_char(encoding), datcollate FROM pg_database WHERE datname = 'talo_mos_v4_test';`
- `02`: 11 tables, 16 FK, 12 CHECK, 18 non-PK indexes in `iam` (same as dev); compare `pg_dump --schema-only -n iam` of
  dev and test (ignore pg_dump's random `\restrict` line).
- `03`: role attributes printed by the file — all `f` except `rolcanlogin`.
- `04`: grant listings printed by the file must match the table in `04`.
- `05`/`06`: every attempt reports `OK denied`; final notice `OK: all expected privileges present`; exit code 0.
- Dev database untouched: same row counts and schema dump as before the run.

## PENDING VALIDATION / PENDING DECISION

- Grants marked PENDING VALIDATION in `04` (SC-5 reservation statements, audit inserts without `RETURNING`,
  provisioner needs) must be proven by running the backend integration tests as `talo_app` on the test database.
- Per-role limits (`statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`) — values not approved.
- Roles are cluster-wide. On `talo_mos_v4_dev`, PUBLIC still has the PostgreSQL defaults (CONNECT, TEMP), so the new
  roles could connect there without any table privilege. Revoking PUBLIC on the dev database is a separate decision.
- A dedicated test-harness role for resetting test data is not part of this step.

## Rollback

- Keep nothing: run `90` (drops the test database and all grants in it), then `91` (drops the roles).
- Keep the test database but remove the roles: in `talo_mos_v4_test` run `REASSIGN OWNED BY talo_app, talo_provisioner TO CURRENT_USER; DROP OWNED BY talo_app, talo_provisioner;`, then `91`.
