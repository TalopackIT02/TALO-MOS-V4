# SCC Audit Logs — least privilege database proposal

Status: **proposal only; none of these scripts has been executed**.

The current `talo_app` role correctly receives SQLSTATE `42501` when it selects either raw audit table. Granting raw
`SELECT` would expose arbitrary JSON metadata to every backend component using that shared role and would break the
existing least privilege smoke contract. This proposal keeps those denials and exposes two fixed, bounded projections
plus one bounded Foundation health summary.

## Approval and execution order

1. Review and explicitly approve the database change and a new SCC package release.
2. Run `01-create-owner-role.sql` on maintenance database `postgres`.
3. Run `02-grant-owner-test-database.sql` and `03-create-functions-test-database.sql` on `talo_mos_v4_test`.
4. Run `04-verify-admin-read-only.sql` as admin, then `05-verify-as-app-read-only.sql` and
   `06-verify-extended-as-app-read-only.sql` through a direct `talo_app` connection. Do not run on DEV or PROD.
   05 uses a 24-hour window: on TEST the newest Foundation audit row may be older than 24 h, so 05 can legitimately
   return 0 Foundation rows. 06 proves real data over the 31-day maximum, every invalid input (22023), raw-SELECT and
   `SET ROLE` denial (42501) and the closed 12-column result shape. Counts only; no audit row is printed.

Execution facts (verified on an isolated PostgreSQL 18.6 clone of TEST, 2026-10-27):

- 01–04 must run as the superuser `admin` (the only role with CREATEROLE on TEST). A non-superuser CREATEROLE role would
  receive an automatic membership in `talo_audit_reader`, which 04 rejects.
- `DATABASE_MIGRATION.sql` (Phase 2 package) = 01 + 02 + 03 + 04 joined with `\connect`; it needs `psql`, not the
  pgAdmin Query Tool. Running the separate files with `psql -d postgres` (01) and `psql -d talo_mos_v4_test` (02–04) is
  equivalent.
- After `90-rollback`, the role is kept: re-applying needs 02 + 03 + 04 only (01 aborts by design when the role exists).
- `SET statement_timeout = '5s'` on a function does not limit the call already running (PostgreSQL applies the timeout
  per top-level statement). The effective 5-second limit is the Module Host's `SET LOCAL statement_timeout = 5000` in the
  same READ ONLY transaction (verified: a 3-second body is cancelled at 1 s by SET LOCAL, not by a function SET).
- `p_action` is matched with ILIKE: `_` is a single-character wildcard, so a filter can match slightly more action codes
  (never other columns, never other tables). `%` and quotes are refused by the input rule.
5. Package/activate the SCC source that calls `audit_api.*` only through the approved Installer workflow.
6. Verify the authenticated HTTP endpoint. HTTP `200` alone is insufficient: both source states must be `AVAILABLE`,
   `complete` must be `true`, and at least one `events` row (or a nonzero count from step 4) is needed to prove that
   recorded data was actually returned.

## Privilege model

| Principal | New privilege | Direct raw audit SELECT |
|---|---|---|
| `talo_app` | `USAGE audit_api`; `EXECUTE` on three fixed functions | denied |
| `talo_audit_reader` | NOLOGIN owner; exact source-column SELECT | cannot log in |
| `PUBLIC` | none | unchanged |

Each function enforces the caller, a maximum 31-day interval, closed outcome values, a safe action filter and a maximum
of 501 rows. It returns a closed column set; arbitrary metadata is never returned. `reason` and `errorCode` are emitted
only when they match the same short code-like policy as the application.

## Risks and controls

- A `SECURITY DEFINER` defect could expose data with the owner's privileges. Controls: no dynamic SQL, fully-qualified
  objects, fixed `search_path`, fixed statement timeout, exact EXECUTE grants, NOLOGIN/NOINHERIT owner and verification.
- The shared `talo_app` role can call the functions from any backend code. The database API therefore repeats filter and
  row-limit validation and never exposes raw metadata. Application IAM, Administrator Gate and lifecycle checks remain
  required before the call.
- The role has column access to the metadata column because the approved output derives two keys from it. The role cannot
  log in and no role may inherit or `SET ROLE` to it; verification asserts both conditions.
- Current immutable SCC 0.1.0 still queries raw tables. Database approval alone will not make the page complete; a new
  reviewed SCC package must be activated later. The immutable release is not edited by this change set.
