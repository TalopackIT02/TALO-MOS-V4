# SYSTEM_TEST 1.1.1 — System Test & Diagnostics

**Executable TALO module package**, rebuilt from the supplied `SYSTEM_TEST.zip`. Same `moduleKey=SYSTEM_TEST`; **not** a new `SYSTEM_TEST_V2` module. Package format `TALO-MODULE-PACKAGE-1`, protocol `TALO-MODULE-HOST-1`, contract `MIC-1.0`.

## What changed

- Removed Foundation Data Viewer **entirely** (`/system-test/data`, `/api/system-test/tables`, `/api/system-test/tables/:tableKey/rows`), corresponding frontend, SQL and `DATA_VIEWER` Function/Action/MIC mapping. Use the independent `DATA_INSPECTOR` module instead.
- Rebuilt the interface as an operations console: cyber-lite heading, **three distinct red/yellow/green status bars**, compact searchable check matrix, group/severity filters, clipboard JSON diagnostic report, module registry watch, right-side drawer for diagnostics and suite details (Escape/backdrop close), responsive view.
- Expanded 12 legacy checks to **22 checks** (12 original + 10 new): module fleet discovery/lifecycle/version summaries, deployment-proof visibility, `pg_stat_database` connections/deadlocks/rollbacks, B08 audit DENIED/FAILURE, latest Host regression signal.
- Quick Check is read-only; `GET /api/system-test/results` still only reads Host's validated regression artifact. **HTTP never executes CLI/SQL submitted by a user.**
- No new Host capability or PostgreSQL GRANT. Independent observational reads fail as `UNAVAILABLE`, never silently become green. Cumulative statistics are labeled cumulative; rollback ratio uses explicit indicative thresholds (10% WARN, 30% FAIL after 100 transactions); audit DENIED is a warning, not necessarily a failure.
- Keeps existing IAM codes `system_test.diagnostics.read` and `system_test.test_runner.execute` only; legacy `system_test.data_viewer.read` is no longer used by v1.1.

## Installation

1. Back up your existing `modules/SYSTEM_TEST/`. Do **not** overwrite the module while servers are running. Copy this `SYSTEM_TEST/` into the repository's `modules/SYSTEM_TEST/`. Preserve the `DATA_INSPECTOR` folder.
2. Run `npm run modules:sync` from `backend/` and run backend/frontend typecheck, build and tests using your existing repository toolchain. Host sync should discover `SYSTEM_TEST` and `DATA_INSPECTOR` as separate modules.
3. **Do not edit B02/MIC or navigation by SQL.** This is a change from v1.0.0; existing v1.0.0 is managed by Foundation. Prepare a new version **1.1.0** through Foundation: CREATE VERSION → PUT MIC (`mic/system-test.mic.ts`) → SUBMIT (compatibility B13/B14) → APPROVE → ACTIVATE → ENABLE. `MIC09.kind=CHANGE` and `fromVersion=1.0.0`, so confirm version 1.0.0 exists before SUBMIT. MIC10 defaults to `NOT_TESTED` and intentionally blocks activation until **real** evidence is supplied. No code in this ZIP changes IAM or Foundation DB automatically.
4. Audit navigation items B09: the old `/system-test/data` item must be handled under the **existing Foundation navigation-management process**, not by changing source code or deleting Foundation rows. Existing B09 PATCH may only update visibility/title/sort, so the old item may need to be set `isVisible=false`; verify routes and Function IDs. The new runner route `/system-test/runner` may need a new navigation item referring to v1.1.0 `TEST_RUNNER` Function ID. Do not assume old versions' function IDs are interchangeable.
5. IAM provisioning is separate. Existing `diagnostics.read` and `test_runner.execute` must remain effective for authorized accounts. The removed `DATA_VIEWER` permission does not get automatically revoked or dropped.
6. Verify on TEST with a real session: quick checks, module fleet, both drawer contexts, responsive UI, menu, and regression artifact. No browser/runtime, real IAM or DB acceptance was performed in this isolated packaging environment; **do not mark tests PASS without running**.

## API (same host protocol)

| Method | Route | IAM | Notes |
| --- | --- | --- | --- |
| GET | `/api/system-test/health` | `system_test.diagnostics.read` | Session/lifecycle health |
| POST | `/api/system-test/checks/run` | `system_test.diagnostics.read` | Empty JSON body; runs read-only checks |
| GET | `/api/system-test/results` | `system_test.test_runner.execute` | Per-account last Quick Check + CLI regression artifact |

Removed endpoints return normal 404. All endpoints check session, IAM and enabled/ACTIVE lifecycle.

## Status semantics

- **RED / CRITICAL** = `FAIL` (observed failure).
- **YELLOW / WARNING** = `WARN`, `UNAVAILABLE`, `NOT_TESTED`, `TIMEOUT` (observed warning / insufficient verification).
- **GREEN / NORMAL** = `PASS` (check actually executed and met its condition).

`pg_stat_database` counts are cumulative since `stats_reset`; rollback ratio is assessed against cumulative commits since stats_reset (10% WARN / 30% FAIL, only when ≥100 transactions); thresholds are indicative, not service SLOs. Audit B08 access may be unavailable for `talo_app` and is then yellow, not green. Registry watch is not a proof that packages have been synced or are live; this is explicitly marked `NOT_TESTED` without a compatible Host source/registry introspection capability.

## Regression

The local Host CLI runner remains the **only** full regression executor. In PowerShell, from `backend/`:

```powershell
npx tsx test/system-test/regression.cli.ts
```

Frontend reads its already-sanitized result using Host `regressionResults()`; never passes commands/paths from the client.

## Testing and integration notes

- `tests/checks.test.ts` exercises status mapping, failure/unavailable and operational thresholds with synthetic facts; no real database writes.
- `tests/module-contract.test.ts` verifies the manifest/MIC/API inventory and absence of data viewer routes and SQL.
- **Host legacy test migration required:** current repository tests `backend/test/unit/system-test/system-test.test.ts` and `backend/test/integration/system-test/system-test.db.test.ts` explicitly import the removed `system-test.tables.ts` and expect DATA_VIEWER / MIC 1.0.0. They **will fail until updated** to v1.1.0. This ZIP intentionally does not alter Host test files; see `HOST-TEST-MIGRATION.md`.
- Tests included for source-level regression, **not** substitutes for backend+frontend compilation, Host handshake, Foundation MIC validation and real TEST runtime tests.
- `config/README.md` remains informational; no new configuration or secrets are required.
