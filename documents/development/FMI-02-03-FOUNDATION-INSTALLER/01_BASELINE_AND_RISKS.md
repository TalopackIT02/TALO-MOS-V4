# 01 — Baseline, hiện trạng và điều kiện tiên quyết

## Những điều đã đối chiếu trên GitHub (branch `feat/iam-management-foundation-20261019`, HEAD a65e673 tại thời điểm xem)

1. `backend/scripts/modules-sync.mjs`: `syncModules()` liệt kê mọi folder `modules/*`, chạy `rmSync(outDir)` rồi copy backend/frontend và sinh registry. Các npm `predev`, `prebuild`, `pretest` có thể gọi modules:sync; **candidate local có thể ghi đè artifact runtime**.
2. `backend/src/module-host/loader.ts`: Host chỉ mount những package được build vào generated registry, không tự đọc bản mới khi một route được mở.
3. `backend/src/modules/foundation/foundation.lifecycle.service.ts`: Activate gate yêu cầu MIC10 tất cả `PASS`, integrity và compatibility.
4. `foundation.lifecycle.repository.ts`: ACTIVATE tự RETIRE ACTIVE cũ trước khi chuyển APPROVED thành ACTIVE; không có public route RETIRED → ACTIVE. Không thể coi copy folder cũ là rollback DB hợp lệ.
5. `backend/src/modules/iam-admin/iam.admin.repository.ts`: tạo permission catalog yêu cầu MIC của version ACTIVE đã hash-intact; quyền nền tảng IAM/FOUNDATION có chính sách bootstrap riêng; root admin có bảo vệ đặc biệt.
6. `foundation.navigation.repository.ts`: B09 hiện hỗ trợ CREATE/PATCH title/order/visible, không DELETE public; Function mapping đến version ACTIVE.
7. `backend/src/app.ts`: `/api` hiện có session/origin/no-store/JSON parser; tất cả API mới phải reuse.
8. Module mới có thể khai báo MIC-JSON, nhưng Host hiện chấp nhận `micEntry` TypeScript; không eval TS từ candidate khi scan.

**CẢNH BÁO:** Mã mới FMI-01 ở máy local và bản source SYSTEM_TEST 1.1.1/1.2.0 có thể khác GitHub. Claude phải đọc và tôn trọng local; không checkout/reset/ghi đè.

## Blockers phải xác minh trên TEST trước thay đổi

- Danh sách chính xác module FBET active đang chiếm hai route, provenance fixture, owner, `is_enabled`, B09 descendant, IAM references, audit; không xác định qua tiền tố tên một mình.
- Trạng thái thật và hash/candidate của SYSTEM_TEST 1.1.1 ACTIVE, 1.2.0 DRAFT; trạng thái DATA_INSPECTOR 0.1.0 ACTIVE.
- Baseline endpoint/login/Sidebar/Frontend runtime; port, DB target, nguồn installed-registry.
- Có deploy supervisor an toàn hoặc chưa; không có thì phải báo `DEPLOY_RESTART_REQUIRED` và fail closed.
- Quyền dữ liệu PostgreSQL cho engine đọc B01..B14, IAM catalog và chạy test staging; không tự GRANT.
- Tình trạng backup custom format + SHA-256; kiểm bằng `pg_restore -l` và khôi phục thử nếu có sandbox phù hợp.

## Invariants sau triển khai

- Chỉ một version ACTIVE cho mỗi module (theo DB constraint), không có window ACTIVE giả.
- Mỗi candidate được gắn `moduleKey`, `version`, `packageHash`, `scanId`, `preflightRunId`, `environment`, `testResults`.
- Candidate không thay đổi code runtime đang chạy.
- Audit/history B07/B08 và IAM audit giữ nguyên; không có xoá lịch sử.
- Đồng bộ package và kích hoạt phải có traceId, nhật ký host-side, tham chiếu report, trạng thái có thể đọc lại.
- Mọi hành động destructive hoặc nâng cấp version ACTIVE phải có backup và rollback/cutover chứng minh bằng test.
