# 05 — MẪU BÁO CÁO CLAUDE CODE (CẦN ĐIỀN BẰNG BẰNG CHỨNG THẬT)

## A. Source verified

- Timestamp, `git status -sb`, branch, remote `main` HEAD SHA, local working SHA:
- PR #1 đã đọc/so sánh: YES/NO, head SHA:
- File local có thay đổi trước phiên: …; xử lý không đè file: …
- DB target + runtime role đã xác minh bằng read-only: … / NOT_VERIFIED (không in secrets)
- SYSTEM_TEST 1.0.3 ACTIVE/ENABLED/B09/MIC hash: … / NOT_VERIFIED

## B. Gap và tiến độ

| Ưu tiên | Công việc | BEFORE | AFTER | Bằng chứng/file |
|---|---|---|---|---|
| P0 | IAM Backend API | | | |
| P0 | IAM UI Accounts | | | |
| P0 | IAM UI Roles & Permissions | | | |
| P0 | Navigation B09/Function selector | | | |
| P0 | Tests/build | | | |
| P1 | DB privileges proposal | | | |
| P1 | Admin bootstrap proposal | | | |
| P1 | SYSTEM_TEST allow/deny E2E | | | |

## C. Test thực chạy

| Lệnh/test case | Environment | PASS/FAIL/SKIPPED/NOT_TESTED | Output tóm tắt / log |
|---|---|---|---|
| Backend typecheck | | | |
| Backend unit/HTTP | | | |
| Backend build | | | |
| Frontend typecheck/build | | | |
| PostgreSQL IAM integration | | | |
| Browser E2E allow/deny | | | |
| FRZ-01..08 | | | |

## D. File / Git / Migration

- Danh sách file đã sửa và lý do ngắn:
- Dependencies mới: NONE / xin duyệt …
- `documents/`, MIC, lifecycle, Auth, Foundation core/schema đã bị sửa? NO / ngoại lệ phê duyệt số …
- Commit local SHA (nếu có): …
- Đã push/merge/deploy? NO nếu chưa được duyệt.
- DDL / GRANT / Bootstrap đã thực thi? NO nếu chưa được duyệt.

## E. Phần cần chủ dự án quyết định

1. Đúng permission admin namespace/triple? …
2. Scoped GRANT cho runtime role trên DB nào? … (SQL preview/rollback/negative tests)
3. Admin bootstrap cho account ID nào? … (audit/rollback)
4. Có bắt buộc chạm file protected scope? Nếu có: path, diff, lý do, ảnh hưởng, test; chờ owner duyệt.

## F. Kết luận

- Tổng: DONE / PARTIAL / BLOCKED (chỉ chọn theo evidence).
- Có thể thao tác thật theo UI: …
- SYSTEM_TEST cấp/thu hồi & menu/API đã chứng minh: …
- Chính xác công việc còn thiếu (tối đa 5 mục, theo thứ tự): …

**Không đổi NOT_TESTED thành PASS chỉ vì unit tests không lỗi, hay vì một nhánh source đã tồn tại.**
