# 10 — DATA FLOW, TEST ISOLATION & SECURITY

## Data boundaries (write ledger)

| System | READ possible | WRITE allowed in REV-01? | Gate |
|---|---|---|---|
| `modules/*` | Static manifest/MIC source | Không tự sửa package 1.2.0 | Package candidate controlled by user |
| Candidate/Preflight store | Snapshot/report/journal | Có trong flow được phép; immutable hash, atomic | Session/IAM, allowed path |
| B01/B02 | Registry/status/MIC | Không cho install thật module ACTIVE trong revision test; fixture/new module test có phê duyệt | Installer services/lifecycle only |
| B03–B06, B10–B14 | Function/action/data contracts | Chỉ qua SUBMIT test fixtures có kiểm soát | Validator transaction + audit |
| B07/B08 | Audit history | Không trực tiếp sửa/xóa; service vẫn ghi audit cho actions thật | Service audit |
| B09 | Navigation layout & links | Chỉ qua Builder/Installer service trong test approved/fixture | Revision + transaction + backup |
| IAM tables | Catalogue/grants/effective permissions | Không auto role assignment, SQL GRANT hay direct DML | IAM Admin service, owner policy |
| Release lock/store | Immutable approved code | Test bằng copies/staging; actual cutover only with approval | Hash, runtime, recovery |
| DEV/production | Không | Tuyệt đối không | Hard deny |

## Query & environment

- Before DB tests: show only `current_database()` (must equal `talo_mos_v4_test`), hostname class/environment and connected role; redact DSN.
- No new schema/migration/Prisma updates, no SQL GRANT, no disabling constraints. If integration test writes fixture, require explicit declared test scope, isolated identifiers, backup and verified cleanup; avoid persistent FBET pollution.
- `pg_dump` custom + sha256 + `pg_restore -l` before any potentially destructive approved action; no write without restore strategy. Changes that affect LIVE TEST data must not be conflated with unit test fixtures.
- Read-only snapshot B01/B02/B09 and IAM counts/digests before/after. Audit B07/B08 naturally append if protected operations run; do not claim byte-identical audit after those operations, verify legitimate differences only.

## Filesystem

- Scan roots server-fixed. Never accept raw path from client or import/eval module TS in scan.
- symlink/junction/path traversal refused; `.env`, `.key`, secrets and generated build dirs excluded/sanitized; resource ceilings retained.
- release store: package hash must match pinned lock; no copy source `modules/` direct into runtime in production/deployed path.
- Installer store JSON writes must be atomic, restart-resumable, integrity checked. Concurrent writing requires lock strategy sufficient for deployment topology.

## Logs and report redaction

Allowed: moduleKey/version, file relative path, error code, field path, status, timestamp, run/hash, SQLSTATE without row data, bounded message. Prohibited: DB password, connection string, bearer, session cookie, secret, query result rows, raw personal data, stack traces in browser.

## Test fixtures FBET / Navigation noise

- Observed large historical FBET population on TEST and `Khóa MVC...` B09 groups. REV-01 prioritizes **containment and correct filtering**; destructive historical cleanup is separate, requires ownership proof per ID and backup.
- Every new test using DB fixture chooses collision-safe route (never `/system-test` etc.), one run prefix, no accidental ACTIVE ENABLED leftover. Teardown through approved services where possible, audit intact.
- On expected cleanup denial due FK/audit, report leftovers with IDs and **do not silently DELETE**.
- ENABLE disabled module holding another ACTIVE route must be blocked as part of operational safety; do not rely on it staying disabled forever.

## Access boundaries

- `SYSTEM_TEST` diagnostics & DATA_INSPECTOR remain unaffected during Foundation changes.
- Data Inspector read and System Logs admin rights are outside Foundation revision; do not alter their permission contracts as incidental change.
- Signed-in admin does not automatically mean unbounded database file access; preserve existing least-privilege policies.

## Negative verification

1. `git diff` contains no schema/migration/IAM raw SQL changes.
2. No DEV/production DB connection, no undeclared write operations.
3. Test log scanning for secrets, no session token in downloadable reports.
4. Existing ACTIVE/ENABLED and release lock unchanged unless explicitly owner-approved scenario.
5. No new FBET route collision, no drift of B09 admin menu after tests.
