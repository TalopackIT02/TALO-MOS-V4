# 20 Business Rules → Database / Backend / MIC

| Rule | Database | Backend và MIC |
|---|---|---|
| BR-01 | assignment role + partial unique | Permission READ và object-scope PRIMARY/SUPPORT |
| BR-02 | giữ nguyên | `customer.create` ánh xạ quyền Foundation/IAM |
| BR-03 | request + approval + evidence FK | legal request / approve management / approve accounting / audit |
| BR-04 | `customer_id` ổn định | Chỉ mở API tích hợp khi module khác tồn tại; trace + service auth |
| BR-05 | `record_status_code`, CHECK VERIFIED | DRAFT/VERIFY riêng; chặn dùng DRAFT cho đơn hàng |
| BR-06 | UNIQUE định danh R2 giữ | normalize/validation + xử lý 409 tại Backend |
| BR-07 | không đổi | Parent/branch phase 2 |
| BR-08 | FK tỉnh/xã R2 giữ | kiểm tra dropdown, nước ngoài, missing reference |
| BR-09 | `assignment_role_code`, indexes mới | tạo SUPPORT, PRIMARY, cập nhật history |
| BR-10 | handovers + status/check/index | hai luồng approval/ack, không cho trạng thái nhảy |
| BR-11 | activity transfers + FK | chuyển OPEN trong transaction, ghi old/new |
| BR-12 | không xây audit global | đối chiếu Foundation Audit/Event và correlation ID |
| BR-13 | group tables hiện có | group.read/manage/assign; CRUD tối thiểu |
| BR-14 | documents hiện có | upload PDF/JPG/PNG; kiểm file, khóa storage an toàn |
| BR-15 | ngày hiệu lực hiện có | trạng thái tính toán, ngưỡng cấu hình |
| BR-16 | supersedes_document_id | history, mới không ghi đè cũ |
| BR-17 | giữ index nền | search/filter/sort + scope trước count/page |
| BR-18 | không đổi | export CSV permission riêng, scope và injection guard |
| BR-19 | evidence legal/transfer không thay global audit | audit operations + masking PII |
| BR-20 | 15 bảng sau migration nếu duyệt | test tổng hợp, regression IAM/Foundation |

## MIC/Module Contract

**Không tự dựng file MIC theo tên trường đoán.** Claude phải xem `foundation.preflight.ts`, schema MIC-01..MIC-xx, gói module TEST chạy được và IAM function registry hiện tại. Tạo ma trận `API method+path -> action -> function key -> DB object+columns+grant -> object scope`, trong đó có tối thiểu:

- Customer read/create/update/verify/hide;
- Contact read/manage; Group read/manage/assign;
- Assignment read/manage, handover request/approve/ack/reject;
- Activity read/create/update/complete;
- Document read/manage/version/download;
- Legal request/approve management/approve accounting;
- Reference read; Export CSV.

**Foundation MIC-06 là khai báo table/data access và khả năng SELECT thực tế; không thay thế quyền IAM.** Mã chức năng chính thức phải tuân naming convention phát hiện từ repo, không hardcode vai trò `SALE`/`MANAGER` theo chuỗi.
