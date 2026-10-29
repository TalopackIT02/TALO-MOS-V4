# 06 — Tích hợp Foundation/IAM / quyền SQL

## Hiện trạng chứng cứ qua Claude preflight ngày 29/10/2026 (TEST ONLY)
- DB TEST: `talo_mos_v4_test`, PostgreSQL 18.6 (preflight); 27 bảng cũ không có, 7-table SQL draft chưa chạy.
- Foundation **chỉ preflight** xác nhận bảng khai báo MIC-06 tồn tại và role app SELECT được; không tạo bảng thay nghiệp vụ.
- `iam.iam_user_accounts.user_account_id` là `uuid`. Actor `_account_id uuid` là liên kết logic, **không có FK** sang IAM.
- Role `talo_app` không có CREATE trong public và không CREATE schema. DDL chạy bởi admin theo DB Gate và theo mẫu FBE-01B.
- SCC Data Inspector đang truy cập schema/bảng mà `talo_app` SELECT được, chưa có allowlist. Không hiểu nhầm GRANT SELECT = phân quyền IAM.

## Đề xuất DDL & owner
- Schema: `cm`; NOLOGIN owner: `talo_cm_owner` (đề xuất chưa có). Không thực hiện CREATE ROLE cho đến khi chủ dự án duyệt việc tạo role cluster-level; script quản trị cluster riêng, độc lập với migration bảng.
- Chỉ một schema `cm` chứa đủ 11 bảng cho V1. Danh mục hành chính đặt trong CRM **để nhanh ra sản phẩm**; không chỉnh Foundation tạo Master Data toàn hệ thống. Sau này module khác cần thì sử dụng contract read-only hay quy trình di chuyển có migration riêng.
- DDL không sửa các bảng `iam`, `foundation`, `audit_api`, `foundation_read_api`, Prisma hoặc backend/front.
- Mọi FK mới phải có đúng tên, cột, kiểu và ON DELETE RESTRICT.

## GRANT khuyến nghị
- `talo_app`: USAGE schema; SELECT tối thiểu cần cho API và preflight Foundation. INSERT/UPDATE cấp **theo cột** theo phân quyền của draft 7 bảng, bổ sung cột Customer mới thật sự cần và document dates. Với bảng danh mục: SELECT, không INSERT/UPDATE/DELETE ở runtime; seed bằng quyền quản trị riêng.
- `cm.customer_code_seq`: chỉ cấp quyền tối thiểu cần cho `nextval()` trong DEFAULT (thường USAGE); không cấp `UPDATE` hoặc `ALL`.
- `customer_code`, `customer_id`, `created_at`, các khóa/cột sinh tự động không cho runtime UPDATE. Định danh pháp lý có thể chỉnh sửa nhưng Backend phải yêu cầu IAM, kiểm tra trùng và ghi nhận người sửa hiện có; không tạo audit table mới.
- Không cấp DELETE các hồ sơ nghiệp vụ trừ `group_members` theo đề xuất baseline. Không cấp quyền truy cập trực tiếp cho tài khoản Sale DB.

## PII Gate
Do SCC Data Inspector có thể hiển thị toàn bộ cm.* qua role chung khi có SELECT, chủ dự án phải **xác nhận rủi ro TEST** trước khi GRANT. Không âm thầm cấp rộng hoặc sửa SCC để né. TEST không đồng nghĩa được triển khai Production.
