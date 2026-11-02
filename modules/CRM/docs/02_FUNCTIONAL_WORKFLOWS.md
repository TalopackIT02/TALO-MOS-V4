# 02 — Luồng chức năng CRM Module V1 (Gate 1)

Tất cả luồng chạy trên **Mock Adapter** (`frontend/src/services/mockAdapter.ts`) với IAM giả lập. Mỗi thao tác ghi kiểm tra quyền **trước** khi đọc dữ liệu, kiểm tra phạm vi (BR-01/BR-17), rồi mới kiểm tra nghiệp vụ. Mã lỗi theo Backend REV01 (`02_BACKEND/03_VALIDATION_ERRORS_AND_CONFIGURATION.md`). Nhãn **Target Design** = hành vi mô phỏng chưa thuộc Backend REV01, cần duyệt Delta.

Persona thử (chỉ dùng nghiệm thu — quyền thật lấy từ IAM, không hardcode theo tên người dùng):

| Persona | accountId | Bộ quyền giả lập |
|---|---|---|
| Nguyễn Văn An — Sale | acc-sale-a | SALE |
| Trần Thị Bình — Sale | acc-sale-b | SALE |
| Lê Minh Cường — Sale | acc-sale-c | SALE |
| Phạm Quốc Dũng — Quản lý kinh doanh | acc-mgr | MANAGER (SALE + read_all, verify, hide, export, approve_management, assignment.manage, handover.approve/override, group.manage) |
| Hoàng Thu Hà — Kế toán | acc-acc | ACCOUNTANT (read_all, approve_accounting, export, chỉ đọc) |
| Đỗ Văn Khôi — Sale đã nghỉ | acc-sale-x | không có quyền (inactive) |
| Vũ Thị Lan — CSKH chỉ xem | acc-viewer | VIEWER (đọc; **không** có legal_change.read → định danh bị che) |

## WF-01 Tìm và xem khách hàng
1. Màn Khách hàng → `listCustomers(q)`: kiểm `crm.customer.read` → lọc phạm vi (READ_ALL hoặc có phân công hiệu lực) → bộ lọc → đếm → sắp xếp → phân trang (≤ 100). Hồ sơ đã ẩn chỉ khi `includeHidden` (READ_ALL).
2. Bấm tên → Xem nhanh (dữ liệu dòng đã che theo quyền) → "Mở hồ sơ".
3. "Xem hồ sơ" / deep link `?customer=` → `customerBundle(id)`: ngoài phạm vi hoặc không tồn tại → `CM_CUSTOMER_NOT_FOUND` (404 không tiết lộ). Mỗi phần của bundle chỉ trả khi có quyền đọc phần đó.

## WF-01b Tìm theo định danh pháp lý (lệnh closeout I.1)
- Quyền **tìm** theo định danh = quyền **xem** định danh đầy đủ (một hằng số `IDENTIFIER_VIEW_PERMISSION`, hiện = `crm.legal_change.read` — đề xuất OD-05, chưa duyệt). Không có quyền: định danh bị che và **không** là trường tìm kiếm (không khớp toàn phần hay một phần) → không dò được giá trị.
- Có quyền: khớp toàn phần / một phần, nhưng luôn sau bước lọc phạm vi → không suy ra được khách ngoài phạm vi.
- Cảnh báo trùng tên chỉ đếm khách trong phạm vi. Kiểm trùng định danh (BR-06) phải toàn cục để giữ tính duy nhất: chỉ trả **có / không**, không trả mã, tên hay id; nút "Mở hồ sơ đã có" chỉ hiện khi hồ sơ trong phạm vi. Đây là phần thông tin tối thiểu không tránh được của quy tắc duy nhất, chỉ người có quyền tạo / sửa khách mới gọi được.
- Không mở rộng quyền IAM.

## WF-02 Tạo khách hàng (form 4 nhóm)
1. "+ Khách hàng" (cần `crm.customer.create`). Nhập nhóm 1–4.
2. Kiểm tra định danh trực tiếp `checkIdentity` (BR-06): chuẩn hóa (MST 10/13 số, CCCD 12 số, mã nước ngoài) → sai cấu trúc; trùng → báo 409 và chỉ đưa "Mở hồ sơ đã có" nếu hồ sơ nằm trong phạm vi; trùng tên → cảnh báo.
3. Đổi VN ↔ nước ngoài khi đã có địa chỉ → hộp xác nhận "Đổi và xóa địa chỉ đã nhập" / "Giữ nguyên".
4. "Lưu Draft" hoặc "Lưu và xác minh" → `createCustomerFull` (mock 1 giao dịch):
   - Kiểm quyền từng phần: liên hệ → `contact.manage`; Sale chính/hỗ trợ → `assignment.manage`; nhóm → `group.assign`; xác minh → `customer.verify`. Thiếu → `CM_PERMISSION_DENIED`, không lưu gì.
   - Tạo hồ sơ DRAFT (mã 6 số) → liên hệ → phân công PRIMARY/SUPPORT → nhóm → (tùy chọn) xác minh. Lỗi bất kỳ → **khôi phục toàn bộ** (không có hồ sơ mồ côi).
   - Không chọn Sale chính và tài khoản không có READ_ALL → **FE-G01 (chưa duyệt)**: người tạo được ghi PRIMARY để còn mở lại được hồ sơ.
5. **GAP-API-01**: REV01 chỉ có `POST /customers`, `POST /customers/:id/contacts`, `POST /customers/:id/assignments`, `PUT /customers/:id/groups`, `POST /customers/:id/verify` là các lệnh riêng — không có giao dịch tổng hợp. Mock chạy nguyên khối; Backend thật cần quyết định (OD-03).

## WF-03 Xác minh hồ sơ (D01-a)
DRAFT → "Xác minh hồ sơ" (`customer.verify`) → bắt buộc đủ: tên pháp lý, loại + số định danh hợp lệ, số nhà/đường, tỉnh + xã (VN) → `VERIFIED`. Thiếu → `CM_VALIDATION_FAILED` liệt kê trường thiếu; đã VERIFIED → lỗi. Trạng thái quan hệ (PROSPECT/…) độc lập với trạng thái hồ sơ.

## WF-04 Sửa thông tin thường và ẩn hồ sơ
"Sửa thông tin" (`customer.update`): tên thường gọi, quan hệ, đại diện, ghi chú, địa chỉ (không phá điều kiện VERIFIED). Tên pháp lý/định danh của hồ sơ VERIFIED **không sửa trực tiếp** — phải qua WF-05 (REV01 `CM_APPROVAL_REQUIRED`). Ẩn hồ sơ: `customer.hide` (REV01 chỉ có `hide`; không có thao tác hiện lại).

## WF-05 Thay đổi pháp lý 2 cấp (BR-03)
1. Sale/Quản lý (`legal_change.request`) trên hồ sơ VERIFIED → nhập tên/loại/định danh/quốc gia mới, lý do, **chứng từ** (tài liệu của khách) → `PENDING_MANAGEMENT`. DRAFT → `CM_DRAFT_NOT_ELIGIBLE`; đã có yêu cầu chờ → bị chặn.
2. Quản lý (`approve_management`) duyệt/từ chối → `PENDING_ACCOUNTING`. Người đề nghị không tự duyệt → `CM_PERMISSION_DENIED` (đề xuất D04 — OD-16, chưa chốt).
3. Kế toán (`approve_accounting`) duyệt → `APPLIED`: áp dụng snapshot vào hồ sơ. Trước bước này hồ sơ **không đổi**.
4. Xử lý tại hồ sơ (hộp pháp lý ở cột trái) hoặc hàng đợi "Chờ xử lý" của màn Khách hàng (Tổng quan chỉ liệt kê và điều hướng sang).

## WF-06 Phân công Sale (BR-01 / BR-09)
"Phân công" (`assignment.manage`): thêm SUPPORT; PRIMARY chỉ khi chưa có (đã có → dùng bàn giao). Không trùng Sale đang hiệu lực → `CM_ASSIGNMENT_CONFLICT` (mã mock — OD-08). Kết thúc SUPPORT; PRIMARY chỉ thay qua bàn giao. Sale nghỉ việc không được gán.

## WF-07 Bàn giao — luồng B (Sale đề nghị)
1. Sale chính hiện tại (`handover.request`) → "Yêu cầu bàn giao", luồng B, chọn Sale nhận → `PENDING_APPROVAL`.
2. Quản lý (`handover.approve`) duyệt → `PENDING_RECEIVER_ACK` (hoặc từ chối có lý do → `REJECTED`). Sale không duyệt được → `CM_PERMISSION_DENIED`.
3. Sale nhận (`handover.acknowledge`) "Nhận bàn giao" — xử lý trong hàng đợi "Chờ xử lý" của màn **Khách hàng** (mở từ Tổng quan hoặc nút trên thanh công cụ) vì người nhận chưa có phạm vi hồ sơ → `COMPLETED`:
   - đóng PRIMARY cũ, đóng SUPPORT của người nhận (nếu có), mở PRIMARY mới;
   - chuyển **hoạt động OPEN của Sale cũ** cho người nhận (REV01 BR-11, ghi `transferredActivityIds`);
   - **Target Design**: chuyển **To-do TODO/IN_PROGRESS của Sale cũ gắn khách hàng này** cho người nhận, ghi `Task.history` (HANDOVER) và `transferredTaskIds` (`TARGET_DESIGN_TRANSFER_TODOS = true`);
   - ghi hoạt động "Hoàn tất bàn giao khách hàng".
4. Sale cũ mất phạm vi (deep link → 404). Chỉ một bàn giao mở cho mỗi khách.

## WF-08 Bàn giao — luồng A (Quản lý yêu cầu)
1. Quản lý → luồng A → `PENDING_CURRENT_ACK`.
2. Sale hiện tại xác nhận → `PENDING_RECEIVER_ACK`. **Xác nhận thay** (`handover.override`, **đề xuất D05 — OD-15, chưa duyệt**) chỉ khi Sale hiện tại **không còn hoạt động** và phải nhập lý do; Sale còn hoạt động → nút không hiện, gọi trực tiếp → `CM_HANDOVER_INVALID_STATE`.
3. Sale nhận xác nhận → `COMPLETED` (như bước 3 luồng B).

### Kịch bản FE-FIX-02 (mô phỏng, có nhãn Target Design)
Dữ liệu mẫu: KH 000007 — Sale A là Sale chính, có hoạt động OPEN và To-do mở "Chuẩn bị bảng giá cho khách 000007" (tsk-007); yêu cầu bàn giao hdv-001 A → C (`PENDING_APPROVAL`). Quản lý duyệt (hộp xử lý ghi rõ: hoạt động OPEN — REV01; To-do — **Target Design**) → Sale C nhận → To-do chuyển cho C, badge "Đã chuyển giao", lịch sử "Bàn giao khách hàng — Target Design"; To-do đã xong hoặc của khách khác **không** chuyển. Kiểm chứng: unit test "FE-FIX-02 …", E2E bước 14. **Không** coi đây là Business Rule đã triển khai trong REV01 — cần Backend/DB Delta (GAP-DB-04, OD-07).

## WF-09 Người liên hệ, nhóm ngành, hoạt động
- Liên hệ (`contact.manage`): họ tên bắt buộc, cần điện thoại **hoặc** Zalo, chức vụ tùy chọn, một liên hệ chính; ngừng sử dụng thay vì xóa.
- Nhóm ngành: gán nhiều nhóm (`group.assign`); quản lý danh mục (`group.manage`).
- Hoạt động (`activity.*`): tạo, sửa khi OPEN, hoàn thành; lịch sử không sửa.

## WF-10 Tài liệu
Metadata (`document.manage`): tên, loại, ngày ký/hiệu lực/hết hạn, ghi chú; loại file PDF/JPG/PNG (`CM_FILE_INVALID`), giới hạn 10 MB = **đề xuất D07**. Phiên bản mới ghi `supersedes` — bản cũ giữ nguyên. Trạng thái hiệu lực tính theo ngày; "sắp hết hạn" 30 ngày = **đề xuất D06**. **Lưu/tải file thật: BLOCKED** (chưa có storage được duyệt) — mock không lưu nội dung file, không có nút tải xuống giả.

## WF-11 Lịch hẹn ↔ hồ sơ (đồng bộ hai chiều)
- Tạo ở hồ sơ (tab Lịch hẹn / nút "+ Lịch hẹn") → cùng kho dữ liệu → hiện ngay ở màn Lịch hẹn.
- Tạo ở màn Lịch hẹn, chọn khách hàng + người liên hệ → hiện ở tab Lịch hẹn của hồ sơ.
- Chi tiết lịch → "Mở lịch hẹn trong hồ sơ khách hàng" → mở hồ sơ đúng tab Lịch hẹn (`?customer=…&tab=Lịch hẹn`).
- Quy tắc: khách hàng phải trong phạm vi; kết thúc > bắt đầu; sửa/hủy/ghi kết quả chỉ người phụ trách và khi SCHEDULED; hủy bắt buộc lý do; nhắc lịch trong ứng dụng (kiểm tra mỗi 30 giây, không push, không job nền).

## WF-12 Công việc (To-do)
Độc lập với Lịch hẹn. Tạo/sửa: tên bắt buộc, khách hàng trong phạm vi, hạn, người thực hiện (đổi người → `history` REASSIGN), ưu tiên, tiến độ (>0 → IN_PROGRESS). Hoàn thành → DONE, tiến độ 100, không sửa tiếp. Lọc: chưa xong / quá hạn / đã xong / theo khách. Dùng chung dữ liệu với tab Công việc của hồ sơ và KPI ở Tổng quan.

## WF-13 Báo cáo công việc
Viết (ngày, nội dung *, kết quả *, vấn đề, việc tiếp theo, liên kết khách/lịch/việc) → Lưu nháp hoặc Nộp. Nháp: chỉ tác giả xem/sửa. Đã nộp: chỉ đọc; người có READ_ALL xem được báo cáo đã nộp của người khác. Lọc theo ngày, người báo cáo, khách hàng, trạng thái. Hiện trong hồ sơ khách (tab Hoạt động & Kết quả) — **GAP**: chưa có bảng/API (Gate 2).

## WF-14 Xuất CSV
`customer.export`; dữ liệu theo phạm vi + bộ lọc hiện tại; chống công thức (ô bắt đầu `= + - @ Tab CR` được thêm `'`). Không có quyền → nút không hiện, gọi trực tiếp → `CM_PERMISSION_DENIED`.

## WF-15 Đổi persona / khôi phục dữ liệu mẫu
Đổi tài khoản thử → mọi truy vấn chạy lại (không giữ cache hồ sơ ngoài phạm vi). "Khôi phục dữ liệu mẫu" hỏi xác nhận: hủy → không đổi gì; đồng ý → dữ liệu về seed (`MOCK_VERSION = 4`), mọi thay đổi mock bị xóa, màn đang mở tự cập nhật, giữ tài khoản thử đang chọn (UI-18: unit "reset()…", E2E 22).

## WF-17 Bàn giao đã kết thúc
Màn Khách hàng → "Chờ xử lý (n)" → tab "Bàn giao đã kết thúc": danh sách bàn giao COMPLETED / REJECTED / CANCELLED trong phạm vi (người tham gia hoặc khách trong phạm vi). Chi tiết: diễn biến từng bước (người yêu cầu, quản lý duyệt, Sale hiện tại xác nhận hoặc xác nhận thay + lý do, Sale nhận, hoàn tất / từ chối + lý do) và việc đã chuyển (hoạt động OPEN — REV01; To-do — Target Design). Chỉ đọc.

## WF-18 Audit demo
Mỗi thao tác ghi **thành công** của mock thêm một dòng: thời gian, người thực hiện, mã `CRM.<FUNCTION>.<ACTION>` (lịch / việc / báo cáo có hậu tố "(mock)" vì chưa có quyền IAM — OD-11), loại + id đối tượng, chi tiết (override, APPROVED / REJECTED). Không PII. Giao dịch mock bị rollback không để lại dòng; "Khôi phục dữ liệu mẫu" xóa nhật ký. **Không phải Audit Foundation** — tích hợp thật BLOCKED (BR-12, GAP-AUD-01).

## WF-16 Lập báo cáo từ lịch hẹn / To-do
Chi tiết lịch hẹn của mình (không bị hủy) hoặc dòng To-do được giao cho mình → "Lập báo cáo" → màn Báo cáo mở form có sẵn ngày, nội dung, khách hàng và liên kết gốc → Lưu nháp / Nộp. Liên kết chỉ là mock (GAP-DB-03, OD-12). E2E 19b.
