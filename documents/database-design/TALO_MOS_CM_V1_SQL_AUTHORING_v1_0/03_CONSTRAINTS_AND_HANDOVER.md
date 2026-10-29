# 03 — FK, ràng buộc và quy trình bàn giao

## A. Quan hệ vật lý — đúng 7 FK, RESTRICT

| Child | FK cột | Parent | ON DELETE |
|---|---|---|---|
| `cm_customer_contacts` | `customer_id` | `cm_customers(customer_id)` | RESTRICT |
| `cm_customer_groups` | `parent_group_id` | `cm_customer_groups(group_id)` | RESTRICT |
| `cm_customer_group_members` | `customer_id` | `cm_customers(customer_id)` | RESTRICT |
| `cm_customer_group_members` | `group_id` | `cm_customer_groups(group_id)` | RESTRICT |
| `cm_customer_assignments` | `customer_id` | `cm_customers(customer_id)` | RESTRICT |
| `cm_customer_activities` | `customer_id` | `cm_customers(customer_id)` | RESTRICT |
| `cm_customer_documents` | `customer_id` | `cm_customers(customer_id)` | RESTRICT |

`*_account_id` là UUID tham chiếu **logic** tới `iam.iam_user_accounts.user_account_id`, không FK vật lý.

## B. PK và UNIQUE

- PK UUID cho 6 bảng, trừ `cm_customer_group_members` có PK kép `(customer_id, group_id)`.
- UNIQUE: `cm_customers(customer_code)`, `cm_customer_groups(group_code)`.
- UNIQUE partial: `cm_customer_contacts(customer_id) WHERE is_primary = true AND is_active = true`.
- UNIQUE partial: `cm_customer_assignments(customer_id) WHERE ended_at IS NULL`.
- Index đề xuất không trùng PK/UQ: `customers(tax_number)` (non-unique, WHERE tax_number IS NOT NULL), `customers(customer_status_code)`, `contacts(customer_id)`, `activities(customer_id, occurred_at DESC)`, `activities(assigned_to_account_id, activity_status_code, due_at)`, `documents(customer_id, uploaded_at DESC)`, `assignments(sale_account_id, ended_at)`.
- Tên PK/FK/UQ/CK/INDEX: dùng tiền tố `pk_cm_`, `fk_cm_`, `uq_cm_`, `ck_cm_`, `ix_cm_` và ngắn hơn giới hạn 63 ký tự PostgreSQL. Không tạo đối tượng tự phát sinh ngoài PK/UNIQUE/index đã nêu.

## C. CHECK

1. `cm_customer_contacts`: ít nhất một trong `phone`, `zalo_phone` phải khác rỗng sau `BTRIM` và `NULLIF`.
2. `cm_customer_groups`: `parent_group_id IS NULL OR parent_group_id <> group_id`; vòng nhiều cấp kiểm tra tại Backend sau này.
3. `cm_customer_assignments`: `ended_at IS NULL OR ended_at >= assigned_at`.
4. `cm_customer_documents`: `file_size >= 0`.

Không áp thêm ENUM/CHECK mới cho các cột `_code` trong V1; mã hợp lệ được xác thực ở Backend, cho phép mở rộng mà không đổi DDL.

## D. Bàn giao khách hàng — giao dịch nguyên tử ở Backend tương lai

- Một khách hàng có **tối đa 1** lượt phân công hiện hành (`ended_at IS NULL`); có thể có **0** Sale hiện tại (chưa phân công).
- Khi bàn giao: trong **một DB transaction**, khoá lượt phân công hiện hành, cập nhật `ended_at`, `ended_by_account_id`, `handover_to_account_id`, `handover_note`, và tạo lượt mới cho Sale nhận. Unique partial ngăn hai Sale cùng hoạt động.
- `handover_accepted_at`, `handover_accepted_by_account_id` lưu xác nhận người nhận khi có. Trường hợp chuyển giao bắt buộc bởi quản trị viên có thể chưa có xác nhận; **lượt mới vẫn là Sale hiện hành**, còn tình trạng nhận bàn giao xác định từ các trường xác nhận.
- Ghi hoạt động `HANDOVER` (và việc còn mở nếu cần) trong bảng `cm_customer_activities` khi Backend thực hiện, không thêm bảng handover riêng.
- Khi khóa tài khoản Sale cũ: không `DELETE` khách, hoạt động, tài liệu, assignment lịch sử. Sale mới có thể xem lịch sử theo IAM; công việc còn OPEN phải được phân công lại bằng Backend theo quy trình bàn giao.
- Không mặc định thay đổi sở hữu hồ sơ khách hàng (chủ sở hữu là doanh nghiệp).

## E. Chính sách xóa và file

- Bảng Customer, Contact, Groups, Assignments, Activities, Documents: không đề xuất cấp `DELETE` cho `talo_app` trong V1; chỉ ẩn/đổi trạng thái ở nơi có cột tương ứng.
- Riêng bảng liên kết `cm_customer_group_members`: cho phép **đề xuất** quyền `DELETE` có kiểm soát để gỡ nhóm, kết hợp kiểm tra IAM trong Backend.
- File mới phải có `document_id`/`storage_path` mới; không update/ghi đè metadata tài liệu cũ; file cũ chỉ bị hủy theo quy trình riêng được phê duyệt về sau.
- `storage_path` là relative key do dịch vụ lưu trữ quản lý, không mở đường dẫn ổ đĩa thực, không lưu blob vào PostgreSQL.
