# FINAL — FOUNDATION-REV-01: PARTIAL

Mã REV-A/REV-B/REV-C đã triển khai và kiểm thử. PARTIAL vì hai cổng cần quyết định của chủ dự án (không vượt rào):

## Quyết định cần chủ dự án (một trang)

| Decision ID | Bước bị chặn | Thay đổi được bảo vệ cần duyệt | Phương án / rủi ro | Mặc định an toàn | Test làm được không cần quyết định |
|---|---|---|---|---|---|
| REV01-D1 Recovery nâng cấp ACTIVE (A12, E2E-03) | Cutover SYSTEM_TEST 1.1.1 → 1.2.0 (ACTIVATE retire 1.1.1) | `foundation.lifecycle.service/repository` (đường phục hồi RETIRED → ACTIVE hoặc kích hoạt hai pha) + audit B07/B08 | A: cutover hai pha có thể đảo ngược; B: service recovery có IAM/audit; C: giữ chặn | C (đang áp dụng: `UPGRADE_RECOVERY_UNAVAILABLE`) | Candidate/Preflight/Plan READY, plan BLOCKED, ACTIVE cũ không đổi (đã test) |
| REV01-D2 Grant IAM catalog | Bước IAM_CATALOG mọi lượt cài trên TEST | `GRANT INSERT ON iam.iam_permissions TO talo_iam_admin` (chưa cấp trong Phase B) | Cấp grant hoặc tạo quyền thủ công qua quy trình IAM đã duyệt | Chặn `IAM_DB_GRANT_MISSING` trước mọi ghi | Đường cài đầy đủ đã chạy trên DB thật với catalog thay thế của test (harness) |
| REV01-D3 (đề xuất) ENABLE kiểm route trùng | Bật lại module fixture vẫn giữ route ACTIVE | `foundation.lifecycle.service` (protected) | Thêm kiểm route trước ENABLE | Cảnh báo ở scanner/plan/modal Bật module | — |

## Rollback mã
Toàn bộ thay đổi chưa commit: `git diff` / `git status` (20 tệp sửa, 3 mới, 2 xóa). Không đổi DB schema; dữ liệu TEST chỉ thêm fixture đã dọn (backup `cf97f299…`).

## Git
Không commit (acceptance chưa đủ DONE), không push / merge / deploy.
