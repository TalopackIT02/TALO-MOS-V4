# FMI-01 — Báo cáo triển khai

**Kết luận:** xem báo cáo cuối của phiên (DONE/PARTIAL) — tài liệu này mô tả thực tế đã làm.

## 1. Baseline (trước khi sửa)

- Nhánh `feat/system-test-diagnostics-v1-1`, HEAD `e456996`, working tree sạch.
- Package: SYSTEM_TEST 1.1.1, DATA_INSPECTOR 0.1.0 (cả hai đã cài, `installed-modules` = nguồn).
- `npx vitest run`: 365 PASS / 166 skipped; tsc sạch; Host 8/8. sha256 `registry.ts`: backend `c2a1dd66…`, frontend `a6d6dfa5…`.
- Rủi ro xác nhận: `modules-sync.mjs` (prehook của dev/build/test/typecheck) xóa `installed-modules` rồi chép **mọi** folder hợp lệ → candidate chép vào `modules/` sẽ được nạp. Đã tái hiện bằng test ("baseline risk reproduced").

## 2. Tệp đã thêm / sửa

Backend: `scripts/module-package.mjs` (+ `.d.mts`) mới; `scripts/modules-sync.mjs` (+ `.d.mts`) sửa; `module-deployments.json` mới; `src/modules/foundation/foundation.module-scan.{types,files,validation,service,routes}.ts` mới; `src/modules/foundation/index.ts` (gắn router/service). Test: `test/unit/foundation/foundation.module-scan.test.ts`, `test/integration/foundation/foundation.module-scan.db.test.ts` mới; `test/unit/module-host/module-host.test.ts` (thêm 6 test runtime guard; test "mọi folder đều được cài" đổi thành "mọi package trong khóa đều được cài").

Frontend: `services/foundation/moduleScanApi.ts`, `pages/foundation/ModuleScan.tsx`, `styles/module-scan.css` mới; `pages/foundation/ModuleScreen.tsx` (nút + kết quả). Playwright: `tests/e2e/module-scan.e2e.spec.ts`.

Không thêm dependency. Không sửa schema/migration/Prisma, IAM, lifecycle, Host protocol, navigation, SYSTEM_TEST, DATA_INSPECTOR.

## 3. Scanner

Chỉ đọc; không import/eval/spawn mã package (có test kiểm tra mã nguồn). Dùng lại `validateManifest()` của Host loader và `micSchema` / `validateMic()` của Foundation. 20 check MS-01…MS-20, phân loại theo Registry (SemVer so số), xung đột route (route admin AppShell, folder khác, route ACTIVE của module khác; cho phép module nâng cấp dùng lại route của chính nó), MIC-10 chỉ là khai báo (WARN), hash ổn định, khóa 1 lượt/tiến trình, snapshot RAM 10 phút × 10.

## 4. MIC legacy và package mới

- Package mới: `mic/module.mic.json` bắt buộc (thiếu → FAIL `MIC_FILE_MISSING`).
- Package đã đăng ký chỉ có MIC TypeScript (SYSTEM_TEST, DATA_INSPECTOR hiện nay): WARN `LEGACY_MIC_FORMAT`, không import mã, không đủ điều kiện Preflight; runtime của chúng không bị ảnh hưởng.

## 5. Runtime guard (06_HOST_RUNTIME_GUARD)

Giải pháp nhỏ nhất: **khóa triển khai** `backend/module-deployments.json` (TALO-MODULE-DEPLOYMENT-1) ghim moduleKey + packageVersion + packageHash của package đã chấp thuận (giá trị lấy từ đúng mã đang chạy — đã diff installed = nguồn). `syncModules` kiểm tra mọi thứ **trước** khi xóa `installed-modules`; CLI bắt buộc có khóa. Không có khóa (chỉ dùng trong test) → hành vi cũ. Kết quả sync với khóa trùng từng byte `registry.ts` đang chạy. Scanner vẫn thấy mọi folder; Host chỉ thấy package trong khóa.

## 6. Giới hạn / rủi ro còn lại

1. Sửa mã một module đã triển khai cần cập nhật khóa (`modules-sync.mjs hash <KEY>`), nếu không `npm run dev/build/test` dừng — chủ ý để không nạp mã chưa duyệt.
2. Khoảng thời gian giữa kiểm tra hash và chép tệp trong `modules:sync` (cùng một tiến trình, cục bộ) chưa được khóa; chấp nhận cho môi trường dev.
3. Scanner (`src/`) import `backend/scripts/*.mjs`; bản build `dist/` cần thư mục `backend/scripts` đi kèm (cùng độ sâu thư mục nên đường dẫn tương đối đúng). Chưa kiểm production build chạy thật.
4. Junction đã kiểm; symlink tệp (cần quyền admin Windows) chưa kiểm.
5. TEST còn module fixture `FBET_ST_MVJQQP1S_0383C3` ACTIVE trùng route SYSTEM_TEST (scanner báo FAIL đúng) — cần chủ dự án quyết định.
6. Test iam-admin còn kỳ vọng DATA_VIEWER (SYSTEM_TEST 1.0.3) trong khi TEST đã ACTIVE 1.1.1 — test cũ, ngoài phạm vi FMI-01.

## 7. Bàn giao FMI-02

Đầu vào: `scanId`, `packageHash` (TALO-PACKAGE-HASH-1), `moduleKey`, `packageVersion`, classification, issues, `eligibleForPreflight`. `eligibleForPreflight` chỉ cho phép chuẩn bị Preflight. Khi chấp thuận triển khai một package, cập nhật `module-deployments.json` bằng chính `packageHash` đã kiểm thử (hash thay đổi → bằng chứng cũ mất hiệu lực).
