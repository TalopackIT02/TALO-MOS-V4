# 09 — Runbook thực thi / nghiệm thu

## A. Trước code

1. Kiểm tra local Git repo/status, ghi baseline và danh sách thay đổi sẵn có.
2. Đọc `documents/development/FMI-01-Manual-Module-Scan/` nếu có, đặc biệt runtime guard.
3. Quan sát thực tế code local của FMI01, Module Registry, MIC, installed module artifacts.
4. Backup read-only inventory, xác nhận DB TEST; trước thao tác ghi DB phải có pg_dump verified.
5. Không chạy `npm run build/dev/test` trước khi hiểu side-effects `modules:sync`.

## B. Thực thi

1. Read-only route ownership/fixture inventory, source tests và root cause conflict.
2. Xây cơ chế fixture isolation; verify 2 runs không nhân đôi ACTIVE conflicts. Với cleanup data có irreversible action, xuất plan theo exact IDs và dừng đúng gate nếu chưa approved.
3. Installed release ledger + sync-from-approved releases; migration preserving existing ACTIVE artifacts; test Backend + Frontend.
4. FMI02 isolated runner + report/evidence engine; integrate UI vào Foundation ModuleScreen.
5. FMI03 prepare plan; cutover + IAM + Navigation + Runtime postcheck state machine; không vượt gate recovery.
6. Unit/integration/security/regression theo test matrix.
7. Documentation + source diff + report.

## C. Hướng dẫn sử dụng sau khi các chức năng đã DONE

- Người quản trị chép module đủ package vào `modules/`, không cần Claude Code.
- Quản lý Module → Quét Module → Chọn Candidate → Kiểm tra & Chạy thử.
- Nếu lỗi, mở drawer, sửa folder, nhấn Quét Module lại rồi chạy thử; không tăng B02 version chỉ vì lỗi DRAFT.
- Nếu READY, xem Kế hoạch cài đặt; nếu có blocker về quyền, supervisor hoặc rollback, không được bấm commit.
- Nhấn Cài đặt & Kích hoạt; theo dõi các bước và tải report TXT.
- Chỉ khi runtime hash/version, B02 ACTIVE, quyền IAM, menu B09 và postcheck PASS mới kết luận sử dụng được.

## D. Thứ tự bàn giao khi chưa hoàn tất

1. Nếu fixture cleanup chưa an toàn: giữ nguyên, ghi inventory và tests phát hiện route.
2. Nếu runtime isolation chưa đủ: chưa cho FMI02/FMI03 install; ưu tiên bảo toàn ACTIVE.
3. Nếu code FMI02 chạy được nhưng không có test isolation: lưu PARTIAL, không giả evidence PASS.
4. Nếu FMI03 prepare chạy được nhưng không có rollback/supervisor: giữ `PREPARED/BLOCKED`, không auto ACTIVATE.

## E. Báo cáo chủ dự án

- Trạng thái DONE/PARTIAL/BLOCKED cho từng nhóm và tổng thể.
- Exact branch/HEAD/local changes, tests run/pass/fail, database name/role, backup checksum.
- Route-owner before/after, FBET count before/after, legacy B09/menu baseline, features working and blocked.
- Screenshot UX, API list, security guard results, installed source hash and runtime version.
- Code file diff summary, rollback plan, known constraints. Không push/merge/deploy.
