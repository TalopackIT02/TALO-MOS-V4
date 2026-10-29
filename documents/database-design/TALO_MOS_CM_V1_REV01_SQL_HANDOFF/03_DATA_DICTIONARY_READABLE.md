# 03 — Data Dictionary, bản trình bày
**Nguồn máy:** `03_DATA_DICTIONARY_REV01.json` và `03_COLUMN_INVENTORY_114.csv`; 11 bảng, 114 cột.

## `cm_customers` — 23 cột

| # | Cột | Kiểu | NULL | DEFAULT | Khóa/luật | Mô tả |
|---:|---|---|:---:|---|---|---|
| 1 | `customer_id` | `uuid` | NO | `gen_random_uuid()` | PK | Khóa khách hàng, cố định suốt vòng đời |
| 2 | `customer_code` | `varchar(6)` | NO | `lpad(nextval('cm.customer_code_seq')::text, 6, '0')` | UNIQUE;CHECK_6_DIGIT | DB sequence cấp 000001..999999 NO CYCLE, Backend nhận qua RETURNING; không nhập tay |
| 3 | `display_name` | `varchar(200)` | NO | `—` | — | Tên thường gọi |
| 4 | `legal_name` | `varchar(255)` | YES | `—` | — | Tên đăng ký pháp lý/thuế |
| 5 | `registered_address` | `text` | YES | `—` | — | Snapshot địa chỉ pháp lý đầy đủ do Backend dựng từ cột cấu trúc; không được edit độc lập |
| 6 | `representative_name` | `varchar(150)` | YES | `—` | — | Người đại diện pháp luật |
| 7 | `representative_phone` | `varchar(30)` | YES | `—` | — | Điện thoại đại diện |
| 8 | `customer_type_code` | `varchar(30)` | NO | `—` | CODE_CONTRACT | COMPANY/BRANCH/HOUSEHOLD/PERSON/FOREIGN_NO_VN_REG; bắt buộc khai báo |
| 9 | `customer_status_code` | `varchar(30)` | NO | `'PROSPECT'` | CODE_CONTRACT | PROSPECT, NEW, ACTIVE, PAUSED, CLOSED |
| 10 | `internal_note` | `text` | YES | `—` | — | Ghi chú nội bộ |
| 11 | `created_at` | `timestamptz` | NO | `now()` | — | Ngày tạo |
| 12 | `created_account_id` | `uuid` | YES | `—` | IAM_LOGICAL_REF | Actor IAM, không FK vật lý sang iam |
| 13 | `updated_at` | `timestamptz` | YES | `—` | — | Lần cập nhật sau cùng |
| 14 | `updated_account_id` | `uuid` | YES | `—` | IAM_LOGICAL_REF | Actor sửa, không FK vật lý |
| 15 | `is_hidden` | `boolean` | NO | `false` | — | Ẩn khỏi danh sách mặc định; không xóa vật lý |
| 16 | `legal_identifier_type_code` | `varchar(30)` | YES | `—` | CODE_CONTRACT | VN_TAX_ID / VN_PERSONAL_ID / FOREIGN_REG; có điều kiện bắt buộc khi hồ sơ chính thức |
| 17 | `legal_identifier_normalized` | `varchar(128)` | YES | `—` | PARTIAL_UNIQUE | Định danh chuẩn hóa duy nhất theo (country_code, type, value), kể cả khách ẩn; không duplicate tax_number |
| 18 | `address_line` | `text` | YES | `—` | — | Số nhà, tên đường trong nước; đường/địa chỉ chi tiết ở nước ngoài |
| 19 | `province_code` | `char(2)` | YES | `—` | FK_PROVINCE | Mã tỉnh chính thức; NULL cho nước ngoài |
| 20 | `ward_code` | `char(5)` | YES | `—` | COMPOSITE_FK_WARD_PROVINCE | Mã phường/xã/đặc khu chính thức; NULL cho nước ngoài |
| 21 | `country_code` | `char(2)` | NO | `'VN'` | COUNTRY_CODE_CONTRACT | ISO 3166-1 alpha-2, quốc gia địa chỉ và đăng ký ở phạm vi V1 |
| 22 | `foreign_locality` | `varchar(150)` | YES | `—` | — | Địa phương/thành phố tại nước ngoài |
| 23 | `foreign_state_province` | `varchar(150)` | YES | `—` | — | Bang/tỉnh tại nước ngoài |

## `cm_customer_contacts` — 12 cột

| # | Cột | Kiểu | NULL | DEFAULT | Khóa/luật | Mô tả |
|---:|---|---|:---:|---|---|---|
| 1 | `contact_id` | `uuid` | NO | `gen_random_uuid()` | PK | Khóa người liên hệ |
| 2 | `customer_id` | `uuid` | NO | `—` | FK:cm_customers.customer_id | Khách hàng sở hữu |
| 3 | `full_name` | `varchar(150)` | NO | `—` | — | Tên người liên hệ |
| 4 | `position_title` | `varchar(100)` | YES | `—` | — | Chức vụ |
| 5 | `phone` | `varchar(30)` | YES | `—` | CHECK_PHONE_ZALO | Ít nhất phone hoặc zalo_phone phải có |
| 6 | `zalo_phone` | `varchar(30)` | YES | `—` | CHECK_PHONE_ZALO | Số Zalo |
| 7 | `email` | `varchar(254)` | YES | `—` | — | Email |
| 8 | `is_primary` | `boolean` | NO | `false` | PARTIAL_UNIQUE_PRIMARY | Tối đa 1 liên hệ chính đang hoạt động/khách |
| 9 | `is_active` | `boolean` | NO | `true` | — | Liên hệ còn sử dụng |
| 10 | `created_at` | `timestamptz` | NO | `now()` | — | Ngày tạo |
| 11 | `updated_at` | `timestamptz` | YES | `—` | — | Lần chỉnh sửa |
| 12 | `created_account_id` | `uuid` | YES | `—` | IAM_LOGICAL_REF | Người tạo; không FK IAM |

## `cm_customer_groups` — 8 cột

| # | Cột | Kiểu | NULL | DEFAULT | Khóa/luật | Mô tả |
|---:|---|---|:---:|---|---|---|
| 1 | `group_id` | `uuid` | NO | `gen_random_uuid()` | PK | Khóa nhóm khách hàng |
| 2 | `group_code` | `varchar(30)` | NO | `—` | UNIQUE | Mã nhóm |
| 3 | `group_name` | `varchar(150)` | NO | `—` | — | Tên nhóm |
| 4 | `parent_group_id` | `uuid` | YES | `—` | FK:cm_customer_groups.group_id;CHECK_NOT_SELF | Nhóm cha, không được trỏ chính mình |
| 5 | `description` | `text` | YES | `—` | — | Mô tả nhóm |
| 6 | `is_active` | `boolean` | NO | `true` | — | Trạng thái sử dụng |
| 7 | `created_at` | `timestamptz` | NO | `now()` | — | Ngày tạo |
| 8 | `created_account_id` | `uuid` | YES | `—` | IAM_LOGICAL_REF | Người tạo |

## `cm_customer_group_members` — 4 cột

| # | Cột | Kiểu | NULL | DEFAULT | Khóa/luật | Mô tả |
|---:|---|---|:---:|---|---|---|
| 1 | `customer_id` | `uuid` | NO | `—` | PK_COMPONENT;FK:cm_customers.customer_id | Khách hàng |
| 2 | `group_id` | `uuid` | NO | `—` | PK_COMPONENT;FK:cm_customer_groups.group_id | Nhóm |
| 3 | `assigned_at` | `timestamptz` | NO | `now()` | — | Thời điểm gán |
| 4 | `assigned_account_id` | `uuid` | YES | `—` | IAM_LOGICAL_REF | Người gán; không FK IAM |

## `cm_customer_assignments` — 11 cột

| # | Cột | Kiểu | NULL | DEFAULT | Khóa/luật | Mô tả |
|---:|---|---|:---:|---|---|---|
| 1 | `assignment_id` | `uuid` | NO | `gen_random_uuid()` | PK | Mã lượt phân công |
| 2 | `customer_id` | `uuid` | NO | `—` | FK:cm_customers.customer_id | Khách hàng |
| 3 | `sale_account_id` | `uuid` | NO | `—` | IAM_LOGICAL_REF;PARTIAL_UNIQUE_ACTIVE | Sale phụ trách của lượt phân công; không FK IAM |
| 4 | `assigned_by_account_id` | `uuid` | YES | `—` | IAM_LOGICAL_REF | Người giao việc hoặc admin |
| 5 | `assigned_at` | `timestamptz` | NO | `now()` | — | Thời điểm bắt đầu phụ trách |
| 6 | `ended_at` | `timestamptz` | YES | `—` | CHECK_TIME_ORDER | NULL=đang phụ trách, hết hiệu lực khi kết thúc |
| 7 | `ended_by_account_id` | `uuid` | YES | `—` | IAM_LOGICAL_REF | Người kết thúc phân công |
| 8 | `handover_to_account_id` | `uuid` | YES | `—` | IAM_LOGICAL_REF | Sale được bàn giao (nếu có) |
| 9 | `handover_note` | `text` | YES | `—` | — | Ghi chú bàn giao |
| 10 | `handover_accepted_at` | `timestamptz` | YES | `—` | — | Thời điểm người nhận xác nhận (nếu có) |
| 11 | `handover_accepted_by_account_id` | `uuid` | YES | `—` | IAM_LOGICAL_REF | Người xác nhận nhận bàn giao |

## `cm_customer_activities` — 12 cột

| # | Cột | Kiểu | NULL | DEFAULT | Khóa/luật | Mô tả |
|---:|---|---|:---:|---|---|---|
| 1 | `activity_id` | `uuid` | NO | `gen_random_uuid()` | PK | Mã hoạt động/công việc |
| 2 | `customer_id` | `uuid` | NO | `—` | FK:cm_customers.customer_id | Khách hàng |
| 3 | `activity_type_code` | `varchar(30)` | NO | `—` | CODE_CONTRACT | NOTE/CALL/MEETING/TASK/FOLLOW_UP/HANDOVER |
| 4 | `activity_status_code` | `varchar(30)` | NO | `'OPEN'` | CODE_CONTRACT | OPEN/DONE/CANCELLED; lịch sử ghi chú có thể DONE |
| 5 | `title` | `varchar(255)` | NO | `—` | — | Tiêu đề |
| 6 | `description` | `text` | YES | `—` | — | Nội dung làm việc |
| 7 | `occurred_at` | `timestamptz` | NO | `now()` | — | Thời điểm sự kiện/công việc |
| 8 | `due_at` | `timestamptz` | YES | `—` | — | Thời hạn công việc (nếu có) |
| 9 | `assigned_to_account_id` | `uuid` | YES | `—` | IAM_LOGICAL_REF | Người được giao xử lý công việc |
| 10 | `created_by_account_id` | `uuid` | YES | `—` | IAM_LOGICAL_REF | Người tạo hoạt động |
| 11 | `created_at` | `timestamptz` | NO | `now()` | — | Thời gian hệ thống ghi nhận |
| 12 | `completed_at` | `timestamptz` | YES | `—` | — | Thời gian hoàn thành |

## `cm_customer_documents` — 14 cột

| # | Cột | Kiểu | NULL | DEFAULT | Khóa/luật | Mô tả |
|---:|---|---|:---:|---|---|---|
| 1 | `document_id` | `uuid` | NO | `gen_random_uuid()` | PK | ID tài liệu, file mới = bản ghi mới |
| 2 | `customer_id` | `uuid` | NO | `—` | FK:cm_customers.customer_id | Khách hàng |
| 3 | `document_name` | `varchar(255)` | NO | `—` | — | Tên hiển thị tài liệu |
| 4 | `document_type_code` | `varchar(30)` | NO | `—` | CODE_CONTRACT | LEGAL/CONTRACT/AUTHORIZATION/OTHER |
| 5 | `file_name` | `varchar(255)` | NO | `—` | — | Tên file gốc |
| 6 | `storage_path` | `varchar(500)` | NO | `—` | — | Khóa/đường dẫn tương đối trên storage, không phải absolute public URL |
| 7 | `file_type` | `varchar(100)` | NO | `—` | — | MIME type, ví dụ application/pdf |
| 8 | `file_size` | `bigint` | NO | `—` | CHECK_NONNEGATIVE | Kích thước byte >= 0 |
| 9 | `uploaded_by_account_id` | `uuid` | YES | `—` | IAM_LOGICAL_REF | Người upload |
| 10 | `uploaded_at` | `timestamptz` | NO | `now()` | — | Thời gian upload |
| 11 | `note` | `text` | YES | `—` | — | Ghi chú |
| 12 | `signed_date` | `date` | YES | `—` | — | Ngày ký tài liệu, có thể NULL |
| 13 | `effective_date` | `date` | YES | `—` | — | Ngày bắt đầu hiệu lực, có thể NULL |
| 14 | `expiry_date` | `date` | YES | `—` | CHECK_EFFECTIVE_EXPIRY | Ngày hết hạn, có thể NULL |

## `cm_ref_provinces` — 8 cột

| # | Cột | Kiểu | NULL | DEFAULT | Khóa/luật | Mô tả |
|---:|---|---|:---:|---|---|---|
| 1 | `province_code` | `char(2)` | NO | `—` | PK | Mã 2 chữ số theo Quyết định 19/2025/QĐ-TTg |
| 2 | `province_name` | `varchar(150)` | NO | `—` | — | Tên tỉnh/thành chuẩn |
| 3 | `unit_type_code` | `varchar(20)` | NO | `—` | CODE_CONTRACT | TINH/THANH_PHO |
| 4 | `valid_from` | `date` | NO | `—` | — | Ngày hiệu lực nguồn |
| 5 | `valid_to` | `date` | YES | `—` | — | Ngày hết hiệu lực nếu có |
| 6 | `is_active` | `boolean` | NO | `true` | — | Trạng thái danh mục |
| 7 | `source_ref` | `varchar(255)` | NO | `—` | — | Văn bản chính thức |
| 8 | `source_version` | `varchar(60)` | NO | `—` | — | Phiên bản import |

## `cm_ref_wards` — 9 cột

| # | Cột | Kiểu | NULL | DEFAULT | Khóa/luật | Mô tả |
|---:|---|---|:---:|---|---|---|
| 1 | `ward_code` | `char(5)` | NO | `—` | PK | Mã 5 chữ số theo QĐ 19 |
| 2 | `province_code` | `char(2)` | NO | `—` | FK_PROVINCE | Tỉnh trực thuộc |
| 3 | `ward_name` | `varchar(150)` | NO | `—` | — | Tên phường/xã/đặc khu |
| 4 | `unit_type_code` | `varchar(20)` | NO | `—` | CODE_CONTRACT | PHUONG/XA/DAC_KHU |
| 5 | `valid_from` | `date` | NO | `—` | — | Ngày hiệu lực |
| 6 | `valid_to` | `date` | YES | `—` | — | Ngày hết hiệu lực |
| 7 | `is_active` | `boolean` | NO | `true` | — | Trạng thái |
| 8 | `source_ref` | `varchar(255)` | NO | `—` | — | Nguồn chính thức |
| 9 | `source_version` | `varchar(60)` | NO | `—` | — | Phiên bản import |

## `cm_ref_economic_regions` — 6 cột

| # | Cột | Kiểu | NULL | DEFAULT | Khóa/luật | Mô tả |
|---:|---|---|:---:|---|---|---|
| 1 | `region_code` | `varchar(20)` | NO | `—` | PK | Mã vùng kinh tế nội bộ ổn định |
| 2 | `region_name` | `varchar(150)` | NO | `—` | — | Tên một trong sáu vùng kinh tế |
| 3 | `valid_from` | `date` | NO | `—` | — | Hiệu lực văn bản/phiên bản |
| 4 | `valid_to` | `date` | YES | `—` | — | Hết hiệu lực nếu thay đổi |
| 5 | `is_active` | `boolean` | NO | `true` | — | Đang sử dụng |
| 6 | `source_ref` | `varchar(255)` | NO | `—` | — | Nguồn pháp lý |

## `cm_ref_province_region_map` — 7 cột

| # | Cột | Kiểu | NULL | DEFAULT | Khóa/luật | Mô tả |
|---:|---|---|:---:|---|---|---|
| 1 | `province_code` | `char(2)` | NO | `—` | PK_COMPONENT;FK_PROVINCE | Tỉnh được ánh xạ |
| 2 | `region_code` | `varchar(20)` | NO | `—` | FK_REGION | Vùng kinh tế |
| 3 | `macro_region_code` | `varchar(15)` | NO | `—` | CODE_CONTRACT | NORTH/CENTRAL/SOUTH (quy ước kinh doanh, chưa là luật) |
| 4 | `valid_from` | `date` | NO | `—` | PK_COMPONENT | Ngày bắt đầu dùng ánh xạ |
| 5 | `valid_to` | `date` | YES | `—` | — | Ngày kết thúc ánh xạ, NULL = hiện hành |
| 6 | `source_ref` | `varchar(255)` | NO | `—` | — | Nguồn phân vùng pháp lý |
| 7 | `mapping_version` | `varchar(60)` | NO | `—` | — | Phiên bản ánh xạ |
