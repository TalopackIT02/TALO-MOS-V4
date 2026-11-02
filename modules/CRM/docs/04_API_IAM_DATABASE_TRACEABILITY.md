# 04 — Truy vết Screen → Function → Action → Mock → API → IAM → DB → BR → TC → Status

Quy ước:
- **API**: chỉ dùng 40 endpoint của Backend Spec REV01 (`02_BACKEND/01_API_ENDPOINTS_FROM_SPEC.csv`, tất cả `PROPOSED_NOT_IMPLEMENTED_VERIFIED`). Cột ghi **hậu tố đường dẫn** đúng như REV01; tiền tố thật do Module Host quyết định khi có write capability. `—` = REV01 **không có** endpoint → GAP. Không tự đặt endpoint mới.
- **IAM**: mã quyền dự kiến K05 `crm.<function>.<action>` (`docs/PERMISSIONS.md`) — **chưa đăng ký**, mock giả lập.
- **DB**: bảng schema `cm` đã cài trên TEST (15 bảng / 173 cột, fingerprint `8b4b0362…`). `—` = không có bảng → GAP (Gate 2).
- **Status**: `MOCK` (chạy trên Mock Adapter, có test) · `BLOCKED` (phụ thuộc chưa duyệt) · `GAP` (thiếu hợp đồng API/DB) · `NOT_TESTED`. Không dòng nào là `IMPLEMENTED`: Backend `modules/CRM/backend/index.ts` là stub `BLOCKED_BY_MODULE_HOST_WRITE_CAPABILITY`.

## 1. Khách hàng

| Screen | Function | Action | Mock method | API (REV01) | IAM | DB | BR | TC | Status |
|---|---|---|---|---|---|---|---|---|---|
| Khách hàng | Danh sách | tìm/lọc/sắp xếp/trang | `listCustomers` | GET `/customers` | customer.read (+read_all) | cm_customers, cm_customer_assignments, cm_ref_province_region_map | 01, 17 | TC-11..14, 48 | MOCK |
| Khách hàng | Lọc Miền/Vùng | lọc | `listCustomers`, `regions` | GET `/customers`, GET `/references/regions` | reference.read | cm_ref_economic_regions, cm_ref_province_region_map | 17 | — | MOCK |
| Khách hàng | Xem nhanh / hồ sơ | xem | `customerBundle` | GET `/customers/:id` | customer.read | cm_customers + bảng con | 01 | TC-11, 12, 13 | MOCK |
| Khách hàng | Kiểm định danh | kiểm tra | `checkIdentity` | GET `/customers/check-identity` | customer.create/update | cm_customers (unique định danh) | 06 | TC-06, 07, 08, 10 | MOCK |
| Khách hàng | Tạo (form 4 nhóm) | lưu Draft / lưu và xác minh | `createCustomerFull` | — (tổng hợp) gồm POST `/customers` + POST `/customers/:id/contacts` + POST `/customers/:id/assignments` + PUT `/customers/:id/groups` + POST `/customers/:id/verify` | customer.create, contact.manage, assignment.manage, group.assign, customer.verify | cm_customers, cm_customer_contacts, cm_customer_assignments, cm_customer_group_members | 02, 05, 06, 08, 09, 13 | TC-01, 04, 05, 16 | MOCK + **GAP-API-01** |
| Khách hàng | Xác minh | DRAFT→VERIFIED | `verifyCustomer` | POST `/customers/:id/verify` | customer.verify | cm_customers.record_status_code | 05 | TC-03, 04 | MOCK |
| Khách hàng | Sửa thông tin | sửa | `updateCustomer` | PATCH `/customers/:id` | customer.update | cm_customers | 05, 08 | TC-15, 19 | MOCK |
| Hồ sơ | Ẩn hồ sơ | ẩn | `hideCustomer` | POST `/customers/:id/hide` | customer.hide | cm_customers.is_hidden | 17 | — | MOCK (hiện lại hồ sơ: không có trong REV01, không làm) |
| Khách hàng | Xuất CSV | xuất | `exportCustomersCsv` | — (REV01 nêu quyền export, không có path) | customer.export | cm_customers | 18 | TC-17, 18, 49 | MOCK + GAP (path) |
| Hồ sơ | Pháp lý | đề nghị | `requestLegalChange` | POST `/customers/:id/legal-changes` | legal_change.request | cm_customer_legal_change_requests | 03 | TC-19, 20, 24 | MOCK |
| Hồ sơ / Tổng quan | Pháp lý | duyệt quản lý / kế toán | `decideLegalChange` | — (REV01 không liệt kê path duyệt) | legal_change.approve_management / approve_accounting | cm_customer_legal_change_approvals | 03 | TC-21, 22, 23 | MOCK + GAP (path) |
| Hồ sơ / Tổng quan | Pháp lý | danh sách | `listLegalChanges` | GET `/customers/:id/legal-changes` | legal_change.read | cm_customer_legal_change_requests | 03 | — | MOCK |
| Hồ sơ | Liên hệ | xem/thêm/sửa/ngừng | `customerBundle`, `createContact`, `updateContact`, `deactivateContact` | GET/POST `/customers/:id/contacts`, PATCH `/customers/:id/contacts/:contactId`, POST `…/deactivate` | contact.read / contact.manage | cm_customer_contacts | — | — | MOCK |
| Hồ sơ | Nhóm ngành | gán | `setCustomerGroups` | PUT `/customers/:id/groups` | group.assign | cm_customer_group_members | 13 | — | MOCK |
| Hồ sơ | Danh mục nhóm | tạo/sửa | `createGroup`, `updateGroup` | POST `/groups`, PATCH `/groups/:id` | group.manage | cm_customer_groups | 13 | — | MOCK |
| Hồ sơ | Phân công | thêm/kết thúc | `addAssignment`, `endAssignment` | GET/POST `/customers/:id/assignments` (kết thúc: —) | assignment.read / assignment.manage | cm_customer_assignments | 01, 09 | TC-25, 26, 35 | MOCK (kết thúc: GAP path) |

## 2. Bàn giao

| Screen | Function | Action | Mock method | API (REV01) | IAM | DB | BR | TC | Status |
|---|---|---|---|---|---|---|---|---|---|
| Hồ sơ | Bàn giao | yêu cầu (A/B) | `requestHandover` | POST `/customers/:id/handovers` | handover.request | cm_customer_handovers | 10 | TC-27, 28 | MOCK |
| Tổng quan (Chờ tôi xử lý) | Bàn giao | danh sách | `listHandovers` | GET `/handovers`, GET `/handovers/:id` | assignment.read | cm_customer_handovers | 10 | — | MOCK |
| Hồ sơ / Tổng quan | Bàn giao | duyệt | `approveHandover` | POST `/handovers/:id/approve` | handover.approve | cm_customer_handovers | 10 | TC-28 | MOCK |
| Hồ sơ / Tổng quan | Bàn giao | xác nhận / xác nhận thay / nhận | `acknowledgeHandover` | POST `/handovers/:id/acknowledge` | handover.acknowledge (+override) | cm_customer_handovers, cm_customer_assignments, cm_customer_handover_activity_transfers, cm_customer_activities | 10, 11 | TC-29, 30, 31, 32, 33 | MOCK |
| Hồ sơ / Tổng quan | Bàn giao | chuyển To-do | `acknowledgeHandover` (Target Design) | — | — | — (không có bảng To-do) | — | — | MOCK **Target Design** + GAP-DB-04 |
| Hồ sơ / Tổng quan | Bàn giao | từ chối | `rejectHandover` | POST `/handovers/:id/reject` | handover.reject | cm_customer_handovers | 10 | — | MOCK |

## 3. Hoạt động và tài liệu

| Screen | Function | Action | Mock method | API (REV01) | IAM | DB | BR | TC | Status |
|---|---|---|---|---|---|---|---|---|---|
| Hồ sơ (Hoạt động & Kết quả) / Tổng quan | Hoạt động | xem/tạo/sửa/hoàn thành | `customerBundle`, `createActivity`, `updateActivity`, `completeActivity` | GET/POST `/customers/:id/activities`, PATCH `/activities/:id`, POST `/activities/:id/complete` | activity.read/create/update/complete | cm_customer_activities | 11, 12 | TC-34 | MOCK |
| Hồ sơ | Timeline | xem | (`customerBundle.activities`) | GET `/customers/:id/timeline` | activity.read | cm_customer_activities | 12 | TC-35, 36 | MOCK (nguồn tích hợp: N/A) |
| Hồ sơ (Tài liệu) | Tài liệu | metadata / phiên bản | `createDocument`, `updateDocumentMetadata` | POST `/customers/:id/documents`, POST `/documents/:id/versions`, PATCH `/documents/:id/metadata` | document.manage | cm_customer_documents | 14, 16 | TC-37, 38, 41 | MOCK (metadata) / **BLOCKED** (file) |
| Hồ sơ (Tài liệu) | Tài liệu | tải xuống | — (không có nút) | GET `/documents/:id/download` | document.read | cm_customer_documents.storage_* | 14 | TC-39, 42 | **BLOCKED** (storage) |
| Tổng quan | Tài liệu hết hạn | xem | `expiringDocuments(30)` | GET `/documents/expiring` | document.read | cm_customer_documents | 15 | TC-40 | MOCK (ngưỡng D06) |

## 4. Lịch hẹn, Công việc, Báo cáo (không có trong REV01)

| Screen | Function | Action | Mock method | API (REV01) | IAM | DB | BR | TC | Status |
|---|---|---|---|---|---|---|---|---|---|
| Lịch hẹn / Hồ sơ | Lịch hẹn | xem ngày/tuần/tháng | `listAppointments` | — | — (chưa thiết kế) | — | — | — | MOCK + GAP-API-02, GAP-DB-01, GAP-IAM-01 |
| Lịch hẹn / Hồ sơ | Lịch hẹn | tạo/sửa/hủy/kết quả | `createAppointment`, `updateAppointment`, `cancelAppointment`, `completeAppointment` | — | — | — | — | — | MOCK + GAP |
| Toàn module | Nhắc lịch | nhắc trong app | `dueReminders`, `dismissReminder` | — | — | — | — | — | MOCK + GAP |
| Công việc / Hồ sơ / Tổng quan | To-do | xem/tạo/sửa/hoàn thành | `listTasks`, `createTask`, `updateTask`, `completeTask` | — | — | — (REV01 chỉ có `cm_customer_activities`, thiếu ưu tiên/tiến độ) | — | — | MOCK + GAP-DB-02 |
| Báo cáo / Hồ sơ | Báo cáo | xem/viết/nộp/lọc | `listReports`, `createReport`, `updateReport`, `submitReport` | — | — | — | — | — | MOCK + GAP-DB-03 |

## 5. Danh mục và phiên

| Function | Mock method | API (REV01) | IAM | DB | Status |
|---|---|---|---|---|---|
| Tỉnh / xã | `provinces` | GET `/references/provinces`, GET `/references/wards?provinceCode=…` | reference.read | cm_ref_provinces, cm_ref_wards | MOCK (6 tỉnh mẫu) |
| Miền / vùng | `regions` | GET `/references/regions` | reference.read | cm_ref_economic_regions, cm_ref_province_region_map | MOCK |
| Loại khách hàng | hằng số `CUSTOMER_TYPE` | GET `/references/customer-types` | reference.read | (CHECK constraint) | MOCK |
| Danh mục nhóm | `groups` | GET `/groups` | group.read | cm_customer_groups | MOCK |
| Phiên / quyền | `session`, `accounts` | Host capability `session`, `authorize`, `evaluate` | — | IAM (Foundation) | MOCK (persona giả lập) |

## 6. Endpoint REV01 chưa có màn hình dùng
GET `/customers/:id/contacts` (dữ liệu lấy trong bundle), GET `/customers/:id/activities` (bundle), GET `/customers/:id/assignments` (bundle), GET `/customers/:id/documents` (bundle) — mock gộp vào `customerBundle`; khi tích hợp, Adapter thật có thể gọi riêng hoặc một endpoint chi tiết. Đây là lựa chọn của Adapter, không phải endpoint mới.
