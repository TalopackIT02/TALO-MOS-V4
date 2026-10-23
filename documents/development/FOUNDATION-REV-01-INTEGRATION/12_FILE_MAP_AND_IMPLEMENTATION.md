# 12 — FILE MAP & MINIMUM-DELTA IMPLEMENTATION

## Nguyên tắc

Sửa ít nơi nhất nhưng đúng kiến trúc; chia pha theo dependency graph; giữ nguyên `MIC-1.0`, Host Protocol, B01–B14 schema. Tránh sinh thêm framework/custom API mới không cần thiết.

## Source map được xác nhận trên GitHub b7b5f071

| Package/file | Vai trò | Action REV-01 |
|---|---|---|
| `frontend/src/pages/foundation/ModuleScreen.tsx` | Danh sách, quét, candidate, version đang trộn | Tách list và workspace routing |
| `frontend/src/pages/foundation/VersionPanel.tsx` | MIC template/manual lifecycle | Remove template from default package path, drawer history/advanced |
| `frontend/src/pages/foundation/ModuleScan.tsx` | Scan button/results/drawer | Reuse and compact |
| `frontend/src/pages/foundation/ModuleInstaller.tsx` | Preflight/plan/install all inline | Move long flow into workspace, use detail drawer |
| `frontend/src/pages/foundation/NavigationBuilder.tsx` | Tree/inventory/editor/preview | Keep DnD+draft, refactor interaction into drawer/popup |
| `frontend/src/pages/foundation/navigationDraft.ts` | Navigation draft state logic | Preserve semantics; tests for moves/links |
| `frontend/src/routes/shellScreens.ts` | Admin screen access, path routing | Add guarded candidate workspace path, preserve tab nav |
| `frontend/src/services/foundation/foundationApi.ts` | Client registry/versions/nav parse | Align data contract; share error semantics |
| `frontend/src/services/foundation/moduleScanApi.ts` | FMI client | Extended API only if necessary |
| `frontend/src/styles/{foundation,module-scan,navigation-builder}.css` | UI style | Use existing tokens/components, responsive |
| `backend/src/modules/foundation/foundation.installer.service.ts` | FMI-03 Installer / compose MIC/upgrade | P0: lift unsupported arbitrary block with real gate/strategy; 3-level nav; postcheck |
| `backend/src/modules/foundation/foundation.installer.routes.ts` | FMI endpoints | Keep envelopes/session |
| `backend/src/modules/foundation/foundation.installer.store.ts` | Candidate/release journal | Preserve atomic/restart semantics |
| `backend/src/modules/foundation/foundation.installer.iam.ts` | IAM catalog | Preserve policy; report assignment separately |
| `backend/src/modules/foundation/foundation.preflight.ts` | P0–P7 | Add truthful authenticated/client contract check |
| `backend/src/modules/foundation/foundation.module-scan.*` | FMI-01 | Keep manual, route conflict/fixture checks |
| `backend/src/modules/foundation/foundation.mic.ts` | MIC validator | Reuse, do not fork |
| `backend/src/modules/foundation/foundation.manifest.service.ts` | B02 DRAFT/MIC/audit | Keep service; explicit safe apply |
| `backend/src/modules/foundation/foundation.lifecycle.service.ts` | B02 state gates | **Protected**: modify only after owner approval |
| `backend/src/modules/foundation/foundation.navigation.{service,builder,repository}.ts` | B09 menu save and validation | Reuse shared planner; don't second builder |
| `backend/scripts/modules-sync.mjs` | Immutable release lock/store loader | Preserve; test candidate isolation |
| `backend/src/module-host/*` | Host runtime | Do not change protocol or mount flow unless needed with tests |
| `backend/test/{unit,integration}/foundation/*` | Domain tests | Add regression/negative tests |
| `tests/e2e/{module-scan,module-installer,navigation-builder}.e2e.spec.ts` | E2E UI | Update journeys + keyboard/responsive |

## Pha công việc và phạm vi sửa

### Phase 0 — Discover

Check local source and test commands. Snapshot hashes of current ACTIVE modules/lock/sidebar. Identify which files on local are newer than GitHub; no checkout. Generate evidence/BASELINE.md.

### Phase 1 — Contract + safety first

Add tests reproducing (1) B02 MIC template mismatch; (2) upgrade blocked; (3) B09 two-level / hidden link; (4) authenticated API contract gap. No database modification. Establish expected behavior before editing logic.

### Phase 2 — REV-A backend integration

Apply small changes to Candidate/MIC, upgrade prepare and rules, B09 shared planner, IAM postcheck reporting, authenticated checks. Keep upgrade ACTIVE blocked until recovery approval. Fix clear bugs and add compatibility tests first.

### Phase 3 — REV-B frontend

Refactor ModuleScreen into list + Candidate Workspace; guards and breadcrumb; reuse scan drawer, create common detail drawer; convert NavigationBuilder editor/inventory to drawer without altering save planning. Accessibility.

### Phase 4 — REV-C verification

Test matrix 11, release lock sync guard, live TEST only when safe, package hash/evidence, no data loss, UI visual check. Fix within-scope regressions and rerun.

### Phase 5 — Close

`git diff --check`, test status, generated evidence & documents (not secrets), optional local commit when acceptance complete; no push/deploy. Report DONE/PARTIAL/BLOCKED exact gate IDs.

## Agent discipline

- Find symbols/files first (`rg`), read targeted ranges; no blanket `cat` thousands of lines.
- Track todo file ownership; edit related files as an atomic logical patch.
- Don't regenerate generated registry by unsafe prehooks before verifying deployment lock.
- Avoid long chat dumps of tests; save report locally with summarized counts.
- Do not manufacture API status types to mask response mismatch.
