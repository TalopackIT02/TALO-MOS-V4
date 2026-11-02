# 09 — Ma trận đối chiếu UI/UX & chức năng: REV01 Handoff → REV02 Demo → CRM Module

Ngày: 2026-11-01 — bản cuối Gate 1 closeout (OD-01 APPROVED: bộ nguồn chính thức = Web Demo REV02 + quy tắc UI/UX & Functional 29/10 đã mô tả + Backend Spec REV01 & BR đã duyệt + DB Dictionary CRM REV01). Nguồn:
- **REV01** = Fullstack Demo Handoff REV01 (`04_FRONTEND/01..04`, `06_QUALITY`, `02_BACKEND`).
- **REV02** = Web Demo REV02, handoff 29/10/2026 — `documents/development/talo-mos-crm-v1-demo` (chỉ đọc). Bản thân REV02 ghi "RUNTIME NOT VERIFIED"; repo không có `lucide-react` / react 18 nên **không chạy được REV02 để chụp ảnh** (không được cài thêm dependency). Đối chiếu REV02 là đối chiếu **mã nguồn**, không phải đối chiếu điểm ảnh.
- **Quy tắc UI/UX 29/10** = các quy tắc chủ dự án mô tả (5 Sidebar; hồ sơ 1/3–2/3 + 6 tab; Calendar / To-do / Work Report độc lập nhưng liên kết; phân công & bàn giao chỉ trong ngữ cảnh Khách hàng; Dashboard không thay thế Work Report). **Không có bản gốc handoff 29/10** → không thể tuyên bố khớp 100% thiết kế gốc.
- **Module** = `modules/CRM` sau remediation. **Evidence**: U = unit test (`tests/crm.mock.test.ts`), E = bước E2E (`dev/e2e.mjs`).

Phân loại (Module so với nguồn ưu tiên áp dụng): **MATCH** khớp · **DIFFERENCE** khác có lý do/nguồn ưu tiên cao hơn hoặc chờ quyết định · **MISSING** thiếu so với nguồn · **BLOCKED** bị chặn bởi hạ tầng/quy tắc chưa duyệt.

## A. Khung ứng dụng và điều hướng

| # | Hạng mục | REV01 | REV02 | Module | BR / quy tắc | Evidence | Phân loại |
|---|---|---|---|---|---|---|---|
| A1 | Sidebar | 9 mục (Dashboard, Duyệt pháp lý, Bàn giao…) | Đúng 5 mục | Đúng 5 mục, cùng thứ tự | Quy tắc 29/10 | E02 | MATCH (REV01 bị thay thế) |
| A2 | AppShell 4 khối | Có | Breadcrumb · tiêu đề/mô tả/actions · thanh chức năng ngữ cảnh · nội dung | Crumb · tiêu đề/mô tả/tab · panel nội dung (class Host) | Kiến trúc Host | E02 | MATCH; thanh chức năng ngữ cảnh của REV02 nằm trong toolbar màn Khách hàng (DIFFERENCE nhỏ — khối 3 do Host sở hữu) |
| A3 | Sidebar thu gọn (UI-02) | Compact, flyout, reflow | Nút "Thu gọn/Mở rộng" | Nút `#collapse-button` theo Host (`sidebar-compact`, `.layout.compact`, chữ tắt TQ/KH/LH/CV/BC) | UI-02 | **E21** | MATCH (bổ sung đợt này) |
| A4 | Mobile | UI-19 | Nút menu trên topbar | Mẫu Host: drawer + overlay + thanh dưới Menu/Trang chủ/Cá nhân | Kiến trúc Host ưu tiên | E20-390/768/1024/1440 | MATCH Host; DIFFERENCE REV02 (theo Host) |
| A5 | Thương hiệu | Visual contract | Logo chữ (REV02 G-14 tự ghi là gap) | Logo + tên công ty thật của Host | — | ảnh 04 | MATCH Host |
| A6 | Dải DEMO | Persona, reset | Persona, chế độ TARGET/BASELINE, +/−15 ngày demo, ma trận quyền, audit demo | Persona, "Trạng thái tích hợp", "Khôi phục dữ liệu mẫu" | — | E22 | DIFFERENCE: không làm chế độ BASELINE 11/114 (TEST đã cài 15/173), không có đồng hồ demo, ma trận quyền, audit demo |
| A7 | Khôi phục dữ liệu mẫu (UI-18) | Có | Có xác nhận | Có xác nhận; hủy → không đổi; đồng ý → seed, màn đang mở cập nhật | UI-18 | **E22**, U24 | MATCH (bổ sung test đợt này) |

## B. Tổng quan công việc

| # | Hạng mục | REV01 | REV02 | Module | BR / quy tắc | Evidence | Phân loại |
|---|---|---|---|---|---|---|---|
| B1 | KPI | Dashboard | 6 KPI (KH phụ trách, lịch hôm nay, lịch sắp tới, việc chưa xong, quá hạn, hoàn thành trong kỳ) | 5 KPI + danh sách "Lịch hẹn 7 ngày tới"; hoàn thành theo tuần/tháng | Lệnh Gate 1 | E01, E03 | MATCH (lịch sắp tới ở dạng danh sách) |
| B2 | "KH đang phụ trách" | — | = số KH xem được | = KH có phân công hiệu lực; hiện thêm "(xem được N)" | Lệnh Gate 1 "đang phụ trách" | E01 | DIFFERENCE nhỏ (theo lệnh) |
| B3 | Chờ xử lý theo quyền | Có màn duyệt riêng | Không ở dashboard; nằm ở thanh chức năng Khách hàng | Dashboard **chỉ liệt kê**, bấm → màn **Khách hàng** xử lý | Quy tắc 29/10: bàn giao chỉ trong ngữ cảnh Khách hàng | **E14, E15** | MATCH (sửa đợt này) |
| B4 | Cảnh báo tài liệu | Có | Trang "Tài liệu đến hạn" | Thẻ trên dashboard khi có `document.read` | BR-15 | E01 | MATCH (trang riêng tài liệu đến hạn của REV02 không có — xem R-B4) |
| B5 | Dashboard ≠ Work Report | — | Ghi rõ | Hai màn riêng, dashboard không có biểu mẫu báo cáo | Quy tắc 29/10 | E01, E10 | MATCH |

## C. Danh sách khách hàng

| # | Hạng mục | REV01 | REV02 | Module | BR | Evidence | Phân loại |
|---|---|---|---|---|---|---|---|
| C1 | Cột | 11 cột: Mã, tên thường gọi, tên pháp lý, định danh (mask), loại, tỉnh/QG, miền/vùng, quan hệ, hồ sơ, Sale chính, thao tác | 8 cột (không có định danh, miền/vùng; tên pháp lý là dòng phụ) | 11 cột REV01 **+ "Ngày tạo"** (để sắp xếp theo ngày tạo) = 12 | BR-17 | E04 | MATCH REV01 (+1 cột bổ sung); DIFFERENCE REV02 |
| C2 | Bộ lọc | Mã/tên/MST, loại, quan hệ, DRAFT/VERIFIED, tỉnh/miền, PRIMARY/SUPPORT, nhóm, ẩn theo quyền | Hồ sơ, loại, quan hệ, địa bàn, Sale, nhóm, ẩn (`customer.hide`) | Đủ REV01 + vùng kinh tế + Sale; "gồm hồ sơ ẩn" theo `read_all` | BR-17 | E04, U20 | MATCH; quyền bật "hồ sơ ẩn" khác REV02 (`read_all` vs `customer.hide`) → DIFFERENCE nhỏ |
| C3 | Tìm theo định danh | Có | Có | **Đã sửa:** chỉ người có quyền xem định danh đầy đủ (`IDENTIFIER_VIEW_PERMISSION`, đề xuất OD-05) mới tìm được theo định danh (khớp toàn phần hoặc một phần), luôn trong phạm vi; người bị che chỉ tìm theo mã/tên; cảnh báo trùng tên chỉ đếm khách trong phạm vi; kiểm trùng định danh chỉ trả có/không (BR-06) | BR-06/17/19 | U25–U27, E17, E18 | MATCH (đã sửa theo lệnh closeout I.1) |
| C4 | Xem nhanh | Mở hồ sơ / Sửa / **Ẩn** theo quyền | Đóng / Sửa / Mở; **không hiện định danh** | Đóng / **Ẩn hồ sơ** (theo `customer.hide`, có xác nhận) / Mở hồ sơ (Sửa); định danh hiện dạng che theo OD-05 | UI-05 | E05, E13b | DIFFERENCE (phần hiển thị định danh so với REV02 — chờ OD-05); nút Ẩn: đã sửa |
| C5 | Phân trang / sắp xếp | 20 mặc định | 10/20/50/100, sắp mã/tên | 10/20/50/100, sắp mã/tên/ngày tạo 2 chiều | BR-17 | E04 | MATCH |
| C6 | Xuất CSV | Quyền, phạm vi, chống công thức, BOM | Quyền, phạm vi | Quyền, phạm vi, chống công thức, **BOM UTF-8** | BR-18 | U2, U8, E17 | MATCH (BOM thêm đợt này) |

## D. Biểu mẫu tạo khách hàng

| # | Hạng mục | REV01 | REV02 | Module | BR | Evidence | Phân loại |
|---|---|---|---|---|---|---|---|
| D1 | Nhóm | 1 Hồ sơ · 2 Địa chỉ · 3 Liên hệ 0..n · 4 Sale + nhóm | 1 Thông tin · 2 Địa chỉ · 3 Phân công & nhóm · 4 **một** liên hệ | Theo REV01 | — | E11, E12 | MATCH REV01; DIFFERENCE REV02 (thứ tự, số liên hệ) |
| D2 | Kiểm định danh | Inline, 409 | Nút "Kiểm tra định danh" | Inline tự động + "Mở hồ sơ đã có" (chỉ khi trong phạm vi) | BR-06 | E11, U4 | MATCH |
| D3 | Nước ngoài | Checkbox, xác nhận, snapshot chỉ đọc | Chọn quốc gia, `window.confirm`, không snapshot | Checkbox + hộp xác nhận + snapshot chỉ đọc | BR-08 | E11 | MATCH |
| D4 | Nút lưu | Lưu Draft / Lưu và xác minh | Lưu DRAFT / Lưu và xác minh (theo quyền) | Như REV01 (xác minh theo quyền) | D01-a | E11, E12 | MATCH |
| D5 | Không có quyền phân công | Chỉ hiện theo quyền | **Tự ghi người tạo là Sale chính** (select khóa) | FE-G01: như REV02, có nhãn "chưa được duyệt" | BR-01 | E11 | MATCH REV02 — vẫn là OD-02 |
| D6 | Giao dịch | "lưu contacts/assignment atomically trong mock" | Tuần tự, báo lỗi từng phần | Nguyên khối (rollback) | GAP-API-01 | U18 | MATCH REV01; DIFFERENCE REV02 → OD-03 |

## E. Hồ sơ khách hàng

| # | Hạng mục | REV01 | REV02 | Module | BR | Evidence | Phân loại |
|---|---|---|---|---|---|---|---|
| E1 | Bố cục | 1/3 – 2/3 | 1/3 – 2/3 | 1/3 – 2/3 (gộp 1 cột ≤ 1100 px) | Quy tắc 29/10 | E06, E20 | MATCH |
| E2 | 6 tab | Tabs khác (Liên hệ, Hoạt động, Tài liệu, Phân công/Bàn giao, Pháp lý) | Đúng 6 tab theo thứ tự | Đúng 6 tab theo thứ tự | Quy tắc 29/10 | E06 | MATCH (REV01 bị thay thế) |
| E3 | Phân công / bàn giao / pháp lý | Là tab | Mục "Quản trị hồ sơ / Yêu cầu đặc biệt" mở tab ẩn | Nút + hộp trạng thái ở cột trái theo quyền | Quy tắc 29/10 | E14–E16 | MATCH quy tắc; DIFFERENCE vị trí (cột trái thay cho mục mở rộng) |
| E4 | Tổng quan | Số liên hệ, việc mở, tài liệu sắp hết hạn, cập nhật gần đây | Liên hệ hiệu lực, việc OPEN, tài liệu cảnh báo + "chưa tích hợp Đơn hàng/Kho/Kế toán" | Lịch sắp tới, việc mở/quá hạn, tài liệu cảnh báo, hoạt động gần đây | — | E06 | MATCH (nội dung tương đương) |
| E5 | Hoạt động & Kết quả | Timeline | Báo cáo + timeline (hoạt động, bàn giao, pháp lý) | Timeline hoạt động + báo cáo liên quan (nhãn GAP) | — | E10 | MATCH |
| E6 | Lịch sử pháp lý | Trước/sau, trạng thái | Bảng "Lịch sử yêu cầu" | Danh sách "Lịch sử thay đổi pháp lý" | BR-03 | **E16** | MATCH (thêm đợt này) |
| E7 | Tài liệu | Upload/download giả lập trong trình duyệt | Blob phiên trình duyệt, tải/xem | Chỉ metadata + phiên bản; lưu/tải **BLOCKED**, không nút tải giả | Lệnh Gate 1 (không giả lập file) | E19 | BLOCKED (theo lệnh — khác REV01/REV02 có chủ ý) |
| E8 | Hiển thị định danh | "mask tùy quyền" | Chỉ người có `customer.verify` (hoặc admin) thấy; danh sách không có cột | Che khi thiếu `crm.legal_change.read` (Sale thấy đủ) | BR-19 | E18, U21 | DIFFERENCE → OD-05 (REV02 chặt hơn) |

## F. Lịch hẹn, Công việc, Báo cáo

| # | Hạng mục | REV01 | REV02 | Module | BR / quy tắc | Evidence | Phân loại |
|---|---|---|---|---|---|---|---|
| F1 | Lịch ngày/tuần/tháng | — | Có | Có | Quy tắc 29/10 | E07 | MATCH |
| F2 | Trường lịch hẹn | — | Khách *, tiêu đề *, giờ hẹn (không có giờ kết thúc), địa điểm, nội dung, nhắc 5/15/30/60/1440, **giao cho nhân viên khác** | Tiêu đề *, khách (tùy chọn), **người liên hệ**, bắt đầu + **kết thúc**, địa điểm, nội dung, nhắc 0/10/30/60/1440; người phụ trách = người tạo | Lệnh Gate 1 (start/end, contact) | E07, E08, U15 | DIFFERENCE: không giao lịch cho người khác (REV02 có) |
| F3 | Hủy lịch | Confirm | Confirm, không lý do | Bắt buộc lý do | Kiểm soát chặt hơn | E08 | DIFFERENCE (chặt hơn) |
| F4 | Mô hình dữ liệu lịch | — | `cm_customer_activities` MEETING + mô tả có marker (không thêm bảng) | Đối tượng riêng (mock) | Gate 2 | — | DIFFERENCE → OD-06 |
| F5 | To-do | — | TASK/FOLLOW_UP, OPEN/DONE, **không ưu tiên** (G-06), lọc mở/xong/quá hạn/Sale/khách | TODO/IN_PROGRESS/DONE/CANCELLED, ưu tiên + tiến độ **nhãn mô phỏng**, lọc | Lệnh Gate 1 "priority & progress (demo)" | E09, U16 | DIFFERENCE → OD-06 (nhãn mô phỏng thêm đợt này) |
| F6 | To-do không thành lịch | — | Có | Có | Quy tắc 29/10 | E09 | MATCH |
| F7 | Work Report | — | NOTE hoàn tất ngay (không nháp), liên kết 1 hoạt động gốc | Nháp → nộp, liên kết nhiều KH/lịch/việc | Lệnh Gate 1 (nháp/nộp) | E10, U17 | DIFFERENCE → OD-12 |
| F8 | "Lập báo cáo" từ lịch / To-do | — | Có | Có — form mở sẵn liên kết | Quy tắc 29/10 (liên kết dữ liệu) | **E19b** | MATCH (thêm đợt này) |
| F9 | Báo cáo trong hồ sơ | — | Tab Hoạt động & Kết quả | Có (nhãn GAP) | — | E10 | MATCH |
| F10 | Đồng bộ hồ sơ ↔ màn tổng | — | Cùng một kho dữ liệu | Cùng một kho dữ liệu; mở lại đúng tab | — | E07, E08 | MATCH |
| F11 | Nhắc lịch | — | Theo đồng hồ demo, trong app | Theo giờ thật, trong app (30 giây) | Không push/email | U15 | MATCH |

## G. Bàn giao và To-do

| # | Hạng mục | REV01 | REV02 | Module | BR | Evidence | Phân loại |
|---|---|---|---|---|---|---|---|
| G1 | Luồng A / B | Có | Có | Có | BR-10 | E14, E15, U10, U11 | MATCH |
| G2 | Chuyển hoạt động OPEN của Sale chính cũ | Có | Có (+ bảng chuyển việc) | Có; chi tiết bàn giao đã kết thúc liệt kê hoạt động / To-do đã chuyển | BR-11 | U10, E15b | MATCH |
| G3 | To-do theo bàn giao | — | To-do **là** activity TASK → tự chuyển theo BR-11 | Đối tượng riêng → chuyển theo cờ **Target Design** | — | U22, E14 | DIFFERENCE → OD-07 (nếu OD-06 chọn mô hình REV02 thì OD-07 tự giải quyết) |
| G4 | Xác nhận thay (override) | Control có nhãn "cần phê duyệt chính sách" | API cho phép (quyền `handover.approve` + lý do), **UI không mở** | UI mở khi Sale hiện tại nghỉ việc + quyền override + lý do; nhãn **D05 đề xuất** | D05 (đề xuất) | E15, U11 | DIFFERENCE → OD-15 |
| G5 | Danh sách bàn giao (đang chờ / đã kết thúc) | Có | Trang Quản trị bàn giao | **Đã sửa:** hàng đợi màn Khách hàng có tab "Chờ tôi xử lý" và "Bàn giao đã kết thúc" (theo phạm vi); chi tiết: diễn biến từng bước (người yêu cầu, duyệt, xác nhận / xác nhận thay + lý do, nhận, hoàn tất) và việc đã chuyển | BR-10/11 | U29, E15b | MATCH (đã sửa) |
| G6 | Người nhận xử lý khi chưa có phạm vi | — | Có | Có (xử lý tại hàng đợi) | BR-01 | E14 | MATCH |

## H. Phê duyệt pháp lý hai cấp

| # | Hạng mục | REV01 | REV02 | Module | BR | Evidence | Phân loại |
|---|---|---|---|---|---|---|---|
| H1 | Quản lý → Kế toán → áp dụng | Có | Có | Có; hồ sơ không đổi trước bước kế toán | BR-03 | E16, U13 | MATCH |
| H2 | Không tự duyệt | — (D04 đề xuất) | Người đề nghị không duyệt cùng cấp | Người đề nghị không duyệt cấp nào; nhãn **D04 đề xuất** | D04 | U14 | MATCH (chặt hơn) → OD-16 |
| H3 | Chứng từ bắt buộc | Có | Chọn tài liệu đã upload | Bắt buộc chọn tài liệu | BR-03 | U14 | MATCH |
| H4 | Không PATCH trực tiếp pháp lý | Có | `CM_APPROVAL_REQUIRED` | UI không cho sửa; mock không phát mã này | BR-03 | E16 | MATCH (mã lỗi chưa phát sinh) |

## I. Khác

| # | Hạng mục | REV01 | REV02 | Module | Phân loại |
|---|---|---|---|---|---|
| I1 | Quản lý danh mục nhóm | Có | Trang Nhóm khách hàng | Hộp nhóm trong hồ sơ (gán + tạo nhóm) | DIFFERENCE nhỏ (không có trang danh mục riêng) |
| I2 | Audit demo | Có | Bảng audit demo | **Đã sửa (mock):** "Nhật ký thao tác (Audit demo)" — actor, mã `CRM.<FUNCTION>.<ACTION>`, đối tượng, không PII, chỉ thao tác thành công, giao dịch rollback không để lại dòng, xóa khi khôi phục dữ liệu mẫu. **Audit Foundation thật: BLOCKED** (BR-12, GAP-AUD-01) — không nghiệm thu tích hợp trong Gate 1 | BR-12/19 | U28, U29, E16b, E22 | MATCH (mock) · BLOCKED (tích hợp Foundation) |
| I3 | Mã lỗi | 11 mã | 11 mã + `CM_NOT_INTEGRATED` | 11 mã REV01 + 5 mã chỉ có trong mock | DIFFERENCE → OD-08 |

## Tổng hợp cuối (Gate 1 closeout)
Đếm theo **phân loại chính** của mỗi dòng (56 dòng):

| Phân loại | Số dòng | Dòng |
|---|---:|---|
| MATCH | 42 | A1–A5, A7, B1, B3–B5, C1–C3, C5, C6, D1–D6, E1–E6, F1, F6, F8–F11, G1, G2, G5, G6, H1–H4, I2 |
| DIFFERENCE | 13 | A6, B2, C4, E8, F2, F3, F4, F5, F7, G3, G4, I1, I3 |
| MISSING | 0 | (G5, I2 đã bổ sung và kiểm thử) |
| BLOCKED | 1 | E7 (lưu / tải file thật) — cộng phần tích hợp Audit Foundation của I2 |

So với bản remediation (39 / 14 / 2 / 1): C3 chuyển MATCH do **đã sửa** (lệnh closeout I.1, có test); G5, I2 chuyển MATCH do **đã bổ sung** (có test). Không có dòng DIFFERENCE nào được chuyển thành MATCH chỉ bằng cách đổi nhãn.

## Kết quả xử lý từng dòng DIFFERENCE / MISSING / BLOCKED
Ba kết quả: **[1] Đã sửa và kiểm thử** · **[2] Khác biệt được chấp nhận theo nguồn ưu tiên cao hơn** · **[3] Chưa giải quyết — cần quyết định / phụ thuộc hệ thống (ghi Gate xử lý)**.

| Dòng | Kết quả | Giải thích | Gate xử lý |
|---|---|---|---|
| A6 Công cụ demo REV02 | [2] một phần + [3] một phần | Chế độ BASELINE 11/114: không áp dụng — DB Dictionary CRM REV01 (đã nghiệm thu) và TEST đã cài 15/173 [2]. Audit demo: đã bổ sung (xem I2) [1]. Đồng hồ demo ±15 ngày, trang ma trận quyền: chưa có [3] | Gate 1 (chỉ khi chủ dự án yêu cầu) |
| B2 "KH đang phụ trách" | [2] | Quy tắc chủ dự án: "tổng KH đang phụ trách" = có phân công hiệu lực; REV02 đếm KH xem được | — |
| C3 Tìm theo định danh | [1] | Xem dòng C3; U25–U27, E17, E18 | — |
| C4 Xem nhanh | [1] nút Ẩn · [3] hiển thị định danh | Nút Ẩn theo REV01 §A (E13b). REV02 không hiện định danh trong xem nhanh; mock hiện dạng che — chờ OD-05 | IAM (Gate 3) + Backend |
| E8 Quyền xem định danh | [3] | Mock dùng `crm.legal_change.read` (đề xuất OD-05); REV02 dùng `customer.verify`. Không tự đổi quy tắc bảo mật | IAM (Gate 3) + Backend |
| F2 Trường lịch hẹn | [2] giờ kết thúc + người liên hệ · [3] giao lịch cho người khác | Quy tắc chủ dự án yêu cầu start/end và chọn người liên hệ; giao lịch cho nhân viên khác (REV02) chưa có trong yêu cầu đã duyệt | Gate 2 (OD-06 / OD-11) |
| F3 Hủy lịch bắt buộc lý do | [2] | Lệnh chủ dự án: không làm yếu kiểm soát; REV01 yêu cầu ghi lý do khi hủy / từ chối | — |
| F4 Mô hình dữ liệu lịch | [3] | Hiển thị theo quy tắc chủ dự án; mô hình lưu trữ chờ OD-06 | Gate 2 |
| F5 To-do ưu tiên / tiến độ | [2] UI · [3] dữ liệu | Quy tắc chủ dự án: "priority & progress (demo)" — có nhãn mô phỏng; REV02 G-06 không có cột → chờ OD-06 | Gate 2 |
| F7 Work Report nháp / nộp | [2] UI · [3] dữ liệu | Quy tắc chủ dự án: draft edit / view / submit; mô hình lưu trữ chờ OD-12 | Gate 2 |
| G3 To-do theo bàn giao | [3] | Target Design; không thuộc REV01 | Gate 2 + Backend delta (OD-07) |
| G4 Xác nhận thay (override) | [3] | D05 là đề xuất; REV02 không mở UI; không tự đổi D05 | Backend / chính sách (OD-15) |
| I1 Danh mục nhóm | [3] | Có gán nhóm và tạo nhóm trong hồ sơ; chưa có trang danh mục riêng (sửa / ngừng nhóm) như REV01 §D, REV02 | Gate 1 (chỉ khi chủ dự án yêu cầu) |
| I3 Mã lỗi mock | [3] | 5 mã ngoài REV01 | Backend contract (OD-08) |
| E7 Lưu / tải file | [3] BLOCKED | Lệnh Gate 1: không giả lập file; storage chưa duyệt | Hạ tầng + Backend (OD-10) |
| I2 Audit Foundation | [3] BLOCKED | Audit demo đã có [1]; audit thật cần Backend + Foundation Audit trong cùng giao dịch | Backend + Foundation (GAP-AUD-01) |
| G5 Bàn giao đã kết thúc | [1] | U29, E15b | — |
| R-B4 Trang tài liệu đến hạn | [3] | Thẻ dashboard có; trang lọc riêng của REV02 chưa có | Gate 1 (chỉ khi chủ dự án yêu cầu) |
