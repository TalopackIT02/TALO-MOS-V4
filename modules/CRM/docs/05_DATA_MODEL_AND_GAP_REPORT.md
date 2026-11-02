# 05 — Mô hình dữ liệu và báo cáo GAP (đầu vào Gate 2)

Nguồn: DB Dictionary đã nghiệm thu (`01_DATABASE/01_ALL_COLUMNS_173.csv`) — **15 bảng / 173 cột** schema `cm`, đã cài trên TEST theo GO `CM_BE_REV01_DB_TEST_ONLY` (fingerprint cm `8b4b0362…`, 0 khách hàng). Gate 1 **không** tạo SQL, migration hay thay đổi DB nào.

## 1. Đối chiếu bảng DB ↔ đối tượng Mock

| Bảng `cm` | Cột | Đối tượng mock | Trường mock khớp cột | Khác biệt / chỉ có trong mock |
|---|---:|---|---|---|
| cm_customers | 24 | `Customer` | customer_id, customer_code, display_name, legal_name, registered_address, representative_name/phone, customer_type_code, customer_status_code, internal_note, created_at/account, updated_at, is_hidden, legal_identifier_type_code, legal_identifier_normalized (`legalIdentifier`), address_line, province_code, ward_code, country_code, foreign_locality, foreign_state_province, record_status_code | Mock thiếu `updated_account_id`; `groupIds` là bản sao tiện dụng của `cm_customer_group_members` |
| (dẫn xuất) | — | `CustomerView` | — | `primarySaleAccountId`, `supportSaleAccountIds` (từ assignments), `regionCode`, `macroRegionCode` (từ `cm_ref_province_region_map`), `identifierMasked` (OD-05) — **không lưu**, tính khi đọc |
| cm_customer_contacts | 12 | `Contact` | đủ trường nghiệp vụ | Mock không giữ created_at/updated_at/created_account_id |
| cm_customer_groups | 8 | `Group` | group_id, group_code, group_name, parent_group_id, description, is_active | thiếu created_at/account |
| cm_customer_group_members | 4 | `Customer.groupIds` | customer_id, group_id | thiếu assigned_at/account |
| cm_customer_assignments | 12 | `Assignment` | assignment_id, customer_id, sale_account_id, assignment_role_code (`role`), assigned_at/by, ended_at/by, handover_to_account_id | thiếu handover_note, handover_accepted_at/by (ghi ở `Handover`) |
| cm_customer_activities | 12 | `Activity` | đủ (type/status code khớp NOTE/CALL/MEETING/TASK/FOLLOW_UP/HANDOVER; OPEN/DONE/CANCELLED) | thiếu created_at |
| cm_customer_documents | 15 | `CrmDocument` | đủ, trừ storage_path | **storage_path không dùng** (BLOCKED storage); `mockOnly` = cờ mock |
| cm_ref_provinces / cm_ref_wards | 8 / 9 | `Province`, `Ward` | code, name | Mock chỉ 6 tỉnh × 5 xã **dữ liệu TEST**, không phải danh mục 34/3.321 |
| cm_ref_economic_regions | 6 | `REGIONS` | region_code, region_name | 6 vùng, tên hiển thị TEST |
| cm_ref_province_region_map | 7 | `Province.region/macro` | province_code, region_code, macro_region_code | không có version/valid_* |
| cm_customer_legal_change_requests | 20 | `LegalChange` | đủ trường old/new, reason, evidence_document_id, status, applied_at | `oldIdentifier/newIdentifier` = *_identifier_normalized; thiếu resolved_at, applied_by |
| cm_customer_legal_change_approvals | 7 | `LegalChange.decisions[]` | stage, decision, decided_by/at, note | lồng trong request (mock) |
| cm_customer_handovers | 21 | `Handover` | đủ các account id & trạng thái, override reason, rejection reason, completed_at, note | thiếu các cột *_at riêng từng bước (manager_approved_at, current_ack_at, receiver_ack_at, rejected_at) |
| cm_customer_handover_activity_transfers | 8 | `Handover.transferredActivityIds` | handover_id, activity_id | mock chỉ giữ danh sách id; DB giữ previous/new assignee, transferred_by/at |

Mã lựa chọn (customer_type, customer_status, identifier_type, activity_type/status, document_type) trong mock **khớp đúng** CODE_CONTRACT của dictionary.

## 2. Đối tượng chỉ có trong Mock — chưa có bảng (GAP Gate 2)

### GAP-DB-01 — Lịch hẹn (`Appointment`)
| Trường mock | Kiểu | Bắt buộc | Quy tắc | Đề xuất cột (chỉ để thảo luận Gate 2) |
|---|---|---|---|---|
| appointmentId | id | ✔ | khóa | appointment_id uuid PK |
| title | text | ✔ | không rỗng | title |
| customerId | id \| null | | phải trong phạm vi người tạo | customer_id FK cm_customers (nullable) |
| contactId | id \| null | | liên hệ còn hiệu lực của chính khách đó | contact_id FK cm_customer_contacts |
| ownerAccountId | account | ✔ | = người tạo; chỉ owner sửa/hủy | owner_account_id |
| startAt, endAt | timestamptz | ✔ | endAt > startAt | start_at, end_at + CHECK |
| location, description | text | | | location, description |
| remindMinutes | int \| null | | 0 (không nhắc) / 10 / 30 / 60 / 1440 phút; nhắc trong app | remind_minutes |
| status | SCHEDULED/DONE/CANCELLED | ✔ | chỉ SCHEDULED được sửa/hủy/kết quả | status_code + CHECK |
| cancelReason | text | khi CANCELLED | bắt buộc khi hủy | cancel_reason |
| outcome | text | khi DONE | bắt buộc khi đánh dấu đã diễn ra | outcome |
| createdAt | timestamptz | ✔ | | created_at |
| (trạng thái đã tắt nhắc) | `dismissedReminders[]` | | theo người dùng | bảng/cột riêng hoặc client-side — cần quyết định |

### GAP-DB-02 — Công việc (`Task`)
REV01 chỉ có `cm_customer_activities` (type TASK, OPEN/DONE/CANCELLED) — **thiếu** ưu tiên, tiến độ, IN_PROGRESS, người tạo khác người làm, công việc không gắn khách.
| Trường mock | Kiểu | Bắt buộc | Quy tắc |
|---|---|---|---|
| taskId | id | ✔ | |
| title | text | ✔ | không rỗng |
| description | text | | |
| customerId | id \| null | | trong phạm vi |
| assigneeAccountId | account | ✔ | đổi người → history REASSIGN |
| createdByAccountId | account | ✔ | |
| dueAt | timestamptz \| null | | quá hạn = dueAt < now và chưa DONE/CANCELLED |
| priority | LOW/MEDIUM/HIGH | ✔ | |
| status | TODO/IN_PROGRESS/DONE/CANCELLED | ✔ | progress > 0 → IN_PROGRESS; DONE/CANCELLED là cuối |
| progress | 0..100 | ✔ | bước 10; DONE → 100 |
| completedAt | timestamptz \| null | | |
| createdAt | timestamptz | ✔ | |
| history[] | {at, fromAccountId, toAccountId, reason HANDOVER/REASSIGN, handoverId} | | lịch sử chuyển người làm |
Phương án cần quyết định (OD-06): mở rộng `cm_customer_activities` hay bảng `cm_tasks` riêng + bảng lịch sử.

### GAP-DB-03 — Báo cáo công việc (`WorkReport`)
| Trường mock | Kiểu | Bắt buộc | Quy tắc |
|---|---|---|---|
| reportId | id | ✔ | |
| authorAccountId | account | ✔ | = người tạo |
| workDate | date | ✔ | |
| workDone | text | ✔ | |
| results | text | ✔ | |
| issues, nextSteps | text | | |
| customerIds[], appointmentIds[], taskIds[] | liên kết n-n | | chỉ đối tượng trong phạm vi |
| status | DRAFT/SUBMITTED | ✔ | SUBMITTED chỉ đọc |
| submittedAt | timestamptz | khi nộp | |
| updatedAt | timestamptz | ✔ | |
Cần 1 bảng báo cáo + 3 bảng liên kết (hoặc 1 bảng liên kết đa hình) — Gate 2.

### GAP-DB-04 — Chuyển To-do khi bàn giao (Target Design)
Cần: (a) bảng To-do (GAP-DB-02); (b) bảng lịch sử chuyển To-do tương tự `cm_customer_handover_activity_transfers` (handover_id, task_id, previous/new assignee, transferred_by/at); (c) bổ sung vào giao dịch hoàn tất bàn giao của Backend. Không thuộc REV01 — OD-07.

## 3. GAP API
| Mã | Nội dung |
|---|---|
| GAP-API-01 | Tạo khách tổng hợp (hồ sơ + liên hệ + Sale + nhóm + xác minh) không có endpoint giao dịch; REV01 là 5 lệnh riêng → nguy cơ hồ sơ dở dang nếu bước sau lỗi. Phương án: endpoint tổng hợp, hoặc Adapter gọi tuần tự + bù trừ — OD-03 |
| GAP-API-02 | Lịch hẹn, nhắc lịch: không có endpoint |
| GAP-API-03 | Công việc (To-do): không có endpoint |
| GAP-API-04 | Báo cáo + báo cáo theo khách hàng: không có endpoint |
| GAP-API-05 | Duyệt pháp lý (management/accounting): REV01 nêu quyền nhưng không liệt kê path |
| GAP-API-06 | Xuất CSV: REV01 nêu quyền export nhưng không liệt kê path |
| GAP-API-07 | Kết thúc phân công SUPPORT: không có path riêng |

## 4. GAP IAM / MIC / Host
| Mã | Nội dung |
|---|---|
| GAP-IAM-01 | Chưa có mã quyền cho Lịch hẹn / Công việc / Báo cáo (mock dùng quyền sở hữu + `customer.read_all`) |
| GAP-IAM-02 | Quyền `crm.*` chưa đăng ký với IAM/MIC (cấm trong Gate 1) |
| GAP-HOST-01 | Module Host chỉ cấp `readOnly` → Backend CRM `BLOCKED_BY_MODULE_HOST_WRITE_CAPABILITY` |
| GAP-STO-01 | Storage file chưa được duyệt → upload/download BLOCKED |
| GAP-AUD-01 | Audit/Event Foundation cho thao tác CRM (BR-12/19) chưa tích hợp. Mock có Audit demo (`MockState.audit`, chỉ trong trình duyệt) — không phải thiết kế lưu trữ audit; audit thật dùng Foundation, không thêm bảng CRM |
