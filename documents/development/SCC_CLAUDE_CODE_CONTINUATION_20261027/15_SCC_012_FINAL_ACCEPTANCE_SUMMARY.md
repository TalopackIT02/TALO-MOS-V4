# SCC 0.1.2 — TỔNG KẾT NGHIỆM THU

```
NGÀY:              28/10/2026
RUNTIME ACCEPTANCE: PARTIAL — 4/6 màn hình PASS; 2 màn hình PARTIAL chỉ vì thiếu 2 bằng chứng giao diện (không có lỗi chức năng)
SCC 0.1.2:         NOT COMPLETED — chờ 2 bằng chứng (§8). Không có blocker chức năng.
TEST:              SCC 0.1.2 76003a14… ACTIVE / ENABLED, journal 0c0e9fcb… INSTALLED_ACTIVE; 0.1.1 / 0.1.0 RETIRED (release giữ nguyên)
EVIDENCE:          D:\Documents\ClaudeProject\TALO-MOS-V4_exports\SCC_UI_EVIDENCE_012_20261028-151643\  (SHA256SUMS 25/25; _claude\ đối chiếu)
CHI TIẾT:          14_SCC_012_RUNTIME_ACCEPTANCE_RESULT.md (§1–§9)
```

## 1. Kết quả sáu màn hình

| # | Màn hình | Giao diện | API (log backend) | PostgreSQL | Kết quả |
|---|---|---|---|---|---|
| 1 | Sức khỏe hệ thống | H1 + TXT: 22 phép kiểm, 17 PASS / 1 FAIL / 2 WARN / 2 NOT_TESTED; VERSION_MIC "0.1.2 ACTIVE" | `/health`, `/checks/run` 200 | FAIL `FLEET_LIFECYCLE` khớp dữ liệu TEST (fixture FBET) | **PASS** |
| 2 | Kết quả kiểm thử | T1 + TXT: quick tests 16:02:56, cùng 22 phép kiểm; Full regression NOT_RUN (Host chưa có runner) | `/results` 200, `/checks/run` 200 | — | **PASS** |
| 3 | Dữ liệu hệ thống | D1–D10, D9b: 25/93 ↔ 93/93; 4 bảng "Đọc có kiểm soát" có dữ liệu thật; `iam_credentials` "Được bảo vệ"; `fnd_audit_logs` / `iam_audit_logs` hướng sang Nhật ký; `fnd_modules` đọc trực tiếp | `columns` / `rows` 200; **không có request `rows` tới bảng bảo vệ** | Từng dòng hiển thị khớp DB (B07 dòng 1 và 51, rule đầu, membership, 42 phiên, module đầu) | **PASS** (10/10) |
| 4 | Foundation & Module | F1 + TXT: 2861 dòng, 29 trang; SCC 0.1.2 ACTIVE / 0.1.1, 0.1.0 RETIRED với đúng MIC hash. F2: chưa mở panel Function/Action | `architecture/modules` 200; **0** request `architecture/functions` | 2861 = DB; 0.1.2 có 7 function-action | **PARTIAL**: thiếu ảnh Function/Action |
| 5 | Ma trận phân quyền | M1: danh sách tài khoản + "Quyền của admin" với cột Admin kế thừa / Direct ALLOW / DENY / Nguồn hiệu lực; thấy 11/34 dòng | `access/accounts`, `access/matrix` 200 | 11 dòng thấy được khớp DB; DB: admin kế thừa 34/34 | **PARTIAL**: chưa thấy 23 dòng (gồm 7 quyền SCC), chưa có TXT |
| 6 | Nhật ký hệ thống | A1–A4, A2b: FOUNDATION / IAM AVAILABLE; ACTIVATE 15:11:31 (0.1.2) và 13:43:42 (0.1.1); lọc kết quả / nguồn / action / thời gian; trang 2; **drawer chi tiết** | `audit/logs` 200 (18 lần) | A1 1/1, A2 2/2, A3 6/6, A4 10/10 dòng, A2b event `45a96b64…`: **khớp toàn bộ** | **PASS** (6/6) |

## 2. Bằng chứng đã xác minh

- **Giao diện:** 21 ảnh và 3 TXT.
  - `SHA256SUMS` 25/25 OK.
  - 16 file của lượt đầu không bị thay đổi.
  - Ảnh cũ thay bằng ảnh đúng: D9 (thực tế là `iam_audit_logs`) → D9b; A2 (chỉ là bộ lọc) → A2b.
- **Log backend 15:16–16:12:** 509 dòng; 0 error, 0 phản hồi 5xx, 0 `42501`, 0 restart; timeline request trong `_claude\scc-requests-*.txt`.
- **DB (READ ONLY):** `_claude\db-crosscheck.txt`, `_claude\matrix-db-recompute.txt`.
- **Trạng thái TEST:** SCC 0.1.2 ACTIVE / bật, journal INSTALLED_ACTIVE, runtime `76003a14…`; lock `b1d9c23d…`; smoke 16/16.

## 3. Kết quả SELECT PostgreSQL (mục tiêu chính)

| Nguồn | Cơ chế | Trên giao diện |
|---|---|---|
| `fnd_module_events` (B07) | `foundation_read_api.read_module_events` (SECURITY DEFINER, `talo_app` chỉ EXECUTE) | Có dữ liệu thật, phân trang, khớp DB |
| `fnd_data_access_rules` | `foundation_read_api.read_data_access_rules` | Có dữ liệu thật, khớp DB |
| `iam_memberships` | Projection backend (không `employee_id`) | Có dữ liệu thật |
| `iam_sessions` | Projection backend (không token / hash) | 42 phiên, có trạng thái |
| `fnd_audit_logs`, `iam_audit_logs` | `audit_api` (DB Gate 0.1.1) qua màn hình Nhật ký | Đầy đủ, có lọc, phân trang, chi tiết; **không còn `42501`** |
| 13 bảng `fnd_*` / `iam_permissions` / `iam_roles` | SELECT sẵn có | Đọc trực tiếp |
| `iam_credentials`, `iam_account_verifications`, `iam_user_*`, `iam_role_permissions` | Bảo vệ theo chính sách | Chỉ cấu trúc (tổng hợp quyền xem ở Ma trận) |

`talo_app` **không** được cấp SELECT trực tiếp trên bảng nào. Các thay đổi quyền đều qua 2 DB Gate đã duyệt.

## 4. IAM và bảo vệ dữ liệu nhạy cảm

- **Administrator Inheritance:** thể hiện trên giao diện M1 ("Admin kế thừa = Có") và khớp DB; Diagnostics IAM ALLOW.
- **Direct DENY thắng, Manager và tài khoản khác bị chặn bằng 403 `ADMIN_ROLE_REQUIRED`, module tắt trả 503:** đã kiểm cô lập (09) với router và Host thật. Không đổi trong 0.1.2.
- **Không lộ dữ liệu nhạy cảm:**
  - Phần dữ liệu trên giao diện không có token, hash hay `employee_id`.
  - Drawer audit ghi rõ không tải metadata thô hay mật khẩu / token.
  - Không có request `rows` tới bảng bảo vệ.
  - Quét rò rỉ trên TEST: 0 / 42 token hash, 0 password hash, 0 `employee_id`, có đối chứng dương.
  - Tab Cấu trúc chỉ hiển thị **tên** cột (metadata).

## 5. Lỗi và hạn chế còn tồn tại

| # | Loại | Mô tả | Blocker? |
|---|---|---|---|
| E-1 | **Thiếu bằng chứng** | Ảnh panel Function/Action của SCC 0.1.2 (Foundation & Module) | **Blocker của nghiệm thu** (không phải lỗi phần mềm) |
| E-2 | **Thiếu bằng chứng** | TXT xuất ma trận quyền admin (hoặc ảnh 7 quyền `system_controller_center.*`) | **Blocker của nghiệm thu** (không phải lỗi phần mềm) |
| U-1 | Lỗi hiển thị | Banner "V0.1.0" ghi cứng ở `DiagnosticsTab.tsx:55`, `RunnerTab.tsx:31` (đang chạy 0.1.2) | Non-blocker |
| U-2 | Lỗi nội dung | Dòng giới thiệu Data Inspection còn văn bản 0.1.1 | Non-blocker |
| U-3 | Lỗi nội dung file xuất | Đầu file TXT xuất toàn bộ ghi "current page only" dù đã xuất đủ các trang | Non-blocker |
| D-1 | Dữ liệu TEST | 41 fixture `FBET_*` ENABLED không có ACTIVE → `FLEET_LIFECYCLE` FAIL | Non-blocker (gate dọn fixture riêng) |
| L-1 | Hạn chế thiết kế | Fleet giới hạn 200 module (WARN); chỉ nêu 2 / 41 fixture | Non-blocker |
| L-2 | Hạn chế thiết kế | Bảng audit chỉ xem qua Nhật ký (trường chuẩn hóa) | Chủ đích bảo mật |
| L-3 | Hạn chế thiết kế | B07 qua Data Inspection: 366 ngày, offset ≤ 100000 | Non-blocker |
| L-4 | Hạn chế thiết kế | Full regression NOT_RUN: Host chưa có runner capability | Non-blocker (ngoài phạm vi 0.1.2) |

**Không có lỗi chức năng nào của SCC 0.1.2.**

## 6. Phân loại

- **Blocker để đóng nghiệm thu:** E-1, E-2 (chỉ là bằng chứng).
- **Non-blocker:** U-1, U-2, U-3 (đề xuất gom vào một bản vá giao diện nếu chủ dự án muốn), D-1, L-1…L-4.

## 7. Kết luận

- **Phạm vi đã duyệt của SCC 0.1.2 hoạt động đầy đủ trên TEST:**
  - đọc có kiểm soát B07 và quy tắc truy cập dữ liệu;
  - thành viên và phiên IAM theo chính sách;
  - phân loại bảng;
  - mã lỗi thống nhất;
  - Audit Logs qua `audit_api`;
  - không lộ dữ liệu.

  Cả 6 màn hình đều có bằng chứng giao diện thật, khớp DB.
- **Runtime Acceptance: PARTIAL** (4 PASS, 2 PARTIAL do thiếu E-1 và E-2).
- **SCC 0.1.2: NOT COMPLETED** cho đến khi có E-1 và E-2. Không ép PASS.

## 8. Việc chủ dự án cần làm (chỉ 2 ảnh / file, không chụp lại phần khác)

1. **Foundation & Module** → kéo tới dòng **SYSTEM_CONTROLLER_CENTER 0.1.2** → bấm **"Chức năng"** → chụp panel Function / Action → `F2b-scc-012-functions.png`.
2. **Ma trận phân quyền** → bấm **"Xem ma trận"** của `admin` → bấm **"Xuất TXT toàn bộ"** → chép file vào thư mục bằng chứng (đặt tên `M1-matrix-export.txt`).

Sau khi có 2 file này, Claude Code đối chiếu với log và DB:
- Function / Action: 7 cặp của 0.1.2.
- Ma trận: 34/34 quyền "Admin kế thừa", trong đó 7 quyền SCC.

Nếu đạt, Claude Code sẽ đề xuất **đóng Runtime Acceptance (PASS)** và chuyển sang **Git Gate** (cần phê duyệt riêng). Việc sửa U-1 … U-3 và dọn D-1 là các gate tùy chọn, không bắt buộc để đóng 0.1.2.
