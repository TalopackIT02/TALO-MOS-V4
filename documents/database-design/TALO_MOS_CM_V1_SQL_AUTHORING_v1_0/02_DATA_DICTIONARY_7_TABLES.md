# 02 — Từ điển dữ liệu CM V1 (KHÓA PHẠM VI)

Hệ thống: PostgreSQL; schema đề xuất `cm`; **7 bảng / 76 cột**. Tên vật lý PK theo `<entity>_id`, không dùng `id` chung.
`NULL=YES` được phép NULL; `DEFAULT` là giá trị áp dụng ở DDL; cột `_account_id` là tham chiếu logic UUID sang IAM, **không FK vật lý**.
Cột tham chiếu account kiểu UUID dựa trên metadata TEST `iam.iam_user_accounts.user_account_id uuid` ở preflight 2026-10-29.

## `cm_customers` — 18 cột

| # | Cột | PostgreSQL | NULL | DEFAULT | Quy tắc | Ý nghĩa |
|---:|---|---|:---:|---|---|---|
| 1 | `customer_id` | `uuid` | NO | `gen_random_uuid()` | PK | Khóa khách hàng, cố định suốt vòng đời |
| 2 | `customer_code` | `varchar(30)` | NO | — | UNIQUE | Mã nghiệp vụ cấp bởi Backend; DB chống trùng |
| 3 | `display_name` | `varchar(200)` | NO | — | — | Tên thường gọi |
| 4 | `legal_name` | `varchar(255)` | YES | — | — | Tên đăng ký pháp lý/thuế |
| 5 | `tax_number` | `varchar(32)` | YES | — | INDEX_NON_UNIQUE | MST; không UNIQUE tuyệt đối ở V1 |
| 6 | `registered_address` | `text` | YES | — | — | Địa chỉ đăng ký pháp lý, văn bản gốc |
| 7 | `representative_name` | `varchar(150)` | YES | — | — | Người đại diện pháp luật |
| 8 | `representative_phone` | `varchar(30)` | YES | — | — | Điện thoại đại diện |
| 9 | `province_name` | `varchar(150)` | YES | — | — | Tỉnh/thành văn bản; chưa cần Master Data |
| 10 | `sales_region` | `varchar(100)` | YES | — | — | Khu vực kinh doanh văn bản; sau này chuẩn hóa |
| 11 | `customer_type_code` | `varchar(30)` | NO | `'COMPANY'` | CODE_CONTRACT | COMPANY, PERSON; chưa tạo bảng mã |
| 12 | `customer_status_code` | `varchar(30)` | NO | `'PROSPECT'` | CODE_CONTRACT | PROSPECT, NEW, ACTIVE, PAUSED, CLOSED |
| 13 | `internal_note` | `text` | YES | — | — | Ghi chú nội bộ |
| 14 | `created_at` | `timestamptz` | NO | `now()` | — | Ngày tạo |
| 15 | `created_account_id` | `uuid` | YES | — | IAM_LOGICAL_REF | Actor IAM, không FK vật lý sang iam |
| 16 | `updated_at` | `timestamptz` | YES | — | — | Lần cập nhật sau cùng |
| 17 | `updated_account_id` | `uuid` | YES | — | IAM_LOGICAL_REF | Actor sửa, không FK vật lý |
| 18 | `is_hidden` | `boolean` | NO | `false` | — | Ẩn khỏi danh sách mặc định; không xóa vật lý |

## `cm_customer_contacts` — 12 cột

| # | Cột | PostgreSQL | NULL | DEFAULT | Quy tắc | Ý nghĩa |
|---:|---|---|:---:|---|---|---|
| 1 | `contact_id` | `uuid` | NO | `gen_random_uuid()` | PK | Khóa người liên hệ |
| 2 | `customer_id` | `uuid` | NO | — | FK:cm_customers.customer_id | Khách hàng sở hữu |
| 3 | `full_name` | `varchar(150)` | NO | — | — | Tên người liên hệ |
| 4 | `position_title` | `varchar(100)` | YES | — | — | Chức vụ |
| 5 | `phone` | `varchar(30)` | YES | — | CHECK_PHONE_ZALO | Ít nhất phone hoặc zalo_phone phải có |
| 6 | `zalo_phone` | `varchar(30)` | YES | — | CHECK_PHONE_ZALO | Số Zalo |
| 7 | `email` | `varchar(254)` | YES | — | — | Email |
| 8 | `is_primary` | `boolean` | NO | `false` | PARTIAL_UNIQUE_PRIMARY | Tối đa 1 liên hệ chính đang hoạt động/khách |
| 9 | `is_active` | `boolean` | NO | `true` | — | Liên hệ còn sử dụng |
| 10 | `created_at` | `timestamptz` | NO | `now()` | — | Ngày tạo |
| 11 | `updated_at` | `timestamptz` | YES | — | — | Lần chỉnh sửa |
| 12 | `created_account_id` | `uuid` | YES | — | IAM_LOGICAL_REF | Người tạo; không FK IAM |

## `cm_customer_groups` — 8 cột

| # | Cột | PostgreSQL | NULL | DEFAULT | Quy tắc | Ý nghĩa |
|---:|---|---|:---:|---|---|---|
| 1 | `group_id` | `uuid` | NO | `gen_random_uuid()` | PK | Khóa nhóm khách hàng |
| 2 | `group_code` | `varchar(30)` | NO | — | UNIQUE | Mã nhóm |
| 3 | `group_name` | `varchar(150)` | NO | — | — | Tên nhóm |
| 4 | `parent_group_id` | `uuid` | YES | — | FK:cm_customer_groups.group_id;CHECK_NOT_SELF | Nhóm cha, không được trỏ chính mình |
| 5 | `description` | `text` | YES | — | — | Mô tả nhóm |
| 6 | `is_active` | `boolean` | NO | `true` | — | Trạng thái sử dụng |
| 7 | `created_at` | `timestamptz` | NO | `now()` | — | Ngày tạo |
| 8 | `created_account_id` | `uuid` | YES | — | IAM_LOGICAL_REF | Người tạo |

## `cm_customer_group_members` — 4 cột

| # | Cột | PostgreSQL | NULL | DEFAULT | Quy tắc | Ý nghĩa |
|---:|---|---|:---:|---|---|---|
| 1 | `customer_id` | `uuid` | NO | — | PK_COMPONENT;FK:cm_customers.customer_id | Khách hàng |
| 2 | `group_id` | `uuid` | NO | — | PK_COMPONENT;FK:cm_customer_groups.group_id | Nhóm |
| 3 | `assigned_at` | `timestamptz` | NO | `now()` | — | Thời điểm gán |
| 4 | `assigned_account_id` | `uuid` | YES | — | IAM_LOGICAL_REF | Người gán; không FK IAM |

## `cm_customer_assignments` — 11 cột

| # | Cột | PostgreSQL | NULL | DEFAULT | Quy tắc | Ý nghĩa |
|---:|---|---|:---:|---|---|---|
| 1 | `assignment_id` | `uuid` | NO | `gen_random_uuid()` | PK | Mã lượt phân công |
| 2 | `customer_id` | `uuid` | NO | — | FK:cm_customers.customer_id | Khách hàng |
| 3 | `sale_account_id` | `uuid` | NO | — | IAM_LOGICAL_REF;PARTIAL_UNIQUE_ACTIVE | Sale phụ trách của lượt phân công; không FK IAM |
| 4 | `assigned_by_account_id` | `uuid` | YES | — | IAM_LOGICAL_REF | Người giao việc hoặc admin |
| 5 | `assigned_at` | `timestamptz` | NO | `now()` | — | Thời điểm bắt đầu phụ trách |
| 6 | `ended_at` | `timestamptz` | YES | — | CHECK_TIME_ORDER | NULL=đang phụ trách, hết hiệu lực khi kết thúc |
| 7 | `ended_by_account_id` | `uuid` | YES | — | IAM_LOGICAL_REF | Người kết thúc phân công |
| 8 | `handover_to_account_id` | `uuid` | YES | — | IAM_LOGICAL_REF | Sale được bàn giao (nếu có) |
| 9 | `handover_note` | `text` | YES | — | — | Ghi chú bàn giao |
| 10 | `handover_accepted_at` | `timestamptz` | YES | — | — | Thời điểm người nhận xác nhận (nếu có) |
| 11 | `handover_accepted_by_account_id` | `uuid` | YES | — | IAM_LOGICAL_REF | Người xác nhận nhận bàn giao |

## `cm_customer_activities` — 12 cột

| # | Cột | PostgreSQL | NULL | DEFAULT | Quy tắc | Ý nghĩa |
|---:|---|---|:---:|---|---|---|
| 1 | `activity_id` | `uuid` | NO | `gen_random_uuid()` | PK | Mã hoạt động/công việc |
| 2 | `customer_id` | `uuid` | NO | — | FK:cm_customers.customer_id | Khách hàng |
| 3 | `activity_type_code` | `varchar(30)` | NO | — | CODE_CONTRACT | NOTE/CALL/MEETING/TASK/FOLLOW_UP/HANDOVER |
| 4 | `activity_status_code` | `varchar(30)` | NO | `'OPEN'` | CODE_CONTRACT | OPEN/DONE/CANCELLED; lịch sử ghi chú có thể DONE |
| 5 | `title` | `varchar(255)` | NO | — | — | Tiêu đề |
| 6 | `description` | `text` | YES | — | — | Nội dung làm việc |
| 7 | `occurred_at` | `timestamptz` | NO | `now()` | — | Thời điểm sự kiện/công việc |
| 8 | `due_at` | `timestamptz` | YES | — | — | Thời hạn công việc (nếu có) |
| 9 | `assigned_to_account_id` | `uuid` | YES | — | IAM_LOGICAL_REF | Người được giao xử lý công việc |
| 10 | `created_by_account_id` | `uuid` | YES | — | IAM_LOGICAL_REF | Người tạo hoạt động |
| 11 | `created_at` | `timestamptz` | NO | `now()` | — | Thời gian hệ thống ghi nhận |
| 12 | `completed_at` | `timestamptz` | YES | — | — | Thời gian hoàn thành |

## `cm_customer_documents` — 11 cột

| # | Cột | PostgreSQL | NULL | DEFAULT | Quy tắc | Ý nghĩa |
|---:|---|---|:---:|---|---|---|
| 1 | `document_id` | `uuid` | NO | `gen_random_uuid()` | PK | ID tài liệu, file mới = bản ghi mới |
| 2 | `customer_id` | `uuid` | NO | — | FK:cm_customers.customer_id | Khách hàng |
| 3 | `document_name` | `varchar(255)` | NO | — | — | Tên hiển thị tài liệu |
| 4 | `document_type_code` | `varchar(30)` | NO | — | CODE_CONTRACT | LEGAL/CONTRACT/AUTHORIZATION/OTHER |
| 5 | `file_name` | `varchar(255)` | NO | — | — | Tên file gốc |
| 6 | `storage_path` | `varchar(500)` | NO | — | — | Khóa/đường dẫn tương đối trên storage, không phải absolute public URL |
| 7 | `file_type` | `varchar(100)` | NO | — | — | MIME type, ví dụ application/pdf |
| 8 | `file_size` | `bigint` | NO | — | CHECK_NONNEGATIVE | Kích thước byte >= 0 |
| 9 | `uploaded_by_account_id` | `uuid` | YES | — | IAM_LOGICAL_REF | Người upload |
| 10 | `uploaded_at` | `timestamptz` | NO | `now()` | — | Thời gian upload |
| 11 | `note` | `text` | YES | — | — | Ghi chú |

## Lưu ý

- Không có bảng danh mục riêng, Master Data, sản phẩm, đơn hàng, công nợ hoặc bảng audit bổ sung ở V1.
- Các cột phân loại `_code` có danh sách mã đề xuất trong `04_CODE_CONTRACT.md`, không lập bảng lookup hoặc seed.
- Nội dung tệp lưu bên ngoài PostgreSQL; DB chỉ lưu metadata.
- Bất kỳ đề nghị cột thứ 77 hoặc bảng thứ 8 phải ghi CHANGE_REQUEST và dừng, không tự triển khai.
