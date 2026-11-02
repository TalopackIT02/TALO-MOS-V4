# 01 — Đặc tả UI/UX màn hình CRM Module V1 (Gate 1)

Phiên bản: Gate 1 alignment · 2026-10-30 · Package `modules/CRM` 0.1.0 · Trạng thái: **MOCK** (Mock Adapter, IAM giả lập).

## 0. Nguồn và thứ tự ưu tiên

| Ưu tiên | Phạm vi | Nguồn | Tình trạng nguồn |
|---|---|---|---|
| 1 | Kiến trúc | CRM Module Package (`TALO-MODULE-PACKAGE-1`, Module Host) | Có (repo) |
| 2 | Sidebar & màn hình | UI/UX Handoff 29/10 — đúng 5 màn hình | **Không có bản gốc**; dùng các quy tắc chủ dự án mô tả (lệnh Gate 1 và lệnh remediation). Không tuyên bố khớp 100% thiết kế gốc (OD-01) |
| 3 | Nghiệp vụ | Backend Spec REV01 (`07_REFERENCES/BACKEND_SPECIFICATION_VERBATIM.md`) | Có |
| 4 | Dữ liệu | DB Dictionary đã nghiệm thu (15 bảng / 173 cột) | Có |
| 5 | Chi tiết UI bổ sung | Fullstack Demo Handoff REV01 (`04_FRONTEND/01–04`) | Có |
| 5 | Chi tiết UI bổ sung | CRM Web Demo **REV02** (handoff 29/10/2026) | **Có từ 2026-11-01**: `documents/development/talo-mos-crm-v1-demo` (chỉ đọc). Đối chiếu mã nguồn — không chạy được để chụp ảnh (thiếu `lucide-react`, không được cài). Xem `09_UIUX_COMPARISON_MATRIX.md` |

Sidebar 9 mục của Fullstack REV01 (Dashboard, Duyệt pháp lý, Bàn giao, Tài liệu, Nhóm ngành, Cấu hình…) **bị thay thế** bởi quy tắc 5 màn hình (ưu tiên 2). Các chức năng đó được đặt bên trong 5 màn hình (hộp "Chờ tôi xử lý", hồ sơ khách hàng).

## 1. AppShell — 4 khối (chung cho 5 màn hình)

| Khối | Phần tử Host | CRM Module cung cấp |
|---|---|---|
| 1. Topbar + Sidebar | `header.top` (logo TALOPACK, "Công ty TNHH Tăng Long Pack") + `aside.sidebar` | `module.json → frontend.screens` (5 mục, thứ tự cố định) |
| 2. Breadcrumb | `.crumb` | Host dựng từ Navigation Builder ("Kinh doanh › CRM › <màn hình>" trong harness) |
| 3. Tiêu đề / mô tả / chức năng | `.page-heading h1`, `p#desc`, `.tabs` | `name`, `description`, `tabs[0].label` trong `module.json` |
| 4. Nội dung | `section.panel > .panel-body` | `screens[screenKey]` từ `frontend/index.tsx` |

- Token màu dùng lại của Host: xanh `#087f45`, chữ `#1c2937`, nền `#f5f8fa`, viền `#e3e9ef`, chữ phụ `#66778a`. CSS CRM có tiền tố `crm-`, giới hạn dưới `.app-shell` (`frontend/src/styles/crm.css`), không sửa CSS Host.
- Mobile ≤ 760 px (theo `app-shell.css` của Host): sidebar thành drawer (`.app-shell.mobile-open`), lớp phủ `.mobile-overlay`, thanh dưới `.mobile-bottom-nav` 3 nút **Menu / Trang chủ / Cá nhân**. Harness `dev/main.tsx` tái hiện đúng markup này để nghiệm thu độc lập; khi chạy trong Host, AppShell thật của Host đảm nhiệm (CRM không thay thế).
- Desktop: nút **Thu gọn / Mở rộng** cuối sidebar (`#collapse-button`, `.app-shell.sidebar-compact` + `.layout.compact` của Host; chữ tắt TQ/KH/LH/CV/BC, tên đầy đủ ở `title`). Trạng thái màn hình giữ nguyên khi thu gọn/mở rộng (E2E 21).
- Thanh "DEMO — IAM GIẢ LẬP" (MockBanner) luôn hiển thị khi dùng Mock Adapter: chọn tài khoản thử, "Trạng thái tích hợp", "Nhật ký thao tác (Audit demo)" (không phải audit Foundation), "Khôi phục dữ liệu mẫu".

## 2. Sidebar — đúng 5 màn hình

| # | Tên | screenKey | Route | Viết tắt (compact) |
|---|---|---|---|---|
| 1 | Tổng quan công việc | `crm.workspace` | `/crm` | TQ |
| 2 | Khách hàng | `crm.customers` | `/crm/customers` | KH |
| 3 | Lịch hẹn | `crm.calendar` | `/crm/calendar` | LH |
| 4 | Công việc | `crm.tasks` | `/crm/tasks` | CV |
| 5 | Báo cáo | `crm.reports` | `/crm/reports` | BC |

Deep link hỗ trợ: `/crm/customers?customer=<id>[&tab=<tên tab>]`, `/crm/calendar?appointment=<id>`, `/crm/tasks?filter=overdue|done`.

## 3. Màn hình 1 — Tổng quan công việc (`WorkspacePage.tsx`)

| Vùng | Nội dung | Điều hướng khi bấm |
|---|---|---|
| KPI 1 | **Khách hàng đang phụ trách** = số KH có phân công hiệu lực (PRIMARY/SUPPORT) của tài khoản; nếu được xem nhiều hơn (READ_ALL) hiện "(xem được N)" | Khách hàng |
| KPI 2 | Lịch hẹn hôm nay | Lịch hẹn |
| KPI 3 | Công việc chưa hoàn thành | Công việc |
| KPI 4 | Công việc quá hạn (đỏ khi > 0) | Công việc, bộ lọc Quá hạn (`?filter=overdue`) |
| KPI 5 | Hoàn thành trong kỳ — chọn **tuần này / tháng này** | — |
| Lịch hẹn 7 ngày tới | Hôm nay + sắp tới | Lịch hẹn (mở chi tiết) |
| Công việc cần chú ý | Quá hạn trước, rồi theo hạn | Công việc |
| Chờ tôi xử lý | Bàn giao (duyệt / xác nhận / nhận) và thay đổi pháp lý (duyệt quản lý / kế toán) **theo quyền** — **chỉ liệt kê** | Chuyển sang màn **Khách hàng** và mở hộp xử lý ở đó (quy tắc: phân công / bàn giao chỉ trong ngữ cảnh Khách hàng; người nhận bàn giao chưa có phạm vi hồ sơ vẫn xử lý được) |
| Tài liệu sắp / đã hết hạn | Chỉ hiện khi có `crm.document.read`; ngưỡng 30 ngày = **đề xuất D06** | Hồ sơ khách hàng |
| Hoạt động gần đây | Hoạt động mới nhất trong phạm vi | Hồ sơ khách hàng |

Trạng thái: đang tải ("…"), rỗng (thông điệp từng thẻ), không có quyền CRM (`Gate`: "Tài khoản này chưa được cấp quyền xem CRM").

## 4. Màn hình 2 — Khách hàng (`CustomersPage.tsx`)

### 4.1 Thanh công cụ
Ô tìm (mã, tên thường gọi, tên pháp lý; **định danh chỉ khi có quyền xem định danh đầy đủ** — `IDENTIFIER_VIEW_PERMISSION`, đề xuất OD-05; không có quyền thì placeholder không nhắc MST) · **⟳ Làm mới** · **Chờ xử lý (n)** (hàng đợi bàn giao / duyệt pháp lý theo quyền; deep link `?handover=` / `?legal=`) · **Xuất CSV** (UTF-8 BOM) (chỉ khi `crm.customer.export`) · **+ Khách hàng** (chỉ khi `crm.customer.create`).

### 4.2 Bộ lọc (`crm-filters`)
Loại khách hàng · Quan hệ (PROSPECT/NEW/ACTIVE/PAUSED/CLOSED) · Hồ sơ (DRAFT/VERIFIED) · **Miền** · **Vùng kinh tế** · Tỉnh/thành · Sale phụ trách (luôn nằm trong phạm vi đã lọc trước) · **Vai trò Sale** (chính/hỗ trợ; khi chưa chọn Sale = "Tôi") · Nhóm ngành (khi `crm.group.read`) · Gồm hồ sơ đã ẩn (khi `crm.customer.read_all`) · **Xóa bộ lọc**. Phạm vi (BR-02) áp dụng **trước** lọc và đếm.

### 4.3 Bảng — 12 cột (theo Frontend Design REV01 `03_SCREEN_BEHAVIOR_DETAILED.md`)

| # | Cột | Sắp xếp | Ghi chú |
|---|---|---|---|
| 1 | Mã KH | ✔ | 6 chữ số |
| 2 | Tên thường gọi | ✔ | Bấm tên → **Xem nhanh** (modal) |
| 3 | Tên pháp lý | | |
| 4 | Định danh | | Bị che `•••…123` khi thiếu `crm.legal_change.read` — **đề xuất OD-05** |
| 5 | Loại | | |
| 6 | Tỉnh / Quốc gia | | |
| 7 | Miền / Vùng | | Suy ra từ tỉnh (`cm_ref_province_region_map`) |
| 8 | Quan hệ | | badge |
| 9 | Hồ sơ | | DRAFT / Đã xác minh |
| 10 | Sale chính | | + "+n hỗ trợ" |
| 11 | Ngày tạo | ✔ | |
| 12 | Thao tác | | "Xem hồ sơ" |

Phân trang: 10/20/50/100, mặc định 20. Sắp xếp tăng/giảm có `aria-sort`.

### 4.4 Form tạo khách hàng — 4 nhóm (modal rộng)
1. **Hồ sơ**: Loại *, Quan hệ hợp tác, Tên thường gọi *, Tên pháp lý, Loại định danh, Số định danh (kiểm tra trực tiếp: sai cấu trúc / trùng 409 + "Mở hồ sơ đã có" nếu hồ sơ trong phạm vi / trùng tên chỉ cảnh báo), Người đại diện, Điện thoại người đại diện.
2. **Địa chỉ đăng ký**: ô "Khách hàng nước ngoài" — đổi khi đã nhập địa chỉ phải **xác nhận** (xóa địa chỉ đã nhập); VN: Tỉnh → Phường/Xã/Đặc khu phụ thuộc; nước ngoài: Quốc gia ISO-2, Thành phố, Bang; Số nhà/đường; **Địa chỉ đăng ký (tự tạo, chỉ đọc)**.
3. **Người liên hệ** (0..n): Họ tên *, Chức vụ, Điện thoại, Zalo, Email, chọn 1 liên hệ chính.
4. **Sale phụ trách và nhóm ngành**: Sale chính + Sale hỗ trợ (chỉ khi `crm.assignment.manage`); nếu không có quyền: ghi chú **FE-G01 (chưa duyệt)** — người tạo được ghi nhận là Sale chính; Nhóm ngành (khi `crm.group.assign`).

Nút: **Hủy bỏ** · **Lưu Draft** · **Lưu và xác minh** (chỉ khi `crm.customer.verify`). Lưu tổng hợp chạy **một giao dịch mô phỏng** (lỗi bất kỳ → không lưu gì) — xem GAP-API-01.

### 4.5 Hồ sơ khách hàng (`CustomerProfile.tsx`)
- Đầu trang: "Mã – Tên thường gọi", tên pháp lý; nút **← Danh sách**, **Sửa thông tin** (khi `update`), **+ Lịch hẹn**, **+ Công việc**.
- **Cột trái 1/3**: định danh (mã, trạng thái hồ sơ, quan hệ), pháp lý (tên, loại, định danh — che theo OD-05, địa chỉ, quốc gia, Miền/Vùng, ngày tạo · người tạo, đại diện), nhóm ngành, **Sale phụ trách** (chính / hỗ trợ), hộp bàn giao đang mở (+ xem trước số hoạt động OPEN và To-do sẽ chuyển — To-do ghi **Target Design**), bàn giao gần nhất, hộp thay đổi pháp lý. Nút: Xác minh hồ sơ, Đề nghị đổi pháp lý, Ẩn hồ sơ, Yêu cầu bàn giao, Phân công, Nhóm — mỗi nút theo quyền.
- **Cột phải 2/3 — đúng 6 tab**: Tổng quan · Thông tin liên hệ · Lịch hẹn · Công việc · Hoạt động & Kết quả · Tài liệu.
  - Hoạt động & Kết quả có thêm khối **"Báo cáo công việc liên quan"** (badge GAP — chưa có hợp đồng Backend).
  - Tài liệu: phiên bản "Thay cho / Bản mới", hiệu lực/hết hạn; nhãn **BLOCKED** (lưu/tải file thật) và **D06** (30 ngày); dialog tải lên ghi **D07** (10 MB). Không có nút tải xuống giả.
- Trạng thái: đang tải hồ sơ; lỗi/không có quyền (404 không tiết lộ: "Không tìm thấy hồ sơ hoặc bạn không có quyền xem hồ sơ này"); từng tab: không có quyền / chưa có dữ liệu.
- Mobile: 2 cột gộp thành 1 cột (≤ 1100 px).

## 5. Màn hình 3 — Lịch hẹn (`CalendarPage.tsx`)
Hôm nay · ‹ › · tiêu đề kỳ · **Ngày / Tuần / Tháng** · Phạm vi (của tôi / tất cả theo quyền) · Lọc khách hàng · Hiện lịch đã hủy · **+ Lịch hẹn**. Bấm ô giờ trống → tạo lịch tại giờ đó.
Form: Tiêu đề *, Khách hàng, **Người liên hệ** (liên hệ còn hiệu lực của khách đã chọn), Bắt đầu *, Kết thúc * (> bắt đầu), Địa điểm, Nhắc trước (trong ứng dụng), Nội dung.
Chi tiết: thời gian, trạng thái, người phụ trách, khách hàng / liên hệ, địa điểm, nhắc, nội dung, kết quả / lý do hủy; nút **Mở lịch hẹn trong hồ sơ khách hàng** (mở đúng tab Lịch hẹn), Hủy lịch (bắt buộc lý do), Sửa, Đã diễn ra (ghi kết quả).

## 6. Màn hình 4 — Công việc (`TasksPage.tsx`)
KPI lọc nhanh: Chưa hoàn thành / Quá hạn / Đã hoàn thành. Bộ lọc: tìm, trạng thái (Chưa hoàn thành / Mọi / TODO / IN_PROGRESS / DONE / CANCELLED), phạm vi (Việc của tôi / Mọi việc tôi được xem), khách hàng. Cột: Công việc (badge "Đã chuyển giao" nếu có lịch sử bàn giao), Khách hàng, Hạn, Ưu tiên, Tiến độ, Người làm, Trạng thái, thao tác (Hoàn thành). Form: Tên *, Khách hàng, Hạn, Người thực hiện, Ưu tiên, Tiến độ (0–100, >0 tự sang IN_PROGRESS), Mô tả, **Lịch sử chuyển giao**.
Độc lập với Lịch hẹn (đối tượng riêng); dùng chung dữ liệu với tab Công việc trong hồ sơ.

## 7. Màn hình 5 — Báo cáo (`ReportsPage.tsx`)
Bộ lọc: từ ngày, đến ngày, trạng thái (DRAFT/SUBMITTED), người báo cáo (khi `read_all`), **khách hàng liên quan**, Xóa bộ lọc · **+ Viết báo cáo**. Cột: Ngày làm việc, Người báo cáo, Nội dung thực hiện, Kết quả, Liên kết (khách hàng / lịch hẹn / công việc), Trạng thái, thao tác (Sửa / Nộp khi DRAFT của mình; Xem khi đã nộp).
Mở từ "Lập báo cáo" ở chi tiết lịch hẹn hoặc dòng To-do (`?appointment=` / `?task=`): form mở sẵn ngày, nội dung, khách hàng và liên kết gốc.
Form: Ngày làm việc *, Nội dung đã thực hiện *, Kết quả thực hiện *, Vấn đề phát sinh, Công việc cần tiếp tục, liên kết khách hàng / lịch hẹn / công việc; Lưu nháp / Nộp báo cáo. Báo cáo đã nộp chỉ đọc. Báo cáo hiện trong hồ sơ khách hàng (tab Hoạt động & Kết quả) — **GAP** Backend.

## 8. Popup, xác nhận và thông báo
- Modal đóng bằng ×, Esc hoặc bấm nền; footer luôn nằm trong khung nhìn (z-index trên thanh mobile).
- Hành động cần lý do (hủy lịch, từ chối, xác nhận thay) dùng `PromptDialog`: nút xác nhận bị khóa đến khi nhập lý do.
- Toast: thành công (xanh), lỗi (đỏ, `role=alert`), thông tin; trên mobile đặt trên thanh điều hướng dưới.
- Lỗi hiển thị nguyên thông điệp theo mã REV01 (`CM_VALIDATION_FAILED`, `CM_IDENTITY_DUPLICATE`, `CM_PERMISSION_DENIED`, …).

## 9. Ảnh chụp đối chiếu
Bằng chứng: `TALO-MOS-V4_exports/CRM_GATE1_ALIGNMENT_20261030/evidence/e2e/*.png` (desktop 1440, 1024, 768 và mobile 390). Bản remediation: `TALO-MOS-V4_exports/CRM_GATE1_REMEDIATION_20261101/evidence/e2e/`. Ảnh tham chiếu REV01: `TALO_MOS_CRM_V1_OFFLINE_DEMO/previews/`. REV02 không chạy được để chụp; UI/UX 29/10 không có bản gốc → không so sánh điểm ảnh (OD-01).
