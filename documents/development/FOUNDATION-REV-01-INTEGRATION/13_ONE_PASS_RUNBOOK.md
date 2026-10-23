# 13 — ONE-PASS IMPLEMENTATION RUNBOOK

## Start / command discipline

**Run from repo root** `D:\Documents\ClaudeProject\TALO-MOS-V4`. Claude Code should start by reading `CLAUDE.md`, `00_START_HERE.md`, `02_NON_NEGOTIABLE_GUARDS.md`, `14_CLAUDE_CODE_ONE_PASS_PROMPT.md`. No need to paste these files into the chat; they are local.

Use native package scripts found in `package.json`. Do not blindly run npm scripts with `predev`, `prebuild`, `pretypecheck` before checking `module-deployments.json` and release store. Running tests on TEST must verify `current_database()`. Do not invent fixed port, username or credentials.

## One-pass orchestration

| Stage | Actions | Stop/continue rule | Evidence |
|---|---|---|---|
| G0 Audit | Git diff, local branch, assets/DB baseline, review source map | If wrong DB, skip DB tests, continue source-only | BASELINE.md |
| TDD | Add failing tests for 4 P0 source issues | Tests must fail for correct reason before code changes | RED-TESTS.md |
| REV-A | Candidate MIC, safe version apply, upgrade staging, B09 planner, IAM/preflight postcheck | If recovery requires protected change: block only ACTIVE cutover, continue others | REV-A.md |
| REV-B | UI 2 screens, route guard, drawer/modal Navigation Builder | Check unsaved state and API compatibility after each substep | REV-B.md |
| REV-C | API contract, security, E2E, fixture containment | No raw DB deletes or schema changes | REV-C.md |
| Verify | Typecheck/build/test/e2e/focused DB TEST, post baselines | No falsified PASS. Distinguish unchanged existing failures | TEST-RESULTS.md |
| Close | Diff, report, status, local commit only if safe | No push/merge/deploy | FINAL.md |

No pause to ask for continuation between normal stages. When blockers arise, record and continue independent stages; do not “fix” protected behavior without approval.

## Local evidence destination

`documents/development/FOUNDATION-REV-01-INTEGRATION/implementation-evidence/` (create only during implementation):

- `BASELINE.md` — branch, HEAD, dirty list, environment, runtime hashes.
- `RED-TESTS.md` — tests reproducing baseline defect.
- `REV-A.md`, `REV-B.md`, `REV-C.md` — changes and tests for each.
- `TEST-RESULTS.md` — matrix A01..C10 and commands/exits.
- `FINAL.md` — concise result, blockers, rollback/recovery, files.

Do not save secret-bearing logs/DB dumps in repo. Store sanitized logs outside repo with referenced hash/relative path if necessary. Evidence files should be compact and factual.

## Minimal high-yield tests to run first

1. Existing Foundation installer unit tests (new/upgrade/recovery).
2. Tests of Candidate→MIC canonical comparison.
3. Navigation builder planner tests (root→menu→function; hidden link false-positive).
4. Host release lock/isolation tests.
5. ModuleScreen/workspace direct routing and drawer focus E2E.

Then run broader typecheck/build and regressions. When tests are destructive/DB write, verify target and fixture isolation first.

## Fast defect-to-fix loop

- Exact failing test/field/route → inspect only producer/consumer code → patch small → rerun targeted test → run affected regression.
- On rerun, reuse build caches only when hash/version control valid; no skip just to meet time goal.
- Only change `CLAUDE.md`/policy rules if explicitly approved. Do not alter evidence after a PASS to make hash appear valid.

## Manual owner gate template

If lifecycle recovery requires approval, deliver a 1-page note:

`Decision ID | Currently blocked step | Exact protected files/DB changes | Options + failure modes | Recommended safe default | Tests possible without decision`.

Do not ask multiple narrow questions. State one decision required; continue remaining scope. This is a single-run handoff, not permission to do unsafe work.

## Final reporting template

```
FOUNDATION-REV-01: DONE / PARTIAL / BLOCKED
BASELINE: local branch + HEAD + dirty count
IMPLEMENTED: REV-A ..., REV-B ..., REV-C ...
GATES: G0 ..., A01..A16 ..., B01..B11 ..., C01..C10 ...
TESTS: exact commands, passed/failed/skipped, TEST DB read-only/fixture safety
PROTECTED: ACTIVE modules/version/hash before/after, B09/IAM results
BLOCKERS: exact code, evidence, required owner decision (if any)
FILES: changed paths; docs/evidence location
GIT: local commit? no push/merge/deploy
NEXT USER ACTION: route and click path / only if verified
```

If code and UI completed but ACTIVE upgrade remains blocked pending recovery approval, **status PARTIAL**, not DONE. Never claim one-click upgrade implemented without full acceptance.
