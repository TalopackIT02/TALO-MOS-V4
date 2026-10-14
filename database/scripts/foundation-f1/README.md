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
| 7 | `cd backend; npm run smoke:db` (host, Windows) | `talo_mos_v4_test` via `127.0.0.1:5433` | **talo_app** + password | none (read-only); expects `RESULT: PASS` |
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

# 5/6. verification as the restricted roles. NOTE: inside the container pg_hba uses `trust` for the unix socket
#      and 127.0.0.1, so these run as the role WITHOUT a password check. They verify privileges, not passwords.
docker exec -it talo-mos-v4-postgres psql -h 127.0.0.1 -U talo_app -d talo_mos_v4_test -v ON_ERROR_STOP=1 -f /tmp/f1/05-verify-least-privilege-app.sql
docker exec -it talo-mos-v4-postgres psql -h 127.0.0.1 -U talo_provisioner -d talo_mos_v4_test -v ON_ERROR_STOP=1 -f /tmp/f1/06-verify-least-privilege-provisioner.sql

# afterwards
docker exec talo-mos-v4-postgres rm -rf /tmp/f1

# 7. runtime smoke test from the Windows host (scram-sha-256 applies to host connections, so this proves the
#    password too). Put DATABASE_URL=postgresql://talo_app:<secret>@127.0.0.1:5433/talo_mos_v4_test in the
#    process environment or in the git-ignored root .env; never commit it.
cd backend; npm run smoke:db   # exit 0 = PASS, 2 = NOT_READY, 1 = FAIL
```

Never run these files with `psql -1` / `--single-transaction`: `CREATE DATABASE` and `DROP DATABASE` cannot run inside a
transaction block, and the files already manage their own transactions. Confirm the baseline file hash before step 2 (`3D1D27AE…F080`, see the IAM handoff). Static verification (AUTH-DB-F2, no write executed): lint of all files; every granted table/column exists in IAM v0.3;
all DML used by the negative tests parsed by PostgreSQL 18 (`PREPARE`, never executed); every guard executed read-only
on correct and wrong targets. `CREATE DATABASE`, `CREATE ROLE`, `GRANT`/`REVOKE`, `TRUNCATE` and `CREATE TABLE`
cannot be parse-checked without executing them and were reviewed manually.

## Post-run checks

- `01`: `SELECT datname, pg_encoding_to_char(encoding), datcollate FROM pg_database WHERE datname = 'talo_mos_v4_test';`
- `02`: 11 tables, 16 FK, 12 CHECK, 18 non-PK indexes in `iam` (same as dev); compare `pg_dump --schema-only -n iam` of
  dev and test (ignore pg_dump's random `\restrict` line).
- `03`: role attributes printed by the file — all `f` except `rolcanlogin`.
- `04`: grant listings printed by the file must match the table in `04`.
- `05`/`06`: every attempt reports `OK denied`; final notice `OK: all expected privileges present`; exit code 0.
- Dev database untouched: same row counts and schema dump as before the run.

## Partial failure behaviour

| File | If it stops midway |
|---|---|
| 01 | Guard aborts before `CREATE DATABASE`; `CREATE DATABASE` is atomic. Re-run after fixing the cause. |
| 02 + baseline | Guard aborts before any DDL; the baseline runs in one `BEGIN … COMMIT`, so a failure leaves no `iam` schema. |
| 03 | Guard aborts if either role exists; both roles are created in one transaction. |
| 04 | Guard outside, all REVOKE/GRANT in one transaction: either all grants apply or none. |
| 05 / 06 | Read/verify only inside a transaction that is rolled back; a `FAIL` exits with an error, nothing persists. |
| 90 | Guard refuses while connections exist; `DROP DATABASE` fails safely if one appears in between. |
| 91 | Guard checks `pg_shdepend` for remaining ownership/privileges in any database; both drops in one transaction. |

## Findings from AUTH-DB-F2 review

- F2-04 — `talo_app` cannot lock membership rows (`FOR UPDATE/SHARE` require an UPDATE privilege). The SC-5
  SUCCESS transaction must re-read the membership instead of locking it; no UPDATE grant on memberships is proposed.
- F2-05 — roles are cluster-wide; PUBLIC keeps CONNECT/TEMP on `postgres` and `talo_mos_v4_dev`, so `talo_app` can
  connect there (no IAM privileges). Restricting this (REVOKE on those databases, or a pg_hba rule) is a separate decision.
- F2-06 — pg_hba `trust` for local/127.0.0.1 inside the container: anyone with `docker exec` can connect as any role.
  Acceptable for local development (docker access is already admin-equivalent); must not be carried to a server.
- F2-07 — Prisma `create` uses `INSERT … RETURNING *`; audit and provisioner credential inserts must use `createMany`
  (no RETURNING). Prisma also sends `created_at` / `occurred_at` from the application clock when the schema has
  `@default(now())`, instead of the database `now()`.

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
