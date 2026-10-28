# SCC 0.1.2 — Foundation controlled read (Database Access Gate proposal)

**STATUS: PROPOSAL FOR OWNER APPROVAL — NOT EXECUTED ON TEST.** Tested only on an isolated clone of TEST (container
`postgres:18`, restored from a `pg_dump` of `talo_mos_v4_test`, destroyed after the test).

## Purpose

SCC Data Inspection cannot show `foundation.fnd_module_events` (B07) and `foundation.fnd_data_access_rules`:
`talo_app` has no SELECT on them (owner `talo_foundation_owner`). Granting raw SELECT to the shared API role is refused
by design. These scripts add two bounded SECURITY DEFINER readers instead.

`iam.iam_memberships` / `iam.iam_sessions` need **no database change**: `talo_app` already reads them; SCC 0.1.2 serves a
fixed column projection from the backend (no `employee_id`, never `session_token_hash`).

## Objects

| Object | Kind | Privileges |
|---|---|---|
| `talo_foundation_reader` | role, NOLOGIN NOINHERIT, no superuser / createrole / createdb / replication / bypassrls, no members | `USAGE foundation`; column `SELECT` on the two target tables only |
| `foundation_read_api` | schema | `USAGE` to `talo_foundation_reader`, `talo_app`; nothing to PUBLIC |
| `foundation_read_api.read_module_events(from, to, module_id, event_type, limit, offset)` | SECURITY DEFINER, `search_path=pg_catalog`, owner `talo_foundation_reader` | `EXECUTE` to `talo_app` only |
| `foundation_read_api.read_data_access_rules(data_contract_id, enabled, limit, offset)` | same | same |

Guards inside each function: `session_user = 'talo_app'`; window ≤ 366 days; event type from a closed list; page ≤ 101
rows; offset ≤ 100000; invalid input → SQLSTATE `22023`. Lifecycle JSON (`before_state`, `after_state`) never leaves the
database: only `status` (`^[A-Z_]{1,40}$`), `is_enabled` (boolean) and `manifest_hash` (`^[0-9a-f]{64}$`) are projected.
The 5 s limit is the Module Host's `SET LOCAL statement_timeout = 5000` (a function-level setting is not effective).

Independent of the SCC 0.1.1 `audit_api` gate: other role, other schema. The 0.1.1 rollback (`scc-audit-read/90`) keeps
working and is not touched.

## Order (TEST only, after approval)

1. Backup + restore test (as for the 0.1.1 DB Gate); `06-privilege-inventory-read-only.sql` as admin → baseline.
2. `01-create-owner-role.sql` — `psql -d postgres` as admin.
3. `02-grant-owner-test-database.sql`, `03-create-functions-test-database.sql` — `psql -d talo_mos_v4_test` as admin.
4. `04-verify-admin-read-only.sql` as admin; `05-verify-as-app-read-only.sql` through a direct `talo_app` connection; `06` again → diff = approved delta.
5. Only then the Installer Gate for SCC 0.1.2 (0.1.2 shows `CONTROLLED_READ_UNAVAILABLE` for the two tables until 01–03 exist).

Rollback: `90-rollback-test-database.sql` (talo_mos_v4_test), then `91-drop-owner-role.sql` (postgres). Verified on the
clone: full ACL snapshot (table + column level) after 90 + 91 is identical to the TEST baseline.

## Isolated test result (clone of TEST, 28/10/2026)

| Step | Result |
|---|---|
| 01 → 03 | exit 0 |
| 04 (admin) | PASS: role attributes, no members, SECURITY DEFINER + owner + search_path, EXECUTE only talo_app, schema not PUBLIC, talo_app no raw SELECT, reader reads only the two tables and writes nothing |
| 05 (talo_app) | 101 events (366 d, page cap), 15 SCC events (= B07 count), 101 rules (page cap); 10 invalid inputs → 22023; raw SELECT → 42501; `SET ROLE talo_foundation_reader` → 42501; result shape = 12 declared text columns |
| 90 → re-apply 02/03 → 04 | PASS (repeatable) |
| 90 + 91 | role removed; full ACL identical to TEST baseline; `scc-audit-read/04` still PASS |
| 06 inventory (2nd clone) | delta = 1 role, `USAGE foundation`, column SELECT 9 + 8 columns, schema `foundation_read_api`, 2 functions EXECUTE talo_app; after 90 + 91 identical to TEST |
| Leak scan (0.1.2 router, talo_app) | 315 requests / 7.2 MB: 0 hits of 42 session token hashes, password hash, employee_id; 0 hash / JWT / cookie patterns. Positive control (token injected) → 42/42 detected |
