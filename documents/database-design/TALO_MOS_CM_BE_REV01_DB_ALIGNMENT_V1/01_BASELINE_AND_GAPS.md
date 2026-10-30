# Đối chiếu SQL REV01 R2 với Backend REV01

**Mức chứng cứ:** SQL R2 lấy trực tiếp từ ZIP R2 đã gửi. Việc R2 đã cài TEST theo báo cáo chủ dự án, chưa có `pg_dump --schema-only` sau khi cài để đối chiếu độc lập.

| Mảng Backend | R2 hiện có | Chênh lệch cần xử lý |
|---|---|---|
| BR-01/09 Sale chính + hỗ trợ | `cm_customer_assignments` 11 cột; index `uq_cm_customer_assignments_current WHERE ended_at IS NULL` | Index chỉ cho 1 dòng hoạt động; thêm role + thay index |
| BR-05 DRAFT/VERIFIED | `customer_status_code` quan hệ KH, CHECK theo `PROSPECT` | Thêm `record_status_code` độc lập; thay `ck_cm_customers_official_profile` |
| BR-03 Thay MST/pháp lý hai cấp | Khách hàng có định danh; tài liệu có chứng từ nhưng không có request + approval | Thêm bảng `legal_change_requests`, `legal_change_approvals` |
| BR-10 Bàn giao hai luồng | Có `handover_*` trên assignment đã kết thúc | Không có pending/approve/ack; thêm `cm_customer_handovers` |
| BR-11 Chuyển công việc còn mở | `cm_customer_activities.assigned_to_account_id` được UPDATE | Không có bản ghi lịch sử old/new assignee; thêm bảng chuyển việc |
| BR-16 Phiên bản tài liệu | 14 cột + file storage | Thêm `supersedes_document_id` + FK cùng khách hàng; không ghi đè file |
| BR-13 Nhóm ngành | `groups`, `group_members` đầy đủ | Không bổ sung bảng; dùng CRUD hiện tại |
| BR-07 Đơn vị mẹ/chi nhánh | Chỉ có mã loại BRANCH | Phân hệ mẹ/chi nhánh chuyển Phase 2, không thêm cột |
| BR-08 địa chỉ, BR-06 trùng định danh | tỉnh/xã FK, mã chuẩn hóa UNIQUE | Backend validation và đối chiếu danh mục, không đổi schema |
| BR-14/15 File & hết hạn | Metadata + signed/effective/expiry | Backend storage và tính trạng thái, không đổi bảng ngoài version link |
| BR-12/19 Audit & intermodule | R2 không có global audit/event | Kiểm tra Foundation thực tế; không lập hệ audit thay thế |
| BR-17/18 Search & export | Index nền tảng | Query scoped và chống CSV injection ở Backend, không đổi schema bắt buộc |

**Chỗ chưa được xem là hoàn thành chỉ bởi migration:** IAM scope, approval rule/step runtime, atomic file storage, audit handler, MIC ID/permissions. Đó là trách nhiệm Backend/Foundation runtime, phải khảo sát rồi implement và test.
