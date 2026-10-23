# FMI-01 — Implementation Runbook (Claude Code)

## Baseline local là nguồn sự thật

Repository ở Windows: `D:\Documents\ClaudeProject\TALO-MOS-V4`.

GitHub feature branch có thể chậm so với source local; trước khi chỉnh code phải ghi:

```powershell
git status --short
git branch --show-current
git log -1 --oneline
(Get-Content .\modules\SYSTEM_TEST\module.json -Raw | ConvertFrom-Json).packageVersion
```

Không `git reset --hard`, `git clean -fd`, force checkout, push/merge/deploy. Không sửa DATABASE_URL một cách mù quáng hoặc in full env URL chứa mật khẩu.

## Những file cần đọc trước

- `backend/src/app.ts`, `backend/src/server.ts`.
- `backend/src/modules/foundation/index.ts`, `foundation.routes.ts`, `foundation.service.ts`, `foundation.repository.ts`, `foundation.access.ts`, `foundation.permissions.ts`, `foundation.mic.ts`, `foundation.versions.*`, `foundation.navigation.*`.
- `backend/scripts/modules-sync.mjs`, `backend/src/module-host/{contract,loader}.ts`.
- `frontend/src/pages/foundation/ModuleScreen.tsx`, `frontend/src/services/foundation/foundationApi.ts`, `frontend/src/routes/shellScreens.ts`, `frontend/src/layouts/AppShell.tsx`.
- Test suites foundation/module-host/IAM hiện hữu.

## Cấu trúc source đề xuất

Backend trong `backend/src/modules/foundation/`:

- `foundation.module-scan.routes.ts`
- `foundation.module-scan.service.ts`
- `foundation.module-scan.files.ts`
- `foundation.module-scan.validation.ts`
- `foundation.module-scan.types.ts`

Frontend:

- `frontend/src/pages/foundation/ModuleScanButton.tsx`
- `frontend/src/pages/foundation/ModuleScanResults.tsx`
- `frontend/src/pages/foundation/ModuleScanDetailDrawer.tsx`
- `frontend/src/services/foundation/moduleScanApi.ts`

Được gom file nếu hợp lý; không tạo placeholder vô dụng. Integrate module routes vào Foundation index.ts; UI trong ModuleScreen hiện hành.

## Quy trình A–F

**A. Baseline:** trạng thái Git, modules, loaded packages, tests, cơ chế modules-sync; không chạy npm prehooks khi chưa xác định ảnh hưởng candidate.

**B. Backend:** secure read-only scanner; 20 checks, MIC schema, registry select, conflict rules, hashes, snapshot/TTL, API, Auth, requestId.

**C. Frontend:** nút chỉ manual, bars, search, filter, detail drawer, error messages, loading/empty/expired.

**D. Runtime Guard:** bảo vệ candidate, unit tests module-sync, không làm mất installed baseline; nếu không an toàn báo blocker.

**E. Verification:** unit, API, UI, module-host tests, typechecks/builds, safe regressions; real TEST DB only with guard.

**F. Report:** docs actual, evidence, git diff, local commit khi all required PASS và không vô tình add secrets; không push.

## Commands tham khảo (chỉ dùng sau khi xem baseline và prehooks)

```powershell
cd D:\Documents\ClaudeProject\TALO-MOS-V4\backend
npm run typecheck
npm test
npm run build
cd ..\frontend
npm run typecheck
npm run build
```

Nếu `npm test` chứa DB-integrations có write hoặc prehook sync nguy hiểm, chạy bài test phù hợp an toàn trước và báo những suite chưa chạy, không ép chạy full để đủ PASS.

## Báo cáo cuối bắt buộc

1. DONE/PARTIAL/BLOCKED, nêu lý do.
2. Baseline branch/HEAD/uncommitted files.
3. Danh sách file chỉnh sửa.
4. API contract thực tế + quyền.
5. MIC legacy và package mới.
6. Host runtime sync risk đã xử lý thế nào.
7. T01–T22 evidence.
8. DB write evidence (authorized scanner read-only, unauthorized DENIED audit expected).
9. Frontend build, Backend typecheck, regression.
10. Run guide (chỉ một nút Quét Module).
11. Local commit SHA nếu có, không push.
12. Known limitations/FMI-02 handoff.
