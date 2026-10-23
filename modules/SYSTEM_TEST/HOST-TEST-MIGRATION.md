# Host Test Migration — SYSTEM_TEST unified 1.2.0

The backend Host tests written for earlier SYSTEM_TEST v1.0.x/v1.1.1 may expect the retired DATA_VIEWER function, fewer tabs, or the old module version. They must be updated, not deleted or bypassed.

Expect now: one `SYSTEM_TEST` moduleKey and Host protocol `TALO-MODULE-HOST-1`; tabs `/system-test`, `/system-test/runner`, `/system-test/data`, `/system-test/logs`; 5 functions, 5 actions, 7 API declarations. Existing DIAGNOSTICS, RUNNER and original Data Inspector read-only semantics remain; new logs are read-only from IAM+B08 with admin gate. Verify no old `/api/data-inspector/*` new routes are published by the merged package. The still-installed legacy DATA_INSPECTOR may expose them until a separate retirement after acceptance.

Required runtime tests:
- Host handshake + backend/frontend registries + screen routes.
- IAM and lifecycle checks for each 5-action permission.
- Exact admin login gate for Data Inspector and Logs.
- Data Inspector masking/RLS/pagination unchanged.
- Logs both AVAILABLE and UNAVAILABLE paths, filtering, no raw metadata.
- Quick Check/Regression response envelopes and full TXT exports.
- MIC-1.0 schema, B05/B06, MIC09 fromVersion actual B02, MIC10 PASS only with evidence.

Retain test assertions on permission failures, unauthorized access and module lifecycle. Do not edit the Host's global protocols just to fit this package.
