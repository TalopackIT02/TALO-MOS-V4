# 05 — Đối chiếu Foundation — bằng chứng tiền kiểm 2026-10-29

Nguồn: `CM_FOUNDATION_PREFLIGHT_REPORT.md` trong gói Claude `CM_DB_PREFLIGHT_20261029-105936.zip`, metadata TEST, và báo cáo Gate `CM_DB_SQL_AUTHORING_GATE_20261029-112110.zip`.

| Dữ kiện đã được báo cáo | Hệ quả đối với SQL CM V1 |
|---|---|
| TEST `talo_mos_v4_test`: PostgreSQL 18.6, role runtime `talo_app` | DDL/kiểm thử nháp tham chiếu TEST; trước khi áp dụng cần metadata mới |
| Các schema `iam`, `foundation`, `audit_api`, `foundation_read_api`; `public` không có USAGE cho `talo_app` | Dùng schema riêng `cm` **đề xuất**, không dùng `public` |
| Foundation Installer chỉ xác minh tài nguyên MIC-06 đã tồn tại và `talo_app` SELECT được | SQL tạo DB là Gate **riêng trước** đăng ký MIC; không yêu cầu Foundation sinh bảng |
| DDL hiện sử dụng gói ngoài repo (tham khảo FBE-01B), manifest hash, backup, rollback | Claude viết candidate theo mẫu này, **không chạy** |
| Actor IAM PK `iam.iam_user_accounts.user_account_id uuid` | Các cột actor của CM là UUID, **không FK sang IAM** |
| Tiền lệ Foundation dùng `<entity>_id`, `gen_random_uuid()`, `ON DELETE RESTRICT` | Theo trong candidate 7 bảng |
| Prisma chỉ map `iam`, `prisma migrate` và `db push` bị cấm | Không sửa Prisma, không tạo Prisma migration |
| Role `talo_app` không có CREATE DB/schema, dùng GRANT cột | Đề xuất owner NOLOGIN `talo_cm_owner` và GRANT chọn lọc |
| Dữ liệu Customer/Master trước đây chưa tồn tại trên TEST lúc tiền kiểm | Kiểm tra lại read-only để phát hiện drift trước khi viết; không suy rộng sang DEV/PROD |

**Đề xuất chưa được xác nhận trên môi trường chạy:** schema `cm`, role `talo_cm_owner` NOLOGIN; chỉ đưa vào SQL nháp và báo chờ phê duyệt triển khai. Nếu tên bị trùng, mô tả rõ tình huống, không âm thầm đổi tên hoặc tạo schema khác.

**Không dùng các tài liệu AI Governance DRAFT làm chính sách đã được phê duyệt.** Không sửa Foundation/IAM/Prisma chỉ để hoàn thành gói CM.

**Chú ý:** Chủ dự án đã chủ động thay đổi phạm vi từ 27 bảng xuống 7 bảng; các gate phê duyệt của gói 27 bảng trước đây không được áp dụng máy móc cho SQL nháp V1 mới.
