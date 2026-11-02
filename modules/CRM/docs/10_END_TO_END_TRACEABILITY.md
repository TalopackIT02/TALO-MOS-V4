# 10 — Truy vết đầu-cuối: Screen → User Action → UI State → Mock Method → Business Rule → IAM → API Contract → Database → Test Evidence

Cập nhật 2026-11-01 (Gate 1 closeout). Quy ước:
- **API Contract**: chỉ 40 endpoint Backend Spec REV01 (`/api/cm` là tiền tố đề xuất của REV01). `—` = REV01 không có → GAP (`05_DATA_MODEL_AND_GAP_REPORT.md`). Không có endpoint tự đặt.
- **IAM**: mã quyền dự kiến `crm.<function>.<action>` — **chưa đăng ký**, mock giả lập theo persona.
- **Database**: bảng schema `cm` trên TEST (15 bảng / 173 cột). `—` = không có bảng → Gate 2.
- **UI State** viết tắt: L = đang tải · E = rỗng · X = lỗi (thông điệp theo mã REV01) · P = không có quyền (nút ẩn và adapter vẫn từ chối) · V = lỗi kiểm tra dữ liệu · S = thành công (toast) · C = hộp xác nhận.
- **Test Evidence**: U# = unit (`tests/crm.mock.test.ts`, 29 test, theo thứ tự trong file), E# = bước E2E (`dev/e2e.mjs`, 29 bước). Ảnh: `TALO-MOS-V4_exports/CRM_GATE1_FINAL_20261101/evidence/e2e/`.
- Mọi dòng đều ở trạng thái **MOCK** — Backend CRM `BLOCKED_BY_MODULE_HOST_WRITE_CAPABILITY`.

## 1. Tổng quan công việc

| Screen | User Action | UI State | Mock Method | BR | IAM | API Contract | Database | Test Evidence |
|---|---|---|---|---|---|---|---|---|
| Tổng quan | Mở màn | L, E theo từng thẻ, P (Gate CRM) | `listCustomers`, `visibleCustomers`, `listAppointments`, `listTasks`, `recentActivities`, `expiringDocuments` | BR-01, BR-15, BR-17 | customer.read, document.read | GET `/customers`, GET `/documents/expiring` (lịch/việc: —) | cm_customers, cm_customer_assignments, cm_customer_documents (lịch/việc: —) | E01 |
| Tổng quan | Bấm KPI quá hạn | điều hướng + bộ lọc quá hạn | `listTasks({overdueOnly})` | — | — | — | — | E03 |
| Tổng quan | Bấm mục "Chờ tôi xử lý" | điều hướng sang **Khách hàng** + hộp xử lý | `listHandovers`, `listLegalChanges` | BR-03, BR-10 | assignment.read, legal_change.read | GET `/handovers`, GET `/customers/:id/legal-changes` | cm_customer_handovers, cm_customer_legal_change_requests | E14, E15 |

## 2. Khách hàng — danh sách

| Screen | User Action | UI State | Mock Method | BR | IAM | API Contract | Database | Test Evidence |
|---|---|---|---|---|---|---|---|---|
| Khách hàng | Tìm theo mã / tên / tên pháp lý | L, E ("Không có khách hàng nào trong phạm vi…"), X | `listCustomers({q})` | BR-01, BR-17 | customer.read (+read_all) | GET `/customers` | cm_customers | E04, E17 |
| Khách hàng | Tìm theo **định danh** | Có quyền xem đầy đủ: tìm được (toàn phần / một phần) trong phạm vi. Không có: định danh không phải trường tìm kiếm (placeholder không có "MST") | `listCustomers({q})` + `canViewIdentifier()` | BR-17, BR-19 | `IDENTIFIER_VIEW_PERMISSION` = crm.legal_change.read (**đề xuất OD-05**) | GET `/customers` | cm_customers.legal_identifier_normalized | U25, U26, E17, E18 |
| Khách hàng | Lọc loại / quan hệ / hồ sơ / miền / vùng / tỉnh / Sale / vai trò / nhóm / hồ sơ ẩn | L, E | `listCustomers`, `regions`, `groups` | BR-17 | customer.read, reference.read, group.read, customer.read_all (hồ sơ ẩn) | GET `/customers`, GET `/references/regions`, GET `/groups` | cm_ref_province_region_map, cm_ref_economic_regions, cm_customer_group_members | U20, E04, E13b |
| Khách hàng | Sắp xếp / số dòng / trang | — | `listCustomers({sort, sortDir, page, pageSize})` | BR-17 | customer.read | GET `/customers` | cm_customers | U20, E04 |
| Khách hàng | Xem nhanh (bấm tên) | modal; định danh che theo OD-05 | (dòng danh sách) | BR-19 | customer.read | GET `/customers/:id` | cm_customers | E05 |
| Khách hàng | Xem nhanh → Ẩn hồ sơ | C, S; hồ sơ chỉ hiện khi bật "Gồm hồ sơ đã ẩn" | `hideCustomer` | BR-17 | customer.hide | POST `/customers/:id/hide` | cm_customers.is_hidden | E05 (Sale không thấy nút), E13b |
| Khách hàng | Xuất CSV | S; P | `exportCustomersCsv` (UTF-8 BOM ở UI) | BR-18 | customer.export | — (REV01 nêu quyền, không có path) | cm_customers | U2, U8, U28, E17 |
| Khách hàng | "Chờ xử lý (n)" → tab "Chờ tôi xử lý" / "Bàn giao đã kết thúc" | E, danh sách theo phạm vi | `listHandovers`, `listLegalChanges` | BR-01, BR-10 | assignment.read, legal_change.* | GET `/handovers`, GET `/handovers/:id` | cm_customer_handovers, cm_customer_handover_activity_transfers | U29, E15, E15b |

## 3. Khách hàng — tạo và kiểm định danh

| Screen | User Action | UI State | Mock Method | BR | IAM | API Contract | Database | Test Evidence |
|---|---|---|---|---|---|---|---|---|
| Tạo KH | Nhập số định danh | V "Sai cấu trúc"; 409 "Định danh đã tồn tại" (chỉ có/không — không lộ mã, tên); "Mở hồ sơ đã có" chỉ khi hồ sơ trong phạm vi; cảnh báo trùng tên chỉ đếm khách trong phạm vi | `checkIdentity` | BR-06 | customer.create / update | GET `/customers/check-identity` | cm_customers (unique định danh) | U1, U4, U27, E11 |
| Tạo KH | Đổi VN ↔ nước ngoài khi đã nhập địa chỉ | C | — | BR-08 | — | — | — | E11 |
| Tạo KH | Lưu Draft / Lưu và xác minh | S, V, X; lỗi bất kỳ → không lưu gì | `createCustomerFull` | BR-01, 02, 05, 06, 08, 09, 13; FE-G01 (OD-02) | customer.create, contact.manage, assignment.manage, group.assign, customer.verify | — tổng hợp (GAP-API-01, OD-03) gồm POST `/customers`, POST `/customers/:id/contacts`, POST `/customers/:id/assignments`, PUT `/customers/:id/groups`, POST `/customers/:id/verify` | cm_customers, cm_customer_contacts, cm_customer_assignments, cm_customer_group_members | U3, U18, U19, E11, E12 |

## 4. Hồ sơ khách hàng

| Screen | User Action | UI State | Mock Method | BR | IAM | API Contract | Database | Test Evidence |
|---|---|---|---|---|---|---|---|---|
| Hồ sơ | Mở hồ sơ / deep link | L, X/P "Không tìm thấy hồ sơ hoặc bạn không có quyền xem" (404 không tiết lộ) | `customerBundle` | BR-01 | customer.read | GET `/customers/:id` | cm_customers + bảng con | U7, U21, E06, E14, E17 |
| Hồ sơ | Chuyển 6 tab | E / P theo từng tab | (bundle) | — | contact.read, activity.read, document.read | GET `/customers/:id/contacts`, `/activities`, `/documents`, `/timeline` | các bảng con | E06, E20-* |
| Hồ sơ | Sửa thông tin | S, V; pháp lý của VERIFIED không sửa trực tiếp | `updateCustomer` | BR-05, BR-08 | customer.update | PATCH `/customers/:id` | cm_customers | U21 (viewer bị từ chối) |
| Hồ sơ | Xác minh hồ sơ | S, V liệt kê trường thiếu | `verifyCustomer` | BR-05 (D01-a) | customer.verify | POST `/customers/:id/verify` | cm_customers.record_status_code | U6, E13 |
| Hồ sơ | Đề nghị đổi pháp lý | S, V (thiếu chứng từ / DRAFT / đã có yêu cầu chờ) | `requestLegalChange` | BR-03 | legal_change.request | POST `/customers/:id/legal-changes` | cm_customer_legal_change_requests | U14 |
| Hồ sơ / hàng đợi | Duyệt quản lý → kế toán | S, P; người đề nghị không tự duyệt (**đề xuất D04 — OD-16**); hồ sơ không đổi trước bước kế toán; lịch sử thay đổi | `decideLegalChange` | BR-03 | legal_change.approve_management / approve_accounting | — (REV01 không liệt kê path duyệt) | cm_customer_legal_change_approvals | U13, U14, E16 |
| Hồ sơ | Phân công Sale | S, V (trùng Sale, PRIMARY thứ hai) | `addAssignment`, `endAssignment` | BR-01, BR-09 | assignment.manage | POST `/customers/:id/assignments` | cm_customer_assignments | U9 |
| Hồ sơ | Yêu cầu bàn giao (A / B) | S, V | `requestHandover` | BR-10 | handover.request | POST `/customers/:id/handovers` | cm_customer_handovers | U10–U12, E15 |
| Hồ sơ / hàng đợi | Duyệt / xác nhận / xác nhận thay / nhận / từ chối | S, P; xác nhận thay chỉ khi Sale cũ nghỉ (**đề xuất D05 — OD-15**), bắt buộc lý do | `approveHandover`, `acknowledgeHandover`, `rejectHandover` | BR-10, BR-11; To-do = Target Design (OD-07) | handover.approve / acknowledge / override / reject | POST `/handovers/:id/approve`, `/acknowledge`, `/reject` | cm_customer_handovers, cm_customer_assignments, cm_customer_handover_activity_transfers (To-do: —) | U10, U11, U22, U29, E14, E15, E15b |
| Hồ sơ | Liên hệ: thêm / sửa / ngừng | S, V (cần điện thoại hoặc Zalo) | `createContact`, `updateContact`, `deactivateContact` | — | contact.manage | POST / PATCH `/customers/:id/contacts…`, POST `…/deactivate` | cm_customer_contacts | U18, E11 |
| Hồ sơ | Nhóm ngành | S | `setCustomerGroups`, `createGroup` | BR-13 | group.assign / group.manage | PUT `/customers/:id/groups`, POST `/groups` | cm_customer_group_members, cm_customer_groups | U28, E12 |
| Hồ sơ | Hoạt động: tạo / sửa / hoàn thành | S, V | `createActivity`, `updateActivity`, `completeActivity` | BR-11, BR-12 | activity.* | POST `/customers/:id/activities`, PATCH `/activities/:id`, POST `/activities/:id/complete` | cm_customer_activities | U10 |
| Hồ sơ | Tài liệu: metadata / phiên bản | S, V (loại file, ngày hiệu lực ≤ hết hạn); lưu / tải file: **BLOCKED** | `createDocument`, `updateDocumentMetadata` | BR-14, BR-15, BR-16 | document.manage | POST `/customers/:id/documents`, POST `/documents/:id/versions`, PATCH `/documents/:id/metadata` (download: BLOCKED) | cm_customer_documents | E19 |

## 5. Lịch hẹn, Công việc, Báo cáo

| Screen | User Action | UI State | Mock Method | BR | IAM | API Contract | Database | Test Evidence |
|---|---|---|---|---|---|---|---|---|
| Lịch hẹn | Xem ngày / tuần / tháng, lọc | L, E | `listAppointments` | Quy tắc 29/10 | — (OD-11) | — | — (OD-06) | E07, E08 |
| Lịch hẹn / Hồ sơ | Tạo / sửa (khách, người liên hệ, giờ, địa điểm, nhắc) | S, V (kết thúc > bắt đầu; liên hệ thuộc khách và còn hiệu lực) | `createAppointment`, `updateAppointment` | Quy tắc 29/10 | — | — | — | U15, E07, E08 |
| Lịch hẹn | Hủy (bắt buộc lý do) / ghi kết quả | C, S | `cancelAppointment`, `completeAppointment` | — | — | — | — | U15, E08 |
| Lịch hẹn | Mở lịch hẹn trong hồ sơ / Lập báo cáo | điều hướng đúng tab / form báo cáo mở sẵn liên kết | (navigate) | Quy tắc 29/10 | — | — | — | E07, E19b |
| Mọi màn | Nhắc lịch trong ứng dụng | banner nhắc | `dueReminders`, `dismissReminder` | — | — | — | — | U15 |
| Công việc / Hồ sơ | Tạo / sửa / hoàn thành / lọc | S, V; ưu tiên & tiến độ có nhãn mô phỏng | `listTasks`, `createTask`, `updateTask`, `completeTask` | Quy tắc 29/10 | — (OD-11) | — | — (OD-06) | U16, U23, E03, E09 |
| Công việc | Lập báo cáo từ To-do | form mở sẵn liên kết | (navigate) | — | — | — | — | E19b |
| Báo cáo / Hồ sơ | Viết, lưu nháp, nộp, lọc (ngày, người, khách, trạng thái); xem trong hồ sơ | S, V; đã nộp chỉ đọc; nháp chỉ tác giả thấy | `listReports`, `createReport`, `updateReport`, `submitReport` | Quy tắc 29/10 | — (OD-11) | — | — (OD-12) | U17, U23, E10, E19b |

## 6. Công cụ DEMO (không phải chức năng sản phẩm)

| Screen | User Action | UI State | Mock Method | BR | IAM | API Contract | Database | Test Evidence |
|---|---|---|---|---|---|---|---|---|
| Thanh DEMO | Đổi tài khoản thử | mọi màn tải lại theo phạm vi mới | `switchAccount` | BR-01 (persona chỉ để nghiệm thu) | persona giả lập | Host `session`, `authorize`, `evaluate` | IAM (Foundation) | E14–E18 |
| Thanh DEMO | Nhật ký thao tác (Audit demo) | E, bảng: thời gian, người, mã hành động, đối tượng (không PII) | `auditLog` | BR-12, BR-19 — tích hợp Foundation **BLOCKED** (GAP-AUD-01) | — | — | Foundation audit (không dùng) | U28, U29, E16b, E22 |
| Thanh DEMO | Khôi phục dữ liệu mẫu | C (hủy / đồng ý), S; màn đang mở cập nhật | `reset` | — | — | — | — | U24, E22 |
| Thanh DEMO | Trạng thái tích hợp | bảng MOCK / BLOCKED | `capabilities` | — | — | — | — | — |
| Harness | Thu gọn / mở rộng sidebar; menu mobile | giữ trạng thái màn hình | — (Host AppShell) | UI-02, UI-19 | — | — | — | E21, E20-390/768/1024/1440 |
