# 06 — Ma trận kiểm thử và nghiệm thu (Gate 1)

**`CRM_GATE1_FRONTEND_MOCK: ACCEPTED`** — chủ dự án nghiệm thu ngày 2026-11-02 theo `CRM_GATE1_FINAL_ACCEPTANCE_REPORT.md` (unit 29/29, E2E 29/29). Phạm vi: Frontend Mock; không gồm Backend thật, IAM, Audit Foundation, lưu file. Các dòng DIFFERENCE trong `09_UIUX_COMPARISON_MATRIX.md` giữ nguyên, không chuyển thành MATCH.

Bằng chứng chạy thật (bản cuối): `TALO-MOS-V4_exports/CRM_GATE1_FINAL_20261101/evidence/`; bản remediation: `CRM_GATE1_REMEDIATION_20261101/evidence/`; bản trước: `CRM_GATE1_ALIGNMENT_20261030/evidence/` (`build_test.txt`, `e2e_log.txt`, `e2e/e2e-result.json`, `e2e/*.png`).
Kết quả: **DEMO_PASS** = chạy trên Mock có assertion; **NOT_TESTED**; **BLOCKED**; **N/A_GATE1**. Không mục nào là LIVE PASS (không có Backend/IAM thật).

## 1. Bộ kiểm tra kỹ thuật

| Kiểm tra | Lệnh (từ thư mục gốc repo) | Kết quả |
|---|---|---|
| Manifest | `validateManifest()` của `backend/scripts/modules-sync.mjs` với `modules/CRM/module.json`, folder `CRM` | `[]` (hợp lệ) |
| Typecheck strict | `node frontend/node_modules/typescript/bin/tsc -p modules/CRM/tsconfig.json` | exit 0 |
| Unit (vitest) | `node backend/node_modules/vitest/vitest.mjs run --root modules/CRM` | 29/29 pass |
| Build | `node frontend/node_modules/vite/bin/vite.js build --config modules/CRM/dev/vite.config.mjs` | exit 0 |
| E2E trình duyệt | preview `:5182` + `node modules/CRM/dev/e2e.mjs http://127.0.0.1:5182 <outDir>` | 29/29 bước pass, 0 lỗi console |
| Mutation check | tắt `TARGET_DESIGN_TRANSFER_TODOS` và quy tắc che → chạy unit | 2 test đỏ như kỳ vọng (sau đó khôi phục) |

E2E không dùng `.catch(() => undefined)` hay cách bỏ qua lỗi điều hướng; mỗi bước có assertion (`waitFor`, so sánh danh sách, kiểm tra phần tử không bị che bằng `elementFromPoint`, không tràn ngang). Khi một bước lỗi, lỗi được ghi nhận rồi tải lại `/crm` để bước sau độc lập.

## 2. Unit test (29)

| # | Test | Rule / TC |
|---|---|---|
| U1 | normalises VN tax id, personal id, foreign registration | BR-06, TC-08 |
| U2 | CSV formula injection guard | BR-18, TC-49 |
| U3 | DRAFT without tax id, visible to creator | D01-a, TC-01 |
| U4 | malformed / duplicate identifier | BR-06, TC-06, TC-08 |
| U5 | ward outside province | BR-08, TC-09 |
| U6 | verify needs full legal data → VERIFIED | BR-05, TC-03, TC-04 |
| U7 | sale without READ_ALL sees only assigned; 404 non-disclosure | BR-01, TC-13 |
| U8 | export needs permission | BR-18, TC-17 |
| U9 | one PRIMARY, many SUPPORT, no duplicate | BR-09, TC-25, TC-26 |
| U10 | handover flow B; only OPEN activities of old sale move | BR-10/11, TC-28, 30, 31 |
| U11 | flow A; override only when current sale inactive | BR-10, D05 (đề xuất), TC-27 |
| U12 | second open handover refused | BR-10, TC-32 (rule level) |
| U13 | legal change management → accounting; unchanged before accounting | BR-03, TC-21, 22, 23 |
| U14 | no self approval; DRAFT not eligible; one pending | BR-03, TC-24 |
| U15 | appointments: end > start, in profile, reminder, cancel reason, **contact must belong to customer** | WF-11 |
| U16 | tasks: overdue, progress → IN_PROGRESS, DONE final | WF-12 |
| U17 | reports: draft → submit, read-only, visibility | WF-13 |
| U18 | composite create all-or-nothing (rollback on bad contact) | GAP-API-01 |
| U19 | composite create checks each permission | BR-01/02 |
| U20 | region / macro / sale-role filters, sort desc | BR-17, FE-FIX-04 |
| U21 | viewer: scope + masking + read-only (update/create bị từ chối) | BR-01, OD-05, TC-15, TC-16 |
| U22 | FE-FIX-02 handover To-do transfer (Target Design) | OD-07 |
| U23 | task reassign history; reports in bundle & by customer; drafts private | WF-12/13 |
| U24 | reset() drops every mock change, restores the seed, keeps persona | UI-18 |
| U25 | không có quyền xem định danh đầy đủ → định danh không phải trường tìm kiếm (toàn phần, một phần); mã vẫn tìm được | BR-17/19, OD-05, closeout I.1 |
| U26 | có quyền → tìm theo định danh được nhưng chỉ trong phạm vi (Sale C không thấy KH 000001) | BR-01/17 |
| U27 | cảnh báo trùng tên chỉ đếm khách trong phạm vi; kiểm trùng định danh chỉ trả có/không | BR-06 |
| U28 | Audit demo: actor + mã hành động + đối tượng đúng loại, không PII, giao dịch rollback không để lại dòng, xóa khi reset | BR-12/19 (mock) |
| U29 | Audit mã OVERRIDE; bàn giao đã kết thúc hiện cho người tham gia / trong phạm vi, không hiện cho người ngoài | BR-01/10 |

## 3. E2E (29 bước)

| Bước | Nội dung | Ảnh |
|---|---|---|
| 01 | Tổng quan: KPI, lịch, việc, chờ xử lý, cảnh báo tài liệu, nhãn DEMO, đổi kỳ | 01-workspace-sale-a |
| 02 | Sidebar đúng 5 màn hình; AppShell 4 khối; logo | — |
| 03 | KPI quá hạn → màn Công việc lọc quá hạn | — |
| 04 | Danh sách: 12 cột đúng thứ tự, tìm, lọc Miền, sắp xếp giảm, 10 dòng/trang | 04-customers-list |
| 05 | Bấm tên → xem nhanh → mở hồ sơ | 05-quickview |
| 06 | Hồ sơ 1/3 + đúng 6 tab | 06-customer-profile |
| 07 | Lịch tạo trong hồ sơ (có người liên hệ) → màn Lịch → "Mở lịch hẹn trong hồ sơ" đúng tab | 07-calendar-week-detail |
| 08 | Lịch tạo ở màn Lịch (gắn KH) → tab hồ sơ; giờ sai bị chặn; hủy bắt buộc lý do | — |
| 09 | Công việc: tạo, hoàn thành, lọc DONE | 09-tasks |
| 10 | Báo cáo: viết, nộp, lọc theo KH, hiện trong lịch sử KH | 10-reports-filtered |
| 11 | Tạo KH (Sale): 4 nhóm, định danh sai/trùng + "Mở hồ sơ đã có", xác nhận đổi nước ngoài, FE-G01, Lưu Draft, liên hệ lưu kèm | 11-create-form-sale |
| 12 | Tạo KH (Quản lý): Sale chính/hỗ trợ, nhóm, Lưu và xác minh → VERIFIED | 12-create-form-manager |
| 13 | Xác minh DRAFT có sẵn | — |
| 14 | FE-FIX-02 bàn giao luồng B + To-do chuyển (Target Design); bấm mục ở Tổng quan → xử lý trong màn **Khách hàng**; Sale cũ mất phạm vi (deep link 404) | 14-handover-todo-transferred |
| 15 | Bàn giao luồng A, xác nhận thay khi Sale nghỉ (nhãn D05 đề xuất); không có override khi Sale còn làm; Sale nhận mở hàng đợi "Chờ xử lý (n)" từ thanh công cụ Khách hàng | 15-handover-flow-a |
| 16 | Pháp lý 2 cấp; Sale không thấy nút duyệt; tên pháp lý không đổi trước kế toán; lịch sử "Đã áp dụng" | 16-legal-applied |
| 17 | Phạm vi Sale A: tìm & deep link ngoài phạm vi → không lộ; tìm theo định danh: KH của mình thấy, định danh của KH 000008 (ngoài phạm vi) → không thấy; không có Xuất CSV | — |
| 18 | Persona chỉ xem: 2 KH, định danh che, không có nút tạo/sửa/xuất; tìm theo định danh toàn phần / một phần → không có kết quả, theo mã → có | 18-viewer-search-masked, 18-viewer-profile |
| 19 | Tài liệu: phiên bản, nhãn BLOCKED + D06, không có nút tải giả | 19-documents |
| 13b | Xem nhanh → Ẩn hồ sơ (Quản lý): xác nhận, hồ sơ biến khỏi danh sách, hiện lại khi bật "Gồm hồ sơ đã ẩn" (bước 05: Sale không thấy nút Ẩn) | — |
| 15b | Bàn giao đã kết thúc: tab trong hàng đợi Khách hàng, diễn biến từng bước (xác nhận thay + lý do), việc / To-do đã chuyển | 15b-handover-finished |
| 16b | Audit demo: có các mã hành động của bước 11–16, người thực hiện mới nhất là Kế toán, không có định danh / tên pháp lý | 16b-audit-demo |
| 19b | "Lập báo cáo" từ To-do (nộp) và từ lịch hẹn (nháp): form mở sẵn liên kết đã chọn | 19b-report-from-origin |
| 21 | **UI-02**: thu gọn (rộng >200 → <80 px, nhãn ẩn, chữ tắt hiện), giữ ô tìm + bộ lọc + danh sách, không chồng lấn / tràn ngang, nút không bị che, điều hướng khi thu gọn, mở rộng lại | 21-ui02-compact, 21-ui02-expanded |
| 22 | **UI-18**: hủy xác nhận → dữ liệu giữ nguyên; đồng ý → To-do mới biến mất trên màn đang mở (không tải lại trang), localStorage không còn dữ liệu E2E, pháp lý 000002 và KH tạo ở bước 11–12 về seed | 22-ui18-after-reset |
| 20-390 / 768 / 1024 / 1440 | Điều hướng 5 màn (≤760: qua Menu drawer), không tràn ngang, nút không bị che, popup tạo KH dùng được, 6 tab hồ sơ, drawer đóng bằng overlay, nút Trang chủ | 20-<w>-customers / -create-form / -profile / -calendar / 390-drawer-open |

## 4. Checklist UI-01..UI-20 (Fullstack REV01 `06_QUALITY/02_FRONTEND_ACCEPTANCE.md`)

| ID | Kết quả | Bằng chứng / ghi chú |
|---|---|---|
| UI-01 | DEMO_PASS | E2E 02 + ảnh (dùng `app-shell.css` của Host) |
| UI-02 | DEMO_PASS | E2E 21 (harness tái hiện class compact của Host; flyout nhóm menu thuộc Host, CRM không có menu con) |
| UI-03 | DEMO_PASS | E2E 02 |
| UI-04 | DEMO_PASS | E2E 04, U20 (scope trước count, mặc định 20) |
| UI-05 | DEMO_PASS | E2E 05, 18 (che định danh theo OD-05) |
| UI-06 | DEMO_PASS | E2E 11–13, U3, U6 |
| UI-07 | DEMO_PASS | E2E 11 (xác nhận đổi địa chỉ), 12 (xã theo tỉnh), U5 |
| UI-08 | DEMO_PASS | E2E 11, U4 |
| UI-09 | DEMO_PASS (unit) | U18 (liên hệ thiếu điện thoại/Zalo bị chặn); E2E 11 liên hệ không chức vụ lưu được |
| UI-10 | DEMO_PASS | U9, E2E 12 |
| UI-11 | DEMO_PASS | E2E 16, U13 |
| UI-12 | DEMO_PASS | E2E 14, 15, U10, U11 |
| UI-13 | DEMO_PASS | U10, U22 |
| UI-14 | BLOCKED (file) / DEMO_PASS (metadata, phiên bản hiển thị) | E2E 19 |
| UI-15 | BLOCKED | Không có tải xuống (storage chưa duyệt); không lộ storage_path |
| UI-16 | DEMO_PASS | U2, U8, E2E 17 |
| UI-17 | DEMO_PASS | E2E 14 (Sale cũ), 17, 18 |
| UI-18 | DEMO_PASS | E2E 22 (xử lý hộp xác nhận thật: hủy rồi đồng ý), U24 |
| UI-19 | DEMO_PASS | E2E 20-390/768/1024/1440 |
| UI-20 | DEMO_PASS | E2E 14, 17 (deep link → thông báo không tiết lộ) |

## 5. 50 TC Backend (`01_BACKEND_TEST_CASES_50.csv`) — trạng thái trên Mock

DEMO_PASS (rule level, unit/E2E): TC-01, 03, 04, 06, 08, 09, 11, 12, 13, 14, 15, 16, 17, 18, 19 (UI không cho sửa trực tiếp), 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 34, 40, 41, 47 (mã lỗi chuẩn), 48, 49.
NOT_TESTED: TC-05 (đồng thời), TC-07 (cảnh báo trùng tên — có UI, chưa có assertion riêng), TC-10 (nước ngoài — có validate, chưa có test riêng), TC-20 (thiếu chứng từ — UI bắt buộc chọn, chưa có test riêng), TC-32/33 (giao dịch đồng thời / lỗi giữa chừng — chỉ mức quy tắc), TC-18 (xuất theo phạm vi — persona có quyền export đều có READ_ALL), TC-35 (Audit), TC-45, TC-50.
BLOCKED / N/A_GATE1: TC-02 (chưa có module Đơn hàng), TC-36, 43, 44, 46 (cần runtime tích hợp), TC-37, 38, 39, 42 (storage file).

## 6. Không kiểm tra trong Gate 1
- Chạy CRM bên trong Host thật (`modules:sync`, deployment) — cấm đăng ký module lên TEST.
- Backend, IAM, MIC thật; DB thật (không có lệnh ghi).
- So sánh pixel với UI/UX Handoff 29/10 và Web Demo REV02 — không có file nguồn (OD-01).
- Trình duyệt khác Chromium; trình đọc màn hình.
