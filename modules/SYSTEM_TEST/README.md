# SYSTEM_TEST 1.2.0 — System Control Center (merged candidate)

**Status: SOURCE CANDIDATE — NOT TESTED on the actual TALO-MOS-V4 Host/TEST PostgreSQL. NOT ACTIVATABLE until evidence passes.**

This merges the uploaded `SYSTEM_TEST (2).zip` (v1.1.1) and `DATA_INSPECTOR.zip` (v0.1.0) into ONE installable Host package under the **existing `SYSTEM_TEST` moduleKey**. The original DATA_INSPECTOR package must remain intact until TEST acceptance and migration are complete.

## AppShell screen, 4 tabs

| Tab | Route | Preservation / new functionality |
|---|---|---|
| System Diagnostics | `/system-test` | Existing SYSTEM_TEST 22 read-only checks, 3 colored bars, search, detail drawer, module fleet + **Export full TXT** |
| Test Runner & Results | `/system-test/runner` | Existing Quick Check and CLI-produced Full Regression artifact, suite drilldown + **Export full TXT** |
| Data Inspector | `/system-test/data` | All-schema PostgreSQL catalog, columns, bounded table pages; original server-side masking and exact `admin` username gate |
| System Logs | `/system-test/logs` | **New:** query recorded Foundation B08 and IAM audit, filter source / SUCCESS/FAILURE/DENIED / time / action / actor; row detail drawer, per-source unavailability |

Tab paths above are inside the single screen `system.test` defined by `module.json`. They do not imply permissionless access; the backend is authoritative.

## Backend APIs

- GET `/api/system-test/health`
- POST `/api/system-test/checks/run`
- GET `/api/system-test/results`
- GET `/api/system-test/data/tables`
- GET `/api/system-test/data/tables/:tableKey/columns`
- GET `/api/system-test/data/tables/:tableKey/rows?page=&pageSize=`
- GET `/api/system-test/audit/logs?source=ALL&outcome=ISSUES&page=1&pageSize=25`

All endpoints have same-origin session and Host IAM/lifecycle checks. Table API retains hard-coded `username === 'admin'` with ACTIVE and not disabled, and no extra SQL privilege.

## Global audit coverage — important boundary

System Logs reads **existing recorded audit events**, NOT all HTTP requests or every unhandled exception in the process. Currently supported data sources are:

1. `foundation.fnd_audit_logs` (B08): actor/account/action/outcome/target/correlation.
2. `iam.iam_audit_logs`: IAM and authentication audits.

An operation not instrumented to produce audit events will not be reconstructable. To review server exceptions not recorded in either table, a later Host-level logging provider would be required. This package does not intercept arbitrary requests and does not add write triggers.

The Host's `readOnly` uses the runtime PostgreSQL API role. If either audit table is not SELECT-readable, the API reports that source as `UNAVAILABLE` and marks the snapshot `complete:false`. **Do not grant SQL privileges without a separate owner-approved database change.** Raw `metadata` is intentionally withheld; only safe limited action/outcome/reason/errorCode fields are shown. No password, token, credentials or arbitrary SQL exposure.

## TXT exports

A client-side UTF-8-BOM `.txt` file is downloaded using a browser action. It includes source, timestamps, run id, durations, all reported checks including failures/unavailable, counts, fleet metadata, and (for Runner) all suites and summary lines of the latest artifact. A missing regression artifact is marked `NOT_RUN` or `INVALID`, never PASS. Export is **not** a new server write API and doesn't contain PostgreSQL table row values.

## IAM mapping (MIC07)

| Function.Action | Permission Code | Gate |
|---|---|---|
| DIAGNOSTICS.READ | `system_test.diagnostics.read` | Session + IAM + SYSTEM_TEST ACTIVE/ENABLED |
| TEST_RUNNER.EXECUTE | `system_test.test_runner.execute` | Same; Full Regression still CLI-only |
| CATALOG.READ | `system_test.catalog.read` | Same + exact admin account gate |
| ROWS.READ | `system_test.rows.read` | Same + exact admin account gate |
| AUDIT_LOG.READ | `system_test.audit.read` | Same + exact admin account gate |

These new catalog/rows/audit permission codes **do not exist automatically just because the source package is copied**. IAM catalog, grant, version lifecycle and B09 setup must follow the current Foundation-approved process. Old `DATA_INSPECTOR.*` grants cannot be assumed to authorize the new module.

## MIC

- `mic/module.mic.json`: scan-readable and generated from the actual TypeScript candidate declaration.
- `mic/system-test.mic.ts`: Host-compatible MIC entry.
- `mic/data-inspector.mic.ts`: imported declarations for catalog/rows resources (not an independent MIC submission).
- `mic09Compatibility.kind = CHANGE`; `fromVersion = 1.0.3` based on the uploaded source's note that this was ACTIVE. **Recheck real TEST version history before SUBMIT**; adjust the candidate in source and regenerate JSON if necessary.
- `mic10Manifest.testEvidence = NOT_TESTED`, intentionally. Do not falsify this to bypass `TEST_EVIDENCE_NOT_PASSED`.

## Operational release procedure

1. Snapshot local Git and save copies of **both original folders** and the TEST database before *any* Foundation writes.
2. Stage `modules/SYSTEM_TEST/` source in a separate branch; **do not overwrite/replace while the current backend/frontend run**. Inspect current `modules:sync` auto-copy behavior and the local versions first.
3. Run module/backend/frontend typecheck/build and Host/API contract tests; update old Host tests that reference v1.1.1 or the retired DATA_VIEWER.
4. Run TEST PostgreSQL integration with an authorized admin session. Confirm table masking, IAM deny paths, audit B08/IAM source status and TEXT export. Record evidence.
5. Provision permissions through authorized IAM process. Confirm `system_test.*` mappings. Do not bypass `notSelf` or grant permissions by hand without authorization.
6. Register version 1.2.0 under existing SYSTEM_TEST only when ready; import MIC from `mic/module.mic.json`; validate MIC09 and MIC10. Use Foundation Gate, no direct B02 UPDATE.
7. Create B09 menu paths for CATALOG and AUDIT_LOG plus existing DIAG/TEST_RUNNER. Ensure actual routes are visible to authorized admin and inaccessible to non-admin.
8. Activate/enable and perform postchecks. Only after success: hide/disable old DATA_INSPECTOR menu/module using the approved lifecycle. Do not delete its audit/version history, and do not remove its folder until runtime loader is understood.
9. Commit only reviewed changes. No push/merge/deploy automatically.

### Candidate test command

From `backend/` in your local clone with dependencies installed:

`npx vitest run --config ../modules/SYSTEM_TEST/tests/vitest.config.mjs`

The shipped package tests are for contract/TXT only; the full PostgreSQL/runtime acceptance is still required. Older test sources are preserved in `legacy-tests-*` for migration reference, not reported as passing.

See `INTEGRATION-HANDOFF.md` and `VALIDATION-STATUS.md`.
