# 03 — Ma trận Business Rule (Backend Spec REV01 → Mock → Kiểm chứng)

Trạng thái: **MOCK_PASS** = mock thực thi và có test thật; **MOCK_PARTIAL** = thực thi một phần; **GAP** = thiếu hợp đồng/thiết kế; **BLOCKED** = phụ thuộc hạ tầng chưa được duyệt; **N/A_GATE1** = ngoài phạm vi Gate 1. Không mục nào là "IMPLEMENTED" ở Backend thật: Backend CRM đang `BLOCKED_BY_MODULE_HOST_WRITE_CAPABILITY`.

Lưu ý đánh số: lệnh Gate 1 gọi "BR-01 phân công" và "BR-02 phạm vi"; trong REV01, phạm vi đối tượng nằm ở **BR-01** (object-scope PRIMARY/SUPPORT) + **BR-17** (scope trước count/page), còn **BR-02** là ánh xạ quyền `customer.create` sang IAM. Bảng dưới dùng số REV01 và ghi chú tên theo lệnh.

## 1. 20 Business Rule REV01

| BR | Nội dung REV01 | Thực thi trong Mock | Kiểm chứng (unit / E2E) | Trạng thái |
|---|---|---|---|---|
| BR-01 (lệnh: phân công + phạm vi) | READ + object-scope PRIMARY/SUPPORT | `visible()`: READ_ALL hoặc có phân công hiệu lực; mọi API đọc/ghi đi qua `customer()` | U: "a sale without READ_ALL…", "identifier is masked… scope"; E2E 17, 18 | MOCK_PASS |
| BR-02 | `customer.create` ánh xạ quyền IAM | `need('crm.customer.create')`; quyền đến từ `MOCK_PERMISSIONS` (giả lập IAM), không hardcode theo username | U: "composite create checks each permission"; E2E 11, 18 | MOCK_PASS (IAM thật: BLOCKED — chưa đăng ký quyền) |
| BR-03 | Thay đổi pháp lý: request + 2 duyệt + chứng từ | WF-05; không tự duyệt (đề xuất D04 — OD-16); 1 yêu cầu chờ / khách; DRAFT không đủ điều kiện | U: "management then accounting…", "requester cannot approve…"; E2E 16 | MOCK_PASS |
| BR-04 | `customer_id` ổn định cho module khác | id ổn định trong mock; API tích hợp chưa mở | — | N/A_GATE1 (TC-36/43/44/46 cần runtime) |
| BR-05 | DRAFT / VERIFY riêng; chặn DRAFT cho đơn hàng | D01-a: `recordStatus` độc lập `customerStatus`; verify đủ trường | U: "creates a DRAFT…", "verify needs…"; E2E 11–13 | MOCK_PASS (phần chặn đơn hàng: N/A — chưa có module Đơn hàng, TC-02) |
| BR-06 | Định danh duy nhất, chuẩn hóa, 409 | `normalizeIdentifier`, `identifierTaken`; kiểm trực tiếp trên form | U: "normalises…", "rejects a malformed or duplicate…"; E2E 11 | MOCK_PASS |
| BR-07 | Công ty mẹ / chi nhánh | không có | — | N/A_GATE1 (phase 2) |
| BR-08 | Tỉnh/xã FK, nước ngoài | xã phụ thuộc tỉnh, `CM_INVALID_PROVINCE_WARD`, xác nhận đổi VN ↔ nước ngoài | U: "rejects a ward outside…"; E2E 11, 12 | MOCK_PASS (danh mục rút gọn 6 tỉnh mẫu) |
| BR-09 | 1 PRIMARY + nhiều SUPPORT, lịch sử | `addAssignment`, `endAssignment`; PRIMARY chỉ thay qua bàn giao | U: "one PRIMARY, many SUPPORT…"; E2E 12 | MOCK_PASS |
| BR-10 | Bàn giao 2 luồng, không nhảy trạng thái | WF-07/08; override chỉ khi Sale hiện tại inactive + lý do; 1 bàn giao mở / khách | U: "flow B…", "flow A with override…", "a second open handover…"; E2E 14, 15 | MOCK_PASS |
| BR-11 | Chuyển hoạt động OPEN trong transaction, ghi cũ/mới | chuyển OPEN của Sale cũ; `transferredActivityIds` | U: "flow B…", "FE-FIX-02…"; E2E 14 | MOCK_PASS |
| BR-11+ (Target Design) | **To-do mở theo khách khi bàn giao** — không có trong REV01 | `TARGET_DESIGN_TRANSFER_TODOS`; `Task.history`, `transferredTaskIds` | U: "FE-FIX-02…" (mutation-check: tắt cờ → test đỏ); E2E 14 | MOCK — **chờ duyệt Delta (OD-07)** |
| BR-12 | Audit/Event của Foundation, correlation ID | Audit **demo** trong mock (actor, mã hành động, đối tượng, không PII); audit Foundation thật chưa có | U28, U29, E16b | MOCK (demo) · BLOCKED tích hợp Foundation (GAP-AUD-01) |
| BR-13 | Nhóm ngành read/manage/assign | gán nhiều nhóm; CRUD tối thiểu | E2E 12 | MOCK_PASS |
| BR-14 | Upload PDF/JPG/PNG, kiểm file, storage an toàn | kiểm loại file; **không lưu nội dung**; 10 MB = D07 | U: — ; E2E 19 (nhãn BLOCKED) | BLOCKED (storage) |
| BR-15 | Trạng thái hiệu lực tính toán, ngưỡng cấu hình | tính theo ngày; ngưỡng 30 ngày = D06 | E2E 01, 19 | MOCK_PARTIAL (ngưỡng chưa chốt) |
| BR-16 | Phiên bản: mới không ghi đè cũ | `supersedesDocumentId`; UI "Thay cho / Bản mới" | E2E 19 | MOCK_PASS (metadata) |
| BR-17 | Search/filter/sort; scope trước count/page | `filtered()` lọc phạm vi trước; total theo phạm vi | U: "list view derives…"; E2E 04, 17, 18 | MOCK_PASS |
| BR-18 | Export CSV: quyền riêng, phạm vi, chống injection | `customer.export`; `csvCell` | U: "guards CSV cells…", "export needs…"; E2E 17 | MOCK_PASS |
| BR-19 | Audit thao tác + che PII | Che định danh và **chặn tìm theo định danh** khi thiếu quyền xem đầy đủ (`IDENTIFIER_VIEW_PERMISSION` = `legal_change.read`, **đề xuất OD-05**); cảnh báo trùng tên chỉ trong phạm vi; audit demo không chứa PII | U21, U25–U28; E17, E18, E16b | MOCK — quyền cụ thể **chưa duyệt** |
| BR-20 | Test tổng hợp, regression IAM/Foundation | 23 unit + 23 bước E2E trên mock | `evidence/` | MOCK_PARTIAL (chưa có regression Backend thật) |

## 2. Quyết định đã duyệt và đề xuất liên quan

| Mã | Nội dung | Nguồn | Trạng thái trong Mock |
|---|---|---|---|
| D01-a | DRAFT không cần MST; VERIFIED cần đủ pháp lý + địa chỉ; hai trạng thái độc lập | Owner GO DB TEST | Đã thực thi (WF-03) |
| D05 | Override xác nhận Sale hiện tại chỉ khi Sale đó không còn hoạt động | **Đề xuất** (OPEN_ISSUES D05; REV01 §E "cần phê duyệt chính sách") — *đính chính 2026-11-01: trước đây ghi nhầm là REV01* | Đang chạy trong mock, có nhãn "đề xuất D05" (OD-15) |
| D04 | Người đề nghị không tự duyệt | **Đề xuất** (OPEN_ISSUES D04) | Đang chạy trong mock (chặt hơn REV02), có nhãn "đề xuất D04" (OD-16) |
| D06 | Ngưỡng "sắp hết hạn" 30 ngày | Đề xuất (Fullstack REV01) | Dùng làm giá trị demo, **gắn nhãn đề xuất** |
| D07 | Giới hạn file 10 MB | Đề xuất (Fullstack REV01) | Ghi nhãn đề xuất; không lưu file |
| FE-G01 | Người tạo không có quyền phân công → tự ghi PRIMARY | Giải pháp tạm của mock | **Chưa duyệt** — hiện ghi chú trên form (OD-02) |
| OD-05 | Che định danh khi thiếu `crm.legal_change.read` | Đề xuất | **Chưa duyệt** |
| OD-07 | Chuyển To-do khi bàn giao | Lệnh Gate 1 (FE-FIX-02) | Target Design, chưa thuộc REV01 |

## 3. Kiểm soát không được làm yếu
- Mã lỗi REV01 giữ nguyên: `CM_VALIDATION_FAILED`, `CM_IDENTITY_DUPLICATE`, `CM_CUSTOMER_NOT_FOUND`, `CM_PERMISSION_DENIED`, `CM_INVALID_PROVINCE_WARD`, `CM_DRAFT_NOT_ELIGIBLE`, `CM_HANDOVER_INVALID_STATE`, `CM_CONCURRENT_UPDATE`, `CM_FILE_INVALID` (đang dùng); `CM_APPROVAL_REQUIRED`, `CM_REFERENCE_UNAVAILABLE` (REV01 có, mock chưa phát sinh tình huống — UI không cho sửa trực tiếp pháp lý nên không gọi PATCH đó).
- Gate 1 đã đổi `FORBIDDEN` → `CM_PERMISSION_DENIED` và `CM_SELF_APPROVAL_FORBIDDEN` → `CM_PERMISSION_DENIED` (403 REV01).
- Còn 5 mã **chỉ có trong mock** (không có trong REV01): `CM_ALREADY_VERIFIED`, `CM_ASSIGNMENT_CONFLICT`, `CM_GROUP_CODE_EXISTS`, `CM_LEGAL_CHANGE_INVALID_STATE`, `CM_LEGAL_CHANGE_PENDING` → OD-08 (đổi sang mã REV01 hay bổ sung hợp đồng).
- Duy nhất: định danh (theo quốc gia + loại), mã nhóm, 1 PRIMARY hiệu lực / khách, 1 bàn giao mở / khách, 1 yêu cầu pháp lý chờ / khách.
- Giao dịch: tạo tổng hợp, hoàn tất bàn giao, áp dụng pháp lý — mock all-or-nothing (`atomic`) cho tạo tổng hợp; bàn giao/pháp lý thực hiện trong một lời gọi đồng bộ.
- Không bỏ kiểm tra quyền để demo dễ thao tác: nút ẩn theo quyền **và** adapter vẫn từ chối khi gọi trực tiếp.
