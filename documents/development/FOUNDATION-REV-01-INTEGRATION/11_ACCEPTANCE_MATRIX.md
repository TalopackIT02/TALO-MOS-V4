# 11 — ACCEPTANCE / TRACEABLE GATES

## Chấm điểm

- `PASS`: observed evidence (command, exit/result, DB TEST if used, commit/hash).
- `FAIL`: expected not met.
- `NOT_TESTED`: not executed; cannot claim DONE if required.
- `BLOCKED`: protected scope/unknown recovery/permission prevents safe test.
- `N/A`: out of scope with explanation. No converting N/A to PASS.

## G0 — Baseline (required)

| ID | Acceptance | Evidence |
|---|---|---|
| G0.1 | Branch/HEAD/dirty diff captured, user changes preserved | `evidence/BASELINE.md` |
| G0.2 | DB TEST identity and scope read-only confirmed before DB test | safe query/result |
| G0.3 | Current ACTIVE modules, lock, B09 and API baseline recorded | snapshots/checksums |
| G0.4 | Actual local source diffed against GitHub reference; no resets | changed-file list |

## G1 — REV-A (required)

| ID | Acceptance | Expected result |
|---|---|---|
| A01 | Candidate MIC is sole installer MIC | no `MAIN.READ` template during package install |
| A02 | B02 DRAFT same version reused safely | no duplicate, expected hash/state verified |
| A03 | DRAFT unexpectedly changed | conflict, no silent overwrite |
| A04 | B02 locked version | cannot mutate, proper blocker |
| A05 | MIC05/Host, MIC07/K05, MIC04/Nav valid | one contract, exact mappings |
| A06 | FMI-02 run evidence server generated | package/run/report hashes match |
| A07 | P6 401-only not treated authenticated test | truthful result/limitation |
| A08 | backend/frontend runtime response shape tested where possible | error field and endpoint shown |
| A09 | NEW_MODULE FMI-03 flow repeat/resume safe | staging integration PASS |
| A10 | Existing module *without* ACTIVE supports valid prepare/install | supported by tests/fixtures |
| A11 | ACTIVE upgrade gated on proven recovery | no unsafe cutover, explicit blocker |
| A12 | Recovery strategy implemented only if approved, test it | no raw SQL bypass |
| A13 | IAM catalog not equal assignment/access | reported separately |
| A14 | NAV uses 3-level Builder contract | no new legacy/hidden duplicate |
| A15 | `INSTALLED_ACTIVE` requires actual postcheck | missing authenticated test -> not success |
| A16 | Status/journal survives browser/server restart | persisted store read |

## G2 — REV-B (required)

| ID | Acceptance | Expected result |
|---|---|---|
| B01 | Module list on `/foundation/modules` uses AppShell | existing layout/header/sidebar intact |
| B02 | Workspace client route accepts valid UUID and session guard | direct URL, reload, back |
| B03 | 4-block UI consistent with current shell | breadcrumb/title/toolbar/content |
| B04 | Scan button manual only | no scan on page load or navigation |
| B05 | Version/MIC details open right drawer | no long expansion below list |
| B06 | Preflight issue/log details open drawer | download TXT remains |
| B07 | Multi-step candidate stays workspace | plan, install, restart, history |
| B08 | Risky actions use modal and server gate | blocking/confirm state |
| B09 | Navigation Builder uses tree main + drawer inventory/edit | draft/revision preserved |
| B10 | Mobile/focus/ESC/aria/unsaved changes | Playwright keyboard/responsive |
| B11 | FBET/hidden history not in default list | can opt in via filter |

## G3 — REV-C (required)

| ID | Acceptance | Expected result |
|---|---|---|
| C01 | No overwrite of user local changes | pre/post git diff |
| C02 | No unapproved B01–B14/IAM writes | read/write ledger + postquery |
| C03 | AppShell, navigation, IAM unaffected | focused regression PASS |
| C04 | Scan and release lock prevent candidate auto-load | Host guard tests PASS |
| C05 | Negative permissions/route collision tests | 401/403/409/422 paths |
| C06 | Fixture test leaves no new FBET leftovers | postcheck and list |
| C07 | Backend typecheck/build, frontend typecheck/build | exact command & exit 0 |
| C08 | Unit/contract/integration/e2e for changed paths | actual counts, skipped explicit |
| C09 | `SYSTEM_TEST 1.2.0` not auto activated | unchanged ACTIVE baseline |
| C10 | Reports sanitized, TXT/JSON export works | artifact and content checks |

## Tình huống hệ thống (end-to-end)

**E2E-01 New module (fixture an toàn):** scan→candidate→preflight→plan→install→postcheck, no manual MIC; nếu integration DB write không được phép, use isolated test runner và mark live NOT_TESTED.

**E2E-02 Already registered DRAFT with template:** MIC snapshot differs; user sees diff; commit service updates stored MIC then fresh read back; no 1.2.1 forced.

**E2E-03 UPGRADE ACTIVE:** candidate READY, prepare cannot cutover without verified recovery; ACTIVE old still works and B02 unchanged. Có approved recovery thì test failure injection + success, otherwise expected BLOCKED.

**E2E-04 Navigation 3-level:** new function under AREA/MENU, no legacy, sidebar matching permissions, no duplicate when hidden link exists.

**E2E-05 Invalid API contract:** missing field in 200 response detected by contract test and UI error, no fake PASS.

**E2E-06 Restart:** AWAITING_RESTART persists, reopen workspace and Continue after hashes verified; no automatic production deploy.

## Release gate

- DONE = all required G0/G1/G2/G3 meet, permitted cases fully tested, no protected unresolved blocker.
- PARTIAL = implementation completed but required safe acceptance cannot run; state what specifically remains and how it is gated.
- BLOCKED = safety-protected change/recovery lacks approval; do **not** bypass just to mark DONE.
- Output exact IDs of failed/not-tested gates; no vague "all tests pass" claims.
