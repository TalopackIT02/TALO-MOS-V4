# Data Dictionary — phần bổ sung so với R2 (không mô tả lại 114 cột đã cài)

## A. 3 cột thêm vào bảng cũ

| Bảng | Cột | Kiểu/Default | Ràng buộc / Lý do |
|---|---|---|---|
| `cm.cm_customers` | `record_status_code` | varchar(12), NOT NULL, DEFAULT `DRAFT` | `DRAFT`/`VERIFIED`, độc lập `customer_status_code`; VERIFIED bắt buộc pháp lý |
| `cm.cm_customer_assignments` | `assignment_role_code` | varchar(16), NOT NULL, DEFAULT `PRIMARY` | `PRIMARY` / `SUPPORT`; tối đa một PRIMARY hiệu lực, nhiều SUPPORT khác Sale |
| `cm.cm_customer_documents` | `supersedes_document_id` | uuid NULL | FK tự tham chiếu **cùng khách hàng**, một phiên bản gốc chỉ có tối đa một bản thay thế trực tiếp |

## B. 4 bảng mới

### B1. `cm_customer_legal_change_requests`

20 cột: `change_request_id uuid PK`, `customer_id uuid FK`, `requested_by_account_id uuid`, `requested_at timestamptz`, `status_code varchar(24)`, `reason text`, `evidence_document_id uuid`, `old_legal_name varchar(255)`, `new_legal_name varchar(255)`, `old_country_code char(2)`, `new_country_code char(2)`, `old_customer_type_code varchar(30)`, `new_customer_type_code varchar(30)`, `old_identifier_type_code varchar(30)`, `new_identifier_type_code varchar(30)`, `old_identifier_normalized varchar(128)`, `new_identifier_normalized varchar(128)`, `resolved_at timestamptz`, `applied_at timestamptz`, `applied_by_account_id uuid`.

Chứng từ trỏ đến `cm_customer_documents` **của cùng customer**. Request giữ snapshot cũ và giá trị dự kiến; không cho UPDATE nội dung request. Chỉ một yêu cầu pháp lý đang xử lý cho một khách hàng.

### B2. `cm_customer_legal_change_approvals`

7 cột: `approval_id uuid PK`, `change_request_id uuid FK`, `stage_code varchar(16)`, `decision_code varchar(12)`, `decided_by_account_id uuid`, `decided_at timestamptz`, `decision_note text`. UNIQUE (request, stage). Hai bước `MANAGEMENT` và `ACCOUNTING` ở bản v1. Người yêu cầu và người duyệt là 2 permission độc lập, điều kiện không tự duyệt kiểm tại Backend.

### B3. `cm_customer_handovers`

21 cột: `handover_id uuid PK`, `customer_id uuid FK`, `from_assignment_id uuid FK cùng customer`, `to_sale_account_id uuid`, `initiated_by_account_id uuid`, `handover_mode_code varchar(20)`, `status_code varchar(26)`, `requested_at timestamptz`, `manager_approved_by_account_id uuid`, `manager_approved_at timestamptz`, `current_ack_by_account_id uuid`, `current_ack_at timestamptz`, `current_ack_override_by_account_id uuid`, `current_ack_override_reason text`, `receiver_ack_by_account_id uuid`, `receiver_ack_at timestamptz`, `rejected_by_account_id uuid`, `rejected_at timestamptz`, `rejection_reason text`, `completed_at timestamptz`, `handover_note text`. Một handover PENDING mỗi customer.

### B4. `cm_customer_handover_activity_transfers`

8 cột: `transfer_id uuid PK`, `handover_id uuid FK`, `activity_id uuid FK`, `customer_id uuid`, `previous_assignee_account_id uuid`, `new_assignee_account_id uuid`, `transferred_by_account_id uuid`, `transferred_at timestamptz`. Các FK kép buộc handover, activity thuộc **cùng khách hàng**. UNIQUE (handover_id, activity_id).

## C. Business transaction cần Backend triển khai (không thêm trigger)

1. **Create Customer:** DB cấp sequence, Backend lưu mã 6 chữ số, tạo DRAFT. Với VERIFIED, Backend kiểm tra MST/địa chỉ và các CHECK hiện có.
2. **Legal Update:** INSERT yêu cầu + evidence → quản lý APPROVE → kế toán APPROVE → transaction khóa khách hàng/request (`SELECT … FOR UPDATE`), kiểm tra snapshot và uniqueness → UPDATE pháp lý + request status `APPLIED`; audit kết quả. `PATCH /customers/:id` không cho đổi trường pháp lý.
3. **Handover:** Tạo request ở status phù hợp theo mode → quản lý/Sale cũ/Sale mới xác nhận (Sale cũ đã khóa tài khoản: quản lý được ủy quyền thay thế với lý do override và audit) → transaction khóa khách hàng + assignment + handover → đóng PRIMARY cũ + tạo PRIMARY mới + chuyển các activity OPEN do Sale cũ phụ trách + insert transfer history + cập nhật handover COMPLETED. Tất cả trong một DB transaction.
4. **Supporting Sale:** cho nhiều assignment SUPPORT có `ended_at IS NULL` nhưng chỉ một PRIMARY. Scope xem từ cả hai nhóm; quyền sửa theo IAM riêng.
5. **Document version:** upload file khác khóa storage → INSERT bản mới `supersedes_document_id` (cùng khách); chỉ công nhận file đã ghi thành công; không xóa bản cũ. `PATCH /metadata` chỉ sửa trường không làm mất metadata file gốc.
6. **Audit/Event:** không đồng nhất activity timeline với audit; xác minh và tái sử dụng cơ chế Foundation thực tế. Không có cơ chế audit phù hợp thì đánh dấu hạng mục phụ thuộc, không báo PASS.

## D. Quy tắc tránh hiểu nhầm

- `record_status_code` là trạng thái hoàn thiện hồ sơ; `customer_status_code` vẫn là trạng thái hợp tác. Không thay đổi mã quan hệ khách hàng đã chốt.
- Snapshot cũ/mới được **lưu trong bảng yêu cầu** và phê duyệt; không được thay thế audit toàn cục nếu Foundation yêu cầu khác.
- Gói ứng viên không thêm bảng cấu hình quy trình phê duyệt, tự động hóa hoặc lịch sử tình trạng tài liệu: trạng thái hạn tài liệu được tính từ ngày và ngưỡng do Backend cấu hình.
- Giá trị role/status trong migration là code contract, không phải quyền IAM đã đăng ký.
