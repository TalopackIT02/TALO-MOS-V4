# 07 — Sổ quyết định (Decision Register)

Cập nhật: 2026-11-01 (Gate 1 final closeout). **Trạng thái Gate 1: `CRM_GATE1_FRONTEND_MOCK: ACCEPTED`** (chủ dự án, 2026-11-02 — chỉ Frontend Mock; không phải Backend, IAM, Audit Foundation hay lưu file). OD-02 … OD-16 giữ PENDING; OD-14 đề nghị đóng. Gate 2 phân loại tiếp các OD: `TALO-MOS-V4_exports/CRM_GATE2_DATABASE_EXTENSION_DESIGN_20261102/10_DECISION_REGISTER.md`.

- **OD-01: APPROVED** — quyết định của chủ dự án ngày 2026-11-01 ("OWNER DECISION: OD-01 APPROVED — FINAL GATE 1 CLOSEOUT").
- **Mọi OD khác: PENDING.** "Đề xuất" là khuyến nghị của người thực hiện, không phải quyết định. Mock có thể đang chạy một phương án để demo; điều đó không có nghĩa phương án được duyệt. Quyết định OD-01 chỉ chốt nguồn đối chiếu, không phê duyệt Business Rule nào đang mở (D04, D05… giữ nguyên trạng thái đề xuất).

Cột **Phụ thuộc** cho biết quyết định thuộc lớp nào: **FE-MOCK** (ảnh hưởng nghiệm thu Frontend trên Mock) · **BE** (Backend contract / logic) · **DB** (Database / migration) · **STO** (Storage) · **HOST** (Module Host capability) · **IAM** (danh mục quyền / MIC) · **POLICY** (chính sách nghiệp vụ).

## 1. Ma trận

| Mã | Trạng thái | Nội dung quyết định | Phương án | Đề xuất (chưa duyệt) | Ảnh hưởng UI | Ảnh hưởng Backend | Ảnh hưởng Database | Phụ thuộc | Gate xử lý | Chặn nghiệm thu Frontend Mock? |
|---|---|---|---|---|---|---|---|---|---|---|
| **OD-01** | **APPROVED** (2026-11-01) | Nguồn đối chiếu Gate 1 | — | Đã chốt: Web Demo REV02 + quy tắc UI/UX & Functional 29/10 đã mô tả + Backend Spec REV01 & BR đã duyệt + DB Dictionary CRM REV01 đã nghiệm thu. Không bắt buộc bản gốc 29/10; không bắt buộc chạy REV02 | Ma trận `09` đối chiếu theo bộ nguồn này | — | — | FE-MOCK | Gate 1 | **Không còn chặn** |
| **OD-02** | PENDING | FE-G01 — Sale không có quyền phân công tạo khách: ai là Sale chính? | (a) tự ghi người tạo là PRIMARY; (b) chờ quản lý phân công, người tạo xem tạm qua `created_account_id`; (c) bắt buộc chọn Sale khi tạo | (a) — giống REV02; kèm audit | Ghi chú "chưa được duyệt" trên form (đang có) | Quy tắc trong `POST /customers` | Không (dùng `cm_customer_assignments`) | BE, POLICY | Backend delta | Không |
| **OD-03** | PENDING | GAP-API-01 — lưu form tạo 4 nhóm | (a) endpoint tạo tổng hợp 1 giao dịch; (b) gọi tuần tự 5 endpoint, báo lỗi từng phần (REV02); (c) tách nhiều bước | (a) — REV01 handoff yêu cầu "atomically" | (b) cần hiển thị "đã lưu một phần" | (a) endpoint mới + transaction | Không | BE | Backend contract | Không |
| **OD-04** | PENDING | D06 — ngưỡng "sắp hết hạn" | 30 ngày / khác / cấu hình | 30 ngày, cấu hình Backend | Nhãn "đề xuất D06" | Tham số cấu hình | Không | BE | Backend config | Không |
| **OD-05** | PENDING | Quyền xem **và tìm theo** định danh pháp lý đầy đủ | (a) `crm.legal_change.read` (mock hiện tại); (b) `crm.customer.verify` (REV02); (c) quyền riêng `crm.customer.read_identifier`; (d) không che | (c) | Cột Định danh, xem nhanh, hồ sơ, ô tìm kiếm — mock đã gom về **một hằng số** `IDENTIFIER_VIEW_PERMISSION` | Masking + giới hạn tìm kiếm ở API list/detail/search/CSV (BR-19) | Không | IAM, BE | IAM catalogue (Gate 3) + Backend | Không — hành vi đã tham số hóa; đổi quyền chỉ sửa 1 hằng số |
| **OD-06** | PENDING | Mô hình dữ liệu Lịch hẹn và To-do | (a) chiếu lên `cm_customer_activities` + marker trong `description` (REV02, REV02 tự ghi không dùng cho production); (b) mở rộng `cm_customer_activities` bằng cột có cấu trúc; (c) bảng riêng + lịch sử | (b) — một kho hoạt động, To-do tự theo BR-11 (giải quyết OD-07). Lưu ý `cm_customer_activities.customer_id` NOT NULL → lịch/việc nội bộ không gắn khách cần nullable hoặc chọn (c) | Giữ form hiện tại nếu (b)/(c); (a) phải bỏ giờ kết thúc, liên hệ, ưu tiên, tiến độ | API activity mở rộng hoặc API mới | (b) thêm cột; (c) thêm bảng — migration | DB, BE | **Gate 2** | Không |
| **OD-07** | PENDING | Chuyển To-do khi bàn giao (FE-FIX-02) | (a) chuyển TODO/IN_PROGRESS của Sale cũ gắn khách, có lịch sử; (b) không chuyển, chỉ cảnh báo; (c) quản lý chọn từng việc | Phụ thuộc OD-06: (b) → tự động theo BR-11; (c) → (a) + bảng lịch sử | Nhãn Target Design (đang có) | Mở rộng giao dịch hoàn tất bàn giao | (c): bảng lịch sử chuyển To-do | DB, BE, POLICY | **Gate 2** + Backend delta | Không |
| **OD-08** | PENDING | 5 mã lỗi chỉ có trong mock | (a) bổ sung vào hợp đồng lỗi; (b) đổi sang mã REV01 gần nhất | (a) | Thông điệp lỗi không đổi | Hợp đồng lỗi | Không | BE | Backend contract | Không |
| **OD-09** | PENDING | D07 — giới hạn kích thước file | 10 MB / khác | 10 MB, cấu hình Backend | Nhãn "đề xuất D07" | Kiểm file khi upload | Không | BE | Backend config | Không |
| **OD-10** | PENDING | Storage tài liệu | Chọn nơi lưu, dependency multipart, quyền tải | Volume ngoài Git / object storage nội bộ; tải qua API có kiểm quyền | Bật nút tải lên / tải xuống thật | API upload / download | Dùng `storage_path` sẵn có | STO, BE | Hạ tầng + Backend | Không (Gate 1 yêu cầu BLOCKED, không giả lập file) |
| **OD-11** | PENDING | Quyền cho Lịch hẹn / Công việc / Báo cáo | (a) `crm.activity.*` (REV02 G-10); (b) function riêng | (a) nếu OD-06(b); (b) nếu OD-06(c) | Ẩn/hiện nút theo quyền | Kiểm quyền API | Không | IAM | Gate 3 (IAM / MIC) | Không |
| **OD-12** | PENDING | Mô hình Work Report và hiển thị trong hồ sơ | (a) bảng báo cáo + liên kết, DRAFT/SUBMITTED; (b) NOTE hoàn tất ngay + marker (REV02) | (a) | Giữ nguyên nếu (a) | API báo cáo mới | Bảng mới — migration | DB, BE | **Gate 2** | Không |
| **OD-13** | PENDING | Hiện lại hồ sơ đã ẩn | Thêm `unhide` / không | Chưa cần trong V1 | Không | Endpoint mới nếu chọn | Không | BE | Backend contract | Không |
| **OD-14** | PENDING (đề nghị đóng) | Sidebar 9 mục của Fullstack REV01 | Theo quy tắc 5 mục | Bộ nguồn đã duyệt ở OD-01 có quy tắc 5 Sidebar → đề nghị chủ dự án đóng mục này | Không đổi | Không | Không | FE-MOCK | Gate 1 (xác nhận đóng) | Không — Module đã đúng 5 mục |
| **OD-15** | PENDING | D05 — xác nhận thay Sale cũ (override). Là **đề xuất**, không phải quy tắc REV01 | (a) `crm.handover.override` + Sale cũ không ACTIVE + lý do + audit (D05); (b) như REV02: `handover.approve` + lý do, UI không mở; (c) không cho override | (a) — DB đã bắt buộc actor + lý do | Nút "Xác nhận thay" có nhãn "đề xuất D05" | Kiểm điều kiện trong acknowledge | Không (cột đã có) | POLICY, BE | Backend / chính sách | Không |
| **OD-16** | PENDING | D04 — người đề nghị không tự duyệt; một người có được duyệt cả hai cấp không | (a) không duyệt cấp nào (mock hiện tại); (b) chỉ không duyệt cùng cấp (REV02); kèm: cấm/cho phép cùng người duyệt 2 cấp | (a) + cấm cùng người duyệt 2 cấp | Nhãn "D04 đề xuất" | Kiểm actor ở API duyệt | Không (DB không ràng buộc actor) | POLICY, BE | Backend / chính sách | Không |

## 2. Phân loại
- **Chặn nghiệm thu Frontend Mock:** không còn mục nào (OD-01 đã APPROVED). OD-14 chỉ cần xác nhận đóng.
- **Database (Gate 2):** OD-06, OD-07, OD-12.
- **Backend contract / logic:** OD-02, OD-03, OD-04, OD-05, OD-08, OD-09, OD-13, OD-15, OD-16.
- **IAM / MIC (Gate 3):** OD-05, OD-11.
- **Storage:** OD-10.
- **Module Host:** không phải OD; blocker kỹ thuật GAP-HOST-01 (Host chỉ cấp `readOnly` → Backend CRM `BLOCKED_BY_MODULE_HOST_WRITE_CAPABILITY`).
- **Audit Foundation:** không phải OD; blocker tích hợp GAP-AUD-01 (Audit Demo trong mock không thay thế).
- Phụ thuộc: OD-07 ← OD-06; OD-11 ← OD-06.
