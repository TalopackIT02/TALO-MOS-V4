# PROMPT GỬI CLAUDE CODE — FMI-01 MANUAL MODULE SCAN

Bạn đang làm việc trực tiếp trên repository local TALO-MOS-V4 ở:

`D:\Documents\ClaudeProject\TALO-MOS-V4`

## 0. MỆNH LỆNH

**LẬP TRÌNH NGAY chức năng FMI-01 — Manual Module Scan cho Foundation**, thực hiện một lượt liên tục từ khảo sát, code, tests, sửa lỗi trong phạm vi, đối chiếu regression, đến báo cáo và tài liệu. Không chỉ lập kế hoạch. Không chờ xác nhận sau từng giai đoạn nếu bước tiếp theo an toàn và thuộc phạm vi.

Bộ yêu cầu nằm trong:

`documents/development/FMI-01-Manual-Module-Scan/`

**ĐỌC ĐẦY ĐỦ** tất cả các file trong thư mục này (00–10), ưu tiên hợp đồng chi tiết hơn suy đoán. Nếu yêu cầu hồ sơ xung đột với implementation thật, bảo vệ hệ thống và nêu rõ khác biệt trước khi chọn giải pháp tương thích. Không tự mở rộng sang FMI-02 hoặc FMI-03.

## 1. MỤC TIÊU NGƯỜI DÙNG

AI đã tạo folder hoàn chỉnh trong `modules/MODULE_KEY` (Backend, Frontend, MIC, manifest, tests). Người dùng mở Foundation → Quản lý Module, **nhấn nút Quét Module**. Backend đọc folder và MIC JSON, đánh giá tĩnh và phân loại với Registry, UI có ba thanh đỏ/vàng/xanh, danh sách, drawer chi tiết. Khi lỗi người dùng sửa folder, nhấn lại. Không phải dán MIC, không tạo version khi scan, không chạy fix vòng vèo.

**Nghiêm cấm auto-scan** trên startup/login/load/refresh/readdir watcher/interval. Chỉ quét do POST manual chủ động từ UI.

## 2. BASELINE VÀ PHẠM VI

- Local source là nguồn sự thật. SYSTEM_TEST local có thể là 1.1.1; GitHub có bản cũ. Không reset, checkout đè, xóa uncommitted changes.
- Chỉ database TEST `talo_mos_v4_test`; không đụng DEV/PROD. Không DB migration/schema change/SQL GRANT.
- Không thay đổi IAM, Foundation lifecycle, Host protocol hay navigation hiện hành ngoại trừ tích hợp nhỏ bắt buộc của scanner.
- Không sửa DATA_INSPECTOR/SYSTEM_TEST package đang hoạt động; không thay đổi B01–B14, IAM grant, B09, ACTIVE/ENABLED.
- Không PUT/SUBMIT/APPROVE/ACTIVATE/ENABLE/DISABLE; không push/merge/deploy.
- Cho phép local commit sau khi toàn bộ yêu cầu PASS và đã rà diff; không commit secrets.
- Không cài thêm package mới nếu không thật sự cần, ưu tiên dependencies hiện có.

## 3. ĐỌC/CHECK TRƯỚC KHI CODE

1. `git status --short`, branch, HEAD; liệt kê uncommitted files và version các installed packages.
2. Đọc chính xác: `backend/scripts/modules-sync.mjs`, `backend/src/module-host/{contract,loader}.ts`, `backend/src/server.ts`, `backend/src/app.ts`.
3. Đọc Foundation `index.ts`, Registry service/repository, `foundation.permissions.ts`, `foundation.access.ts`, `foundation.http.ts`, `foundation.mic.ts`, version/MIC/navigation/lifecycle files.
4. Đọc UI `frontend/src/pages/foundation/ModuleScreen.tsx`, `frontend/src/services/foundation/foundationApi.ts`, `frontend/src/routes/shellScreens.ts`, `AppShell.tsx` và CSS hiện hành.
5. Chụp baseline route/menu/Host installed list và test hiện có.
6. **RÀO ĐẶC BIỆT:** `modules:sync` hiện scan/copy mọi valid folder vào installed registry trong npm prehooks. Không chạy các lệnh có prehook trước khi xác minh chúng không ghi đè modules đang hoạt động.

## 4. CODE BACKEND

- Implement API `POST /api/foundation/module-packages/scan` (body `{}`) và `GET /api/foundation/module-packages/scans/:scanId` (read snapshot).
- Auth Foundation session hiện hành, `AccessGuard` check đồng thời `foundation.module_registry.read` và `foundation.module_registry.create`, audit DENIED như hiện tại. Không tạo permission mới.
- Scan root cố định repo `modules/` từ trusted backend location, không nhận input path. Không gọi modules:sync/child_process/import/eval vào code package.
- Duyệt mọi folder cấp một, bao gồm folder invalid; báo lỗi từng folder thay vì fail cả scan khi có một package hỏng.
- Dùng `validateManifest()` (tách reusable validator nếu cần, bảo toàn CLI behavior), `micSchema`/`validateMic()` gốc. Đọc `mic/module.mic.json` data-only. Nếu `.ts` legacy-only: `LEGACY_MIC_FORMAT`, không import TS.
- 20 check MS-01..MS-20 theo `04_SCAN_RULES.md`, có issue code, path/field, expected/actual sanitized, remediation.
- Registry SELECT: phân loại `NEW_MODULE`, `UPGRADE_CANDIDATE`, `EXISTING_VERSION`, `OLDER_PACKAGE`, `INVALID_PACKAGE`, `REGISTRY_UNKNOWN`; version SemVer numeric. Không đoán NEW_MODULE nếu query lỗi.
- Route conflict: giữa các module/Host admin route; giữ reuse route của cùng module ở bản nâng cấp.
- MIC10 declared PASS không phải verified PASS; NOT_TESTED cảnh báo, không kích hoạt.
- Snapshot RAM TTL 10 phút, max 10, scan lock concurrent max1; giới hạn 250 folder, 1500 files/package, 25MiB/package; filesystem symlink/junction/path race fail closed.
- Package SHA256 deterministic. Nếu file thay đổi trong scan, không tạo hash PASS.
- Response đúng `03_API_CONTRACT.md`; không log secrets/source contents/absolute path.
- Authorized scan chỉ đọc filesystem/DB, không B01–B14/IAM/B09 writes. Giữ chính xác quy tắc B08 DENIED audit với unauthorized.

## 5. CODE FRONTEND

- Tích hợp nút Quét Module ở `ModuleScreen.tsx` tab Module & Phiên bản cạnh nút Tải lại.
- Chỉ hiển thị nếu có **cả** READ + CREATE effective capability. Server vẫn check lại.
- Ba thanh đỏ vàng xanh tính theo số package FAIL/WARN/PASS. UNAVAILABLE riêng, không tính xanh giả.
- Danh sách package với tìm kiếm, lọc status, thời gian quét, tổng số check, version và classification.
- Drawer detail bên phải tối đa ~680px; sections overview/MIC/checks/issues/registry/hash; nút đóng, Escape, backdrop, focus/accessibility, responsive mobile. Không bung detail dưới bảng.
- Không scan tự động trong useEffect; không auto-retry POST. Thể hiện loading, empty, 401, 403, 409, offline, snapshot expired, UNEXPECTED_RESPONSE.
- Dùng AppShell/CSS existing, không thêm UI framework mới.

## 6. HOST RUNTIME SAFETY — CHỐT LỖI NỀN TẢNG

`backend/scripts/modules-sync.mjs` được npm prehooks gọi và có logic xóa/copy `installed-modules`. Nếu candidate folder chưa READY được chép vào `modules/`, npm dev/build có thể nạp nó vào runtime trước khi nhấn scan, làm lệch bản ACTIVE.

- Chứng minh bằng test baseline và fixture cô lập.
- Tách rõ filesystem scanner (xem mọi candidate) và runtime installed package selection (chỉ code deployed đã được chấp thuận).
- Chọn giải pháp **nhỏ nhất an toàn**, có backward compatibility cho các modules installed hiện tại; không thay toàn bộ Host/lifecycle.
- Không tạo allowlist rỗng làm mất SYSTEM_TEST/DATA_INSPECTOR, không import candidate để validate.
- Chạy regression sau thay đổi. Nếu không chứng minh được bảo vệ runtime mà vẫn an toàn, báo PARTIAL/BLOCKED, không nhận DONE và không tự sửa lifecycle/IAM.

## 7. TESTS

Triển khai ma trận T01–T22 tại `07_TEST_ACCEPTANCE.md`, gồm:

- Không auto-scan.
- Missing/invalid manifest, moduleKey, SemVer, MIC, Host capability, route conflict.
- MIC K05, MIC09, MIC10 NOT_TESTED/PASS unverified.
- Same module upgrade reuse route.
- Registry outage fail-closed.
- Existing approved/active immutable.
- IAM 401/403, cả hai quyền, DENIED audit.
- Duplicate scan 409, snapshot expiration/invalid ID.
- Symlink/junction/path traversal/limits/content mutation/hash.
- One broken folder doesn't block others.
- Authorized scan no DB write.
- No runtime package replacement from candidate in predev/build.
- UI drawer and loading/error states.
- Backend/frontend typecheck, build and related regression.

**Không sửa/xóa assertion để lấy PASS giả; không gán PASS cho test chưa chạy.** Nếu tests có DB writes, chỉ chạy sau khi kiểm tra TEST guard, backup, fixture cleanup; nếu không đủ điều kiện phải ghi NOT_TESTED.

## 8. CÁCH THỰC HIỆN MỘT LƯỢT

A. Baseline, ghi risks và chụp trạng thái chưa sửa.

B. Triển khai Scanner Backend + routes + static MIC/registry validations.

C. Tích hợp UI nút Quét + bảng + 3 thanh + drawer.

D. Giải quyết host runtime guard an toàn, không thay đổi các module hiện hành.

E. Chạy tests/typecheck/build/regression có kiểm soát; sửa lỗi triển khai trong scope, chạy lại đến khi pass hoặc có blocker thực.

F. Cập nhật tài liệu **thực tế sau triển khai** trong `documents/development/FMI-01-Manual-Module-Scan/implementation-evidence/` gồm `TEST-RESULTS.md`, `IMPLEMENTATION-REPORT.md`, `API-IMPLEMENTED.md`, `RUN-GUIDE.md`. Không ghi claim không có evidence. Rà `git diff --check`, git status; local commit nếu all required PASS và rõ ràng, KHÔNG PUSH.

Không dừng và hỏi ở mỗi phase. Nếu blocker ảnh hưởng hệ thống vượt phạm vi, thực hiện phần an toàn còn lại, báo blocker minh bạch.

## 9. KẾT LUẬN CHỈ ĐƯỢC GHI

- **DONE**: Scanner API+UI chạy thật; T01–T22 gates bắt buộc PASS; không DB write; runtime guard chứng minh installed ACTIVE không thay đổi; backend/frontend build/regression PASS.
- **PARTIAL**: Có phần đã làm nhưng thiếu bằng chứng/test hoặc một yêu cầu chưa đạt.
- **BLOCKED**: Không thể hoàn thành an toàn vì ràng buộc chưa thể xử lý trong scope.

Báo cáo cuối: baseline branch/HEAD, tất cả modified files, endpoints/permission, MIC legacy, runtime guard, test matrix actual PASS/FAIL/NOT_TESTED, DB verification, UI access guide, local commit nếu có, outstanding risks và FMI-02 handoff.

**BẮT ĐẦU TRIỂN KHAI NGAY**, không mở rộng FMI-02/03, không thay đổi version/module hoặc môi trường database trái quy định.
