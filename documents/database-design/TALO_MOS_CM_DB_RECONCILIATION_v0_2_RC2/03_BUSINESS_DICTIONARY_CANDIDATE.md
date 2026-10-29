# DỮ LIỆU ĐỀ XUẤT v0.2-RC2 (ứng viên giữ nguyên từ RC1) — 11 BẢNG NGHIỆP VỤ

> **CHƯA DUYỆT. KHÔNG DÙNG LÀM SQL TRIỂN KHAI.** Thiết kế này dựa trên v0.1 và bản tóm tắt tiền kiểm 29/10/2026. Toàn văn báo cáo + evidence đã có trong thư mục evidence/, nhưng vẫn còn các quyết định cần chủ dự án phê duyệt. Các thay đổi tên khóa chính là ứng viên phù hợp quy ước `<entity>_id` được báo cáo, KHÔNG phải xác nhận một chuẩn bắt buộc.
>
> Ký hiệu `[PENDING]`: quyết định cần bằng chứng hoặc phê duyệt. Schema và owner không được giả định. Bảng/vị trí dưới đây đều viết **không có schema prefix** nhằm tránh ngầm chốt schema.

## Metadata chung — KHÔNG tự thêm vào mọi bảng

- `created_at timestamptz` — đã có trong bản v0.1 dưới dạng đề xuất; kiểm tra mức độ áp dụng thực tế cho từng loại bảng.
- `created_by`, `updated_by`, `row_version` — **KHÔNG tự bổ sung**, vì báo cáo phản ánh không có trong bảng hiện hành.
- `created_account_id`, `updated_account_id` — chỉ là ứng viên theo naming `*_account_id`; **không tự đưa vào DDL** khi chưa có field-level approval và kiểu IAM xác thực.
- `retired_at` — giữ tại nơi có trong baseline v0.1, cần chốt lifecycle.
- Các cột diễn giải `id` trong 9 bảng và 2 Master Data được đề xuất đổi thành `<entity>_id`; PK đặc thù/composite giữ nguyên.
- Không FK trực tiếp actor tới `iam` ở bản ứng viên; không khẳng định actor ID chắc chắn là UUID cho đến khi đọc schema thực.


## 01. `cm_customers`

**Mục đích:** Hồ sơ trung tâm; tham chiếu cho module khác.

| Cột | PostgreSQL / kiểu đề xuất | NULL | Khóa / FK | Ghi chú |
|---|---|---|---|---|
| customer_id | uuid | Không | PK | —; [PENDING] Đổi tên khóa PK theo báo cáo preflight |
| customer_code | varchar(30) | Không | UNIQUE | Mã nghiệp vụ ổn định |
| display_name | varchar(200) | Không | — | Tên thường gọi |
| entity_type_code | varchar(30) | Không | FK → cm_ref_entity_types.code | — |
| status_code | varchar(30) | Không | FK → cm_ref_customer_status.code | Mặc định PROSPECT ở tầng nghiệp vụ |
| source_code | varchar(30) | Có | FK → cm_customer_sources.code | — |
| industry_code | varchar(30) | Có | FK → cm_customer_industries.code | — |
| sales_region_id | uuid | Có | FK → ref_business_regions.region_id | — |
| internal_note | text | Có | — | — |
| is_hidden | boolean | Không | — | DEFAULT FALSE |

**Ràng buộc/nghiệp vụ:** Khóa customer_id không đổi. Mã khách hàng không tự sửa. Trạng thái chỉ được cập nhật đúng luồng; không xóa vật lý khi đã có tham chiếu.


## 02. `cm_customer_legal`

**Mục đích:** Một bộ thông tin thuế/pháp lý hiện hành trên mỗi khách hàng.

| Cột | PostgreSQL / kiểu đề xuất | NULL | Khóa / FK | Ghi chú |
|---|---|---|---|---|
| customer_id | uuid | Không | PK, FK → cm_customers.customer_id | — |
| registered_name | varchar(255) | Có | — | — |
| tax_country_code | char(2) | Có | FK → ref_countries.country_code | — |
| tax_number | varchar(32) | Có | — | — |
| registered_address | text | Có | — | — |
| registered_admin_unit_id | uuid | Có | FK → ref_admin_units.admin_unit_id | — |
| representative_name | varchar(150) | Có | — | — |
| representative_phone | varchar(30) | Có | — | — |
| representative_title | varchar(100) | Có | — | — |
| business_sector_text | text | Có | — | — |

**Ràng buộc/nghiệp vụ:** Khách tiềm năng có thể chưa có hồ sơ legal. Điều kiện bắt buộc đối với khách giao dịch do logic nghiệp vụ xác nhận. Không UNIQUE tax_number cho đến khi quyết định cách xử lý trùng pháp nhân.


## 03. `cm_customer_contacts`

**Mục đích:** Nhiều người liên hệ cho một khách hàng.

| Cột | PostgreSQL / kiểu đề xuất | NULL | Khóa / FK | Ghi chú |
|---|---|---|---|---|
| contact_id | uuid | Không | PK | —; [PENDING] Đổi tên khóa PK theo báo cáo preflight |
| customer_id | uuid | Không | FK → cm_customers.customer_id | — |
| full_name | varchar(150) | Không | — | — |
| position_title | varchar(100) | Có | — | — |
| phone | varchar(30) | Có | — | — |
| zalo_phone | varchar(30) | Có | — | — |
| email | varchar(254) | Có | — | — |
| role_code | varchar(30) | Có | FK → cm_ref_contact_roles.code | — |
| is_primary | boolean | Không | — | DEFAULT FALSE |
| is_active | boolean | Không | — | DEFAULT TRUE |

**Ràng buộc/nghiệp vụ:** Cần ít nhất phone hoặc zalo_phone đối với liên hệ tối thiểu. Tối đa 1 liên hệ chính đang hoạt động / khách hàng (partial unique index sau khi duyệt).


## 04. `cm_customer_addresses`

**Mục đích:** Nhiều địa chỉ theo loại, giữ địa chỉ lịch sử.

| Cột | PostgreSQL / kiểu đề xuất | NULL | Khóa / FK | Ghi chú |
|---|---|---|---|---|
| address_id | uuid | Không | PK | —; [PENDING] Đổi tên khóa PK theo báo cáo preflight |
| customer_id | uuid | Không | FK → cm_customers.customer_id | — |
| address_type_code | varchar(30) | Không | FK → cm_ref_address_types.code | — |
| country_code | char(2) | Không | FK → ref_countries.country_code | — |
| admin_unit_id | uuid | Có | FK → ref_admin_units.admin_unit_id | — |
| address_line | text | Không | — | — |
| full_address_snapshot | text | Không | — | — |
| postal_code | varchar(20) | Có | — | — |
| recipient_name | varchar(150) | Có | — | — |
| recipient_phone | varchar(30) | Có | — | — |
| is_default | boolean | Không | — | DEFAULT FALSE |
| is_active | boolean | Không | — | DEFAULT TRUE |

**Ràng buộc/nghiệp vụ:** 1 mặc định/khách/loại địa chỉ đang hoạt động. Không tự cập nhật lại address snapshot khi đổi đơn vị hành chính.


## 05. `cm_customer_payments`

**Mục đích:** Hồ sơ điều kiện thanh toán, KHÔNG phải công nợ thực tế.

| Cột | PostgreSQL / kiểu đề xuất | NULL | Khóa / FK | Ghi chú |
|---|---|---|---|---|
| payment_id | uuid | Không | PK | —; [PENDING] Đổi tên khóa PK theo báo cáo preflight |
| customer_id | uuid | Không | FK → cm_customers.customer_id | — |
| profile_name | varchar(150) | Không | — | — |
| payment_method_code | varchar(30) | Không | FK → cm_ref_payment_methods.code | — |
| currency_code | char(3) | Không | FK → ref_currencies.currency_code | DEFAULT 'VND' (đề xuất) |
| payment_term_days | integer | Có | — | CHECK >= 0 |
| payment_terms_text | text | Có | — | — |
| is_default | boolean | Không | — | DEFAULT FALSE |
| is_active | boolean | Không | — | DEFAULT TRUE |

**Ràng buộc/nghiệp vụ:** Không lưu doanh thu/nợ phải thu/số tiền đã trả ở đây. 1 hồ sơ thanh toán mặc định đang hoạt động/khách.


## 06. `cm_customer_banks`

**Mục đích:** Nhiều tài khoản ngân hàng cho mỗi hồ sơ thanh toán.

| Cột | PostgreSQL / kiểu đề xuất | NULL | Khóa / FK | Ghi chú |
|---|---|---|---|---|
| bank_account_id | uuid | Không | PK | —; [PENDING] Đổi tên khóa PK theo báo cáo preflight |
| payment_id | uuid | Không | FK → cm_customer_payments.payment_id | — |
| bank_code | varchar(30) | Không | FK → ref_banks.bank_code | — |
| account_number | varchar(64) | Không | — | — |
| account_holder | varchar(255) | Không | — | — |
| branch_name | varchar(150) | Có | — | — |
| is_default | boolean | Không | — | DEFAULT FALSE |
| is_active | boolean | Không | — | DEFAULT TRUE |

**Ràng buộc/nghiệp vụ:** 1 tài khoản mặc định đang hoạt động/hồ sơ thanh toán. Số tài khoản là text và là dữ liệu cần hạn chế xuất/log.


## 07. `cm_customer_status_history`

**Mục đích:** Lịch sử thay đổi trạng thái hợp tác.

| Cột | PostgreSQL / kiểu đề xuất | NULL | Khóa / FK | Ghi chú |
|---|---|---|---|---|
| status_history_id | uuid | Không | PK | —; [PENDING] Đổi tên khóa PK theo báo cáo preflight |
| customer_id | uuid | Không | FK → cm_customers.customer_id | — |
| old_status_code | varchar(30) | Có | FK → cm_ref_customer_status.code | — |
| new_status_code | varchar(30) | Không | FK → cm_ref_customer_status.code | — |
| change_reason | text | Có | — | — |
| effective_at | timestamptz | Không | — | — |
| changed_account_id | uuid [PENDING: actor type] | Có | — | IAM mapping chưa xác nhận; [PENDING] Xác nhận kiểu actor IAM và policy không FK |
| source_module_code | varchar(50) | Có | — | — |
| source_record_key | varchar(100) | Có | — | — |

**Ràng buộc/nghiệp vụ:** Ghi nối tiếp lịch sử (không ghi đè). Không đồng nhất nhật ký nghiệp vụ với audit kỹ thuật Foundation.


## 08. `cm_customer_activities`

**Mục đích:** Timeline hoạt động thủ công và sự kiện tích hợp tương lai.

| Cột | PostgreSQL / kiểu đề xuất | NULL | Khóa / FK | Ghi chú |
|---|---|---|---|---|
| activity_id | uuid | Không | PK | —; [PENDING] Đổi tên khóa PK theo báo cáo preflight |
| customer_id | uuid | Không | FK → cm_customers.customer_id | — |
| activity_type_code | varchar(30) | Không | FK → cm_ref_activity_types.code | — |
| activity_status_code | varchar(30) | Không | FK → cm_ref_activity_statuses.code | — |
| title | varchar(255) | Không | — | — |
| description | text | Có | — | — |
| activity_at | timestamptz | Không | — | — |
| due_at | timestamptz | Có | — | — |
| source_module_code | varchar(50) | Có | — | — |
| source_record_key | varchar(100) | Có | — | — |
| source_event_key | varchar(150) | Có | — | — |

**Ràng buộc/nghiệp vụ:** source_event_key cần quy tắc uniqueness/idempotency với module nguồn, chưa tự chọn constraint khi thiếu hợp đồng sự kiện. “Không có hoạt động” là trạng thái truy vấn suy ra, không phải activity_type.


## 09. `cm_customer_documents`

**Mục đích:** Metadata tài liệu; file lưu ngoài Database.

| Cột | PostgreSQL / kiểu đề xuất | NULL | Khóa / FK | Ghi chú |
|---|---|---|---|---|
| document_id | uuid | Không | PK | —; [PENDING] Đổi tên khóa PK theo báo cáo preflight |
| customer_id | uuid | Không | FK → cm_customers.customer_id | — |
| document_type_code | varchar(30) | Không | FK → cm_ref_document_types.code | — |
| file_name | varchar(255) | Không | — | — |
| storage_key | varchar(500) | Không | — | — |
| mime_type | varchar(100) | Không | — | — |
| file_size | bigint | Không | — | CHECK >= 0 |
| sha256 | char(64) | Có | — | — |
| document_note | text | Có | — | — |

**Ràng buộc/nghiệp vụ:** Backend tương lai xử lý upload/download, bảo vệ file và phân quyền; metadata không chứa binary PDF.


## 10. `cm_customer_groups`

**Mục đích:** Nhóm khách hàng phân cấp.

| Cột | PostgreSQL / kiểu đề xuất | NULL | Khóa / FK | Ghi chú |
|---|---|---|---|---|
| group_id | uuid | Không | PK | —; [PENDING] Đổi tên khóa PK theo báo cáo preflight |
| group_code | varchar(30) | Không | UNIQUE | — |
| group_name | varchar(150) | Không | — | — |
| parent_group_id | uuid | Có | FK → cm_customer_groups.group_id | — |
| description | text | Có | — | — |
| is_active | boolean | Không | — | DEFAULT TRUE |

**Ràng buộc/nghiệp vụ:** Không cho phép cấu trúc nhóm có vòng; cần xử lý phù hợp ở backend/DB sau phê duyệt.


## 11. `cm_customer_group_members`

**Mục đích:** N–N: khách hàng thuộc nhiều nhóm.

| Cột | PostgreSQL / kiểu đề xuất | NULL | Khóa / FK | Ghi chú |
|---|---|---|---|---|
| customer_id | uuid | Không | PK(composite), FK → cm_customers.customer_id | — |
| group_id | uuid | Không | PK(composite), FK → cm_customer_groups.group_id | — |
| assigned_account_id | uuid [PENDING: actor type] | Có | — | IAM mapping chưa xác nhận; [PENDING] Xác nhận kiểu actor IAM và policy không FK |

**Ràng buộc/nghiệp vụ:** Khóa PK (customer_id, group_id). Khả năng ngừng liên kết rồi tái kích hoạt cần quyết định trước khi thêm retired_at hoặc lịch sử membership.
