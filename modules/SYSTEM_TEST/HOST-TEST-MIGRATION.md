# Host test / Foundation migration notes — required before declaring integration PASS

This package is **source-complete but not yet accepted on TEST**. The existing Host test suites were authored for SYSTEM_TEST 1.0.0 and explicitly depend on the removed data viewer. The current GitHub branch had:

- `backend/test/unit/system-test/system-test.test.ts` importing `system-test.tables.ts`, testing `service.tables/rows` and the old three Functions / five routes.
- `backend/test/integration/system-test/system-test.db.test.ts` importing `VIEWER_TABLES`, registering `SYSTEM_TEST` fixture 1.0.0, asserting the DATA_VIEWER menu/API and checking B01–B14 table previews.

These tests must be migrated by the repository maintainer as part of the **1.1.0 version-change acceptance**. Do not comment out whole suites or weaken Host's valid protections. Recommended mapping:

| Old test | New coverage |
|---|---|
| Data Viewer table allowlist, filtering/paging | Removed endpoint must return 404; DATA_INSPECTOR has separate table-viewing tests |
| IAM DATA_VIEWER.READ | Only DIAGNOSTICS.READ and TEST_RUNNER.EXECUTE, test DENIED/ALLOW, lifecycle |
| MIC INITIAL_REGISTRATION 1.0.0 | MIC CHANGE from 1.0.0, new 1.1.0 with 2 Functions and 3 API endpoints |
| 12 health components | 22 components including fleet/pg_stat_database/B08/regression |
| Old GET tables / rows fixture HTTP tests | Module fleet diagnostics GET health / POST quick checks / GET results and 404 for retired APIs |
| Tests of arbitrary SQL/data leaked via viewer | Verify absent routes, absent data-viewer module exports, use DATA_INSPECTOR-specific security tests |
| Runner output | Validate source artifact and drawer behavior; API still cannot execute CLI |

Existing PostgreSQL integration suites may create fixture Foundation versions permanently (append-only): only run on the approved TEST database, with their dedicated harness and cleanup procedure. Do not simply repoint them to production.

## Deployment / navigation

- Module stays `SYSTEM_TEST`; package goes into `modules/SYSTEM_TEST/`.
- Replace code only after local backup of the old folder and a Git diff check.
- Foundation requires a **new Version 1.1.0** with a compatible MIC and genuine MIC10 PASS evidence before ACTIVATE.
- B09 old `/system-test/data` menu should be hidden with authorized Navigation API, as existing navigation's PATCH cannot change its Function target.
- `DATA_INSPECTOR` is a separate module; it is not upgraded or touched by this package.

Until both new and migrated tests, real Host handshake, MIC validator, IAM/menu and AppShell browser run have passed, mark `INTEGRATION: NOT_TESTED` (not PASS). There is no SQL GRANT, migration or automatic IAM provisioning in this ZIP.
