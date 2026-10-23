# SYSTEM_TEST 1.2.0 — One-pass Claude Code integration handoff

Implement/test this **unified candidate**, not another rewrite. Local working tree is authoritative (GitHub may be behind). The uploaded original packages were `SYSTEM_TEST` v1.1.1 and `DATA_INSPECTOR` v0.1.0.

## Task

1. Back up repository's current `modules/SYSTEM_TEST`, `modules/DATA_INSPECTOR`; review Git status and TEST connection. Avoid any overwrite of uncommitted edits.
2. Review this candidate's `module.json`, both MIC files, generated `mic/module.mic.json`, all backend/frontend source, README, and evidence status.
3. **Before `npm dev/build/typecheck`:** inspect Host `modules:sync.mjs`; it auto-copies installed packages. Ensure current ACTIVE modules cannot be silently replaced by an untested candidate. Prepare an isolated integration branch/staging plan.
4. Run TypeScript build, Vitest, backend Host, API-envelope, IAM, and session-contract tests. Update only tests made obsolete by the new 4-tab API/permission mapping. No false PASS.
5. Test new `/api/system-test/audit/logs` with actual `talo_mos_v4_test` database and auth: root admin with authorized IAM `system_test.audit.read`, a non-admin, a user lacking IAM, both readable source tables, one unreadable source, and no actual events. Show UNAVAILABLE when needed. Confirm no secrets/metadata leaked.
6. Verify Data Inspector's original all-schema list, columns, rows pagination and server masking. Preserve its admin-only gate.
7. Verify all prior 22 diagnostic checks and Runner artifacts. Test full TXT downloads contain every check/suite/detail and preserve Vietnamese UTF-8; missing results must be explicit. Browser sends no full regression CLI commands.
8. Test MIC schema, K05, MIC09 history and expected B09 routes; regenerate `mic/module.mic.json` if TypeScript MIC changes; compare normalized JSON exactly. Prepare actual MIC10 PASS evidence *only* for tests really executed.
9. **Do not automatically** SUBMIT/APPROVE/ACTIVATE/ENABLE/DISABLE; no IAM grants or DB schema changes without explicit approved action. Verify loader collision and migration impact first.
10. Report changes, test results PASS/FAIL/NOT_TESTED, missing DB privileges, and the exact safe activation/menu retirement plan.

## Blockers and risks

- Source is a candidate; the uploaded SYSTEM_TEST 1.1.1 had its own 1.0.3 baseline note, while TEST database may have newer versions. Validate `fromVersion` against B02 before submit.
- Data Inspector's old permissions (`data_inspector.*`) will **not** grant `system_test.catalog.read` / `.rows.read` / `.audit.read`; there must be a legitimate installation and IAM path.
- The Host may not have SELECT on `foundation.fnd_audit_logs` and/or `iam.iam_audit_logs`. Do not pretend full log coverage. No automatic GRANT.
- The old `DATA_INSPECTOR` module remains separate in existing Foundation B01/B02 until explicitly disabled/retired via approved lifecycle. Source-level unification does not delete DB history.
- `backend/test/system-test/regression.cli.ts` reads/writes the artifact for SYSTEM_TEST, so its moduleKey is intentionally retained and Full Regression remains external CLI.
- The text exporter is client-side and exports data the API already returned, not a server-side historic archive.

## Deliverables for sign-off

- Host/backend/frontend build and test evidence.
- Real 3 original + 4 new endpoints and B09 menu/access evidence.
- Database role SELECT review for audit sources (without writes).
- Admin/non-admin runtime acceptance.
- Git diff, before/after module inventory, rollback plan.
- Approval-gated publication of v1.2.0 (no hidden auto activation).
