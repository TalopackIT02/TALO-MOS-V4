# CLOSURE-TEST-RESULTS

Log nằm trong `$OUT` = `D:/Documents/ClaudeProject/TALO-MOS-V4_exports/REV-01-20261023-135930/CLOSURE-20261024-110735/`.

## Lệnh, exit code, kết quả

### Unit và Playwright

| # | Lệnh (cwd) | Exit | Kết quả | Log |
|---|---|---|---|---|
| 1 | `npx vitest run test/unit/foundation/foundation.lifecycle.routes.test.ts` (backend), D3 RED, tạm tắt guard | 1 | 3 failed / 3 passed | `t-d3-red.log` |
| 2 | `npx vitest run test/unit/foundation/foundation.installer.test.ts -t "REV01-D1"`, D1 RED, gate cũ | 1 | 9 failed / 1 passed | `t-d1-red.log` |
| 3 | `npx vitest run test/unit/foundation` | 0 | 14 files, 233 passed (trước khi thêm file D1) | — |
| 4 | `npx vitest run …lifecycle.recovery.test.ts` | 0 | 5/5 | — |
| 5 | `npx vitest run …installer.test.ts` | 0 | 34/34 | — |
| 6 | `npx playwright test candidate-workspace-layout.e2e --project=react-dev` (tests), UI-01 RED / GREEN | 1 / 0 | 13 failed → 13 passed | `t-ui01-red.log`, `t-ui01.log` |

### DB TEST (`TALO_FOUNDATION_DB=1 npx vitest run …`)

| # | Suite | Exit | Kết quả | Log |
|---|---|---|---|---|
| 7 | `foundation.lifecycle.db.test.ts` | 0 | 12/12 (gồm REV01-D1-DB, REV01-D3-DB, FP5-1 với 3 SQL mới) | `t-lifecycle-db.log` |
| 8 | `foundation.installer.db.test.ts --silent=false --reporter=verbose` | 0 | 2/2 (D2 IAM thật, D1 upgrade → RECOVERED → 1.2.0) | `t-installer-db.log` |
| 9 | `foundation.navigation.db.test.ts` | 1 | 14 passed / 1 failed: **V8, có sẵn** (2 quyền `data_inspector.*`) | `t-db-navigation.log` |
| 10 | `foundation.module-scan.db.test.ts` | 0 | 2/2 | `t-db-module-scan.log` |
| 11 | `foundation.registry.db.test.ts` | 0 | 10/10 | `t-db-registry.log` |
| 12 | `foundation.acceptance.db.test.ts` | 1 | 2 skipped: **beforeAll có sẵn** (cùng nguyên nhân V8, chỉ đọc) | `t-db-acceptance.log` |
| 13 | `foundation.data.db.test.ts` | 0 | 10/10 | `t-db-data.log` |
| 14 | `foundation.versions.db.test.ts` | 0 | 18/18 | `t-db-versions.log` |
| 15 | `system-test.db.test.ts` | 0 | 2/2 | `t-db-system-test.db.test.log` |
| 16 | `foundation.db.test.ts` | 0 | 15/15 | `t-db-foundation.db.test.log` |
| 17 | `TALO_IAM_ADMIN_DB=1 … iam-admin.db.test.ts` | 0 | 5 skipped (cần gate riêng, ngoài phạm vi) | `t-db-iam-admin.log` |

### Hồi quy backend, frontend, Playwright

| # | Lệnh (cwd) | Exit | Kết quả | Log |
|---|---|---|---|---|
| 18 | `npm run typecheck` (backend) | 0 | src + test sạch | `t-backend-typecheck.log` |
| 19 | `npm test` (backend), chạy 3 lần | 1 | Lần 1: 1 timeout IN-04 (đã nâng timeout describe lên 20s). Lần 2 và 3: **445 passed / 2 failed / 172 skipped** | `t-backend-npm-test.log`, `t-backend-npm-test-2.log` |
| 20 | `npx vitest run test/model/sc5/sc5Model.test.ts test/unit/foundation/foundation.module-scan.test.ts` | 0 rồi 1 | Lần 1: 59/59. Lần 2: module-scan limits timeout 50xx ms | `t-backend-timing-isolated.log` |
| 21 | `npm run build` (frontend: typecheck + vite build) | 0 | PASS | `t-frontend-build.log` |
| 22 | `npx playwright test --project=react-dev --project=react-preview` (tests) | 1 | **311 passed / 2 failed / 9 skipped / 6 did not run**. Hai lỗi là `auth-flow.e2e.spec.ts:38`, có sẵn; 6 did not run là khối serial sau auth-flow, giống REV-01 | `t-playwright-final.log` |

Hai lỗi của `npm test` là timeout 5s ở hai test nặng CPU, file **không bị sửa** trong task:
- `sc5Model` H-a exhaustive: 4,5s khi chạy riêng;
- `module-scan` limits 1500 file: khoảng 5s khi chạy riêng.

Hai test này PASS ở lượt REV-01 (426/426). Khi chạy riêng thì lúc PASS, lúc timeout: đây là test nhạy thời gian trên máy này, bị nặng thêm vì suite Installer nay có thêm 10 test D1. Chưa sửa (không đổi timeout của test không liên quan).

Ghi chú: một lượt `npx playwright test` chạy cả project `demo` (không có baseURL cho e2e) cho ra 87 lỗi cấu hình. Lượt đó không dùng làm kết quả; kết quả hợp lệ là dòng 22.

## Trạng thái DB TEST trước / sau

`$OUT/baseline-db.txt` so với `$OUT/final-db.txt`:

| Mục | Trước | Sau |
|---|---|---|
| SYSTEM_TEST / DATA_INSPECTOR (mọi version, status, hash, enabled) | như baseline | **giống hệt** |
| IAM 27 / 25 / 1 / 2 | 27 / 25 / 1 / 2 | **27 / 25 / 1 / 2** |
| Leftovers | 0 / 0 / 0 | **0 / 0 / 0** |
| Lock sha256 | `80c70e4c…` | **`80c70e4c…`** |
| B09 | 896 / 637 | 960 / 683. Fixture append-only của các suite DB; root hiển thị duy nhất là `Develop` |
| Fixture FBET ACTIVE + ENABLED | 208 | 218. Do các suite DB (V6 B01_ENABLE, navigation live modules…); mỗi fixture mới có route riêng của run |

## Sự cố fixture và cleanup

**Lượt lifecycle DB đầu tiên:** test D3-DB mới gọi hai lệnh đọc song song trên một phiên psql, gây "psql session busy". Lỗi lan sang `afterEach` và cleanup bị dừng.

- **Đã dừng ghi test.** ID còn sót của run `FBET-MVLX2VY2_7BD553`:
  - role `5c2695d0-7dcc-4627-9917-e10f4e14496e` (`FBET-MVLX2VY2_7BD553-R11`) và 11 role_permissions;
  - user_role `1d51e711-4959-4b70-a6fe-5a25407d8d20`;
  - account `4a3f892d-0317-48d8-9a46-1f70d4c85170` (`autht-mvlx2wfc-060716-u11`).
- **Đã dọn** theo UUID, có chứng minh ownership: `$OUT/cleanup-run-MVLX2VY2.mts` và `.log`. Kết quả: leftovers 0, IAM về 27/25/1/2. Test đã sửa sang đọc tuần tự và thêm `finally`.
- **Còn lại:** module của run `FBET_MVLX2VY2_7BD553_15` (`a7469591-6307-4a58-adce-72435ad6e9a6`, route riêng `/fbet-mvlx2vy2-7bd553-d3`) vẫn ENABLED. Không tự tắt, vì việc đó cần một actor fixture mới; chờ chủ dự án quyết định.
