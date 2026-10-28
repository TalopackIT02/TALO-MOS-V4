# SCC 0.1.2 RUNTIME ACCEPTANCE — KẾT QUẢ

> **CẬP NHẬT 28/10/2026 (bộ bằng chứng COMPLETE): xem §9.** Kết quả hiện hành:
> - **PASS:** Data Inspection 10/10, Audit Logs 6/6, System Health, Test Results.
> - **PARTIAL:** Foundation & Module (thiếu panel Function/Action), Access Matrix (thấy 11/34 dòng, chưa có TXT).
>
> Các mục §1–§8 dưới đây giữ nguyên làm lịch sử của lượt nghiệm thu đầu.

```
GATE:      SCC 0.1.2 RUNTIME ACCEPTANCE
STATUS:    PARTIAL — Data Inspection PASS (1 tiêu chí phụ thiếu ảnh); Audit Logs PARTIAL (thiếu ảnh drawer chi tiết);
           System Health PASS; Test Results / Foundation & Module / Access Matrix NOT_TESTED (chưa có ảnh)
TARGET:    TEST talo_mos_v4_test; SCC 0.1.2 76003a14… ACTIVE / ENABLED; journal 0c0e9fcb… INSTALLED_ACTIVE
APPROVAL:  "SCC 0.1.2 RUNTIME ACCEPTANCE APPROVAL" + "SCC 0.1.2 UI ACCEPTANCE CONTINUATION", 28/10/2026
EVIDENCE:  D:\Documents\ClaudeProject\TALO-MOS-V4_exports\SCC_UI_EVIDENCE_012_20261028-151643\
           (15 ảnh + 1 TXT do chủ dự án chụp; _claude\ = log, đối chiếu DB, timeline request)
```

Claude Code chỉ đọc ảnh và file TXT, log backend và DB (READ ONLY). Không đổi DB, source, lifecycle, IAM; không restart; không commit.

Trong khoảng chủ dự án chụp (15:16–15:58 giờ máy), log backend ghi **0 error, 0 phản hồi 5xx, 0 `42501`, 0 restart**. Đăng nhập dùng phiên có sẵn (0 lần login mới).

## 1. Kết quả từng màn hình

| # | Màn hình | Kết luận | Căn cứ |
|---|---|---|---|
| 1 | Sức khỏe hệ thống | **PASS** | Ảnh H1 + TXT + log `POST /checks/run` 200 (§2.3) |
| 2 | Kết quả kiểm thử | **NOT_TESTED** | Không có ảnh; log không có request `/results` trong lần chụp |
| 3 | **Dữ liệu hệ thống (Data Inspection)** | **PASS** (9/10 tiêu chí); tiêu chí "`fnd_audit_logs` hướng sang Nhật ký" **NOT_TESTED** | D1–D10 + log + DB (§2.1) |
| 4 | Foundation & Module | **NOT_TESTED** | Log có `GET /architecture/modules` 200 lúc 15:41:38, nhưng không có ảnh |
| 5 | Ma trận phân quyền | **NOT_TESTED** | Không có ảnh; không có request `/access/*` |
| 6 | **Nhật ký hệ thống (Audit Logs)** | **PARTIAL** (5/6 tiêu chí PASS) | A1–A4 khớp DB từng dòng; còn thiếu ảnh drawer chi tiết (§2.2) |

## 2. Đối chiếu chi tiết

### 2.1 Data Inspection

| Tiêu chí | Ảnh | Giao diện | API (log) | PostgreSQL (READ ONLY) | Kết quả |
|---|---|---|---|---|---|
| Ẩn bảng hệ thống mặc định | D1 | "25 / 93 bảng", ô "Hiện bảng hệ thống PostgreSQL (68)" chưa tick | `GET /data/tables` 200 | 25 bảng nghiệp vụ + 68 catalog | PASS |
| Hiện lại bảng hệ thống | D2 | Tick ô → "93 / 93 bảng" | (lọc ở client) | 93 | PASS |
| `fnd_module_events` đọc dữ liệu B07 | D3 | Nhãn **"Đọc có kiểm soát"**, ghi chú hàm `foundation_read_api.read_module_events`, "Không đọc: before_state / after_state (JSON thô)". Dòng 1 `ee73145f…` ACTIVATE 0.1.2 08:11:31.131799Z; tiếp theo RETIRE 0.1.1, APPROVE, SUBMIT 0.1.2, ENABLE 06:43:42… | `columns` + `rows` 200 (15:45:30) | Sự kiện mới nhất `ee73145f…` ACTIVATE (khớp) | PASS |
| Phân trang B07 | D4 | "Trang 2 · dòng 51–100 · sắp xếp theo occurred_at DESC, event_id DESC"; dòng 51 `c0feafeb…` ACTIVATE 2026-10-24T05:01:21.151649Z | `rows` 200 (15:45:44) | Vị trí 50: `c0feafeb…` ACTIVATE 05:01:21.151649Z (khớp) | PASS |
| `fnd_data_access_rules` | D5 | "Đọc có kiểm soát", hàm `read_data_access_rules`; dòng 1 `00113249…` FBET_MVFMMMLV… ORDERS SELECT | 200 (15:46:17) | `min(access_rule_id)` = `00113249…`; tổng 3937 | PASS |
| `iam_memberships`: chỉ cột đã duyệt | D6 | Dữ liệu: `membership_id`, `employee_code` (SYS-ADMIN), `full_name` (System Administrator), `membership_status` (ACTIVE), `joined_at` 2026-10-17, `left_at` NULL, `created_at` …; "Không đọc: employee_id" | 200 (15:46:25) | 1 dòng: SYS-ADMIN / System Administrator / ACTIVE / 2026-10-17 (khớp) | PASS |
| `iam_sessions`: không token / hash | D7 | Dữ liệu: `session_id`, `username`, `user_account_id`, `session_state` (ACTIVE / EXPIRED / REVOKED), `assurance_level`, `created_at` … **Không có cột token**; "Không đọc: session_token_hash" | 200 (15:46:37) | 42 phiên (2 active, 31 revoked); 2 dòng đầu `f42d3d1d…`, `9184fccb…` (khớp) | PASS |
| Nhãn "Đọc có kiểm soát" cho 4 bảng | D1, D3, D5–D7 | Hiển thị đúng ở `fnd_data_access_rules`, `fnd_module_events`, `iam_memberships`, `iam_sessions` | — | — | PASS |
| `iam_credentials` được bảo vệ | D8 | Nhãn **"Được bảo vệ"**; chỉ cấu trúc; "Bảng chứa dữ liệu xác thực / tài khoản được bảo vệ: chỉ hiển thị cấu trúc…" | Chỉ `columns` 200; **không có request `rows`** | — | PASS |
| `fnd_audit_logs` hướng sang Nhật ký | D9 | Ảnh là **`iam.iam_audit_logs`** (không phải `fnd_audit_logs`), hiển thị "Dữ liệu audit không xem dạng bảng thô: mở màn hình Nhật ký hệ thống (đọc qua audit_api…)" | `columns` 200 của `iam.iam_audit_logs`; `fnd_audit_logs` **không được mở** | — | `iam_audit_logs`: PASS; **`fnd_audit_logs`: NOT_TESTED** (cùng nhánh code, nhưng chưa có ảnh) |
| `fnd_modules` đọc trực tiếp | D10 | Nhãn "Đọc trực tiếp", "Đọc được"; dòng 1 `004c5380…` FBET_MVJQWWJ4_234E83_4 | `columns` + `rows` 200 (15:47:29) | `min(module_id)` = `004c5380…` (khớp) | PASS |

**Cấu trúc khác với dữ liệu.** Bảng "Cấu trúc" (metadata từ `pg_catalog`) liệt kê **tên cột** của cả bảng, kể cả `employee_id` (D6), `session_token_hash` (D7), `password_hash` (D8). Đây chỉ là tên và kiểu dữ liệu, **không có giá trị**. Bảng "Dữ liệu" chỉ chứa các cột đã duyệt (§4).

### 2.2 Audit Logs

| Tiêu chí | Ảnh | Giao diện | PostgreSQL (READ ONLY, cùng cửa sổ thời gian) | Kết quả |
|---|---|---|---|---|
| FOUNDATION và IAM AVAILABLE | A1, A2 | Chip "FOUNDATION AVAILABLE", "IAM AVAILABLE" | — | PASS |
| Lọc kết quả "Lỗi và từ chối", 24 giờ | A1 | 1 bản ghi: IAM LOGIN FAILURE 00:31:01 28/10, "System / Unknown" | ISSUES: Foundation 0 + IAM 1 = LOGIN FAILURE 00:31:01 (khớp) | PASS |
| Sự kiện kích hoạt 0.1.2 ngày 28/10 + lọc action code | A2 | Action `MODULE_VERSION.ACTIV…`: 2 bản ghi: 15:11:31 (0.1.2) và 13:43:42 (0.1.1), FOUNDATION, admin, SUCCESS | 2 bản ghi `MODULE_VERSION.ACTIVATE` 15:11:31 và 13:43:42 (khớp) | PASS |
| Lọc nguồn IAM | A3 | "FOUNDATION NOT_REQUESTED", "IAM AVAILABLE"; 6 bản ghi | IAM 24 giờ = 6: LOGIN 13:42:49, 13:34:52, 00:31:10, FAILURE 00:31:01, 22:51:03, 19:39:37 (khớp đúng thứ tự) | PASS |
| Phân trang + khoảng 7 ngày | A4 | IAM, 7 ngày, "Trang 2 · 20 bản ghi": 14:08:37 PERMISSION.CREATE ×2, 11:41:24 LOGIN, 10:55:07, 10:55:04 SESSION_INVALIDATED DENIED, … | 45 bản ghi / 7 ngày; trang 25 dòng → trang 2 có 20 dòng; vị trí 25–34 **khớp 10/10 dòng** hiển thị | PASS |
| Không còn `42501` | log | 16 lần gọi `audit/logs` đều 200 | log: 0 `42501`, 0 "audit source unavailable" | PASS |
| **Xem chi tiết sự kiện (drawer)** | A2 | Ảnh A2 là danh sách đã lọc, **không phải drawer chi tiết** | Drawer mở ở phía client, không sinh request nên log không chứng minh được | **NOT_TESTED** |

### 2.3 System Health

| Mục | Giá trị |
|---|---|
| Ảnh H1 | "System health monitor", lần chạy 15:50:14 28/10/2026, 3915 ms; 22 checks; CRITICAL 1 / WARNING 4 / NORMAL 17; run `0653dc5f…` |
| TXT H1 | PASS 17 · FAIL 1 · WARN 2 · NOT_TESTED 2 (ảnh gộp WARN + NOT_TESTED thành "WARNING 4"). Ảnh và TXT **khớp** |
| PASS nổi bật | AUTHENTICATION, SESSION, IAM (DIAGNOSTICS / TEST_RUNNER ALLOW), POSTGRESQL (`talo_app`, READ ONLY), REGISTRY, **VERSION_MIC "0.1.2 ACTIVE; mã băm khớp manifest_hash"**, FUNCTION_ACTION 7/7, **DATA_CONTRACTS gồm 4 resource mới 0.1.2**, COMPATIBILITY, LIFECYCLE, NAVIGATION, MODULE_API, DB_CONNECTIONS 3/100, DB_DEADLOCKS 0, DB_ROLLBACKS 0,1 %, AUDIT_DENIED, AUDIT_FAILURE |
| FAIL `FLEET_LIFECYCLE` | Liệt kê 2 module `FBET_INST_*` ENABLED không có ACTIVE. **Dữ liệu TEST tồn đọng**: DB thực có **41** fixture `FBET_*` như vậy; phép kiểm chỉ thấy 2 vì danh sách giới hạn 200 module. Không phải lỗi SCC; xử lý ở gate dọn fixture riêng |
| WARN | `FLEET_DISCOVERY` (registry 200+, đạt giới hạn 200), `FLEET_RELEASES` (234 version; 20 module chưa có version) |
| NOT_TESTED | `DEPLOYMENT_SYNC` (Host chưa có capability), `REGRESSION` (chưa có artifact runner) |
| Log | `GET /health` 200, `POST /checks/run` 200 (15:50:14); 1 warn "system-controller critical check" (= FLEET_LIFECYCLE) |

## 3. Bằng chứng đã xác minh

| File | Nội dung xác minh | Dùng được |
|---|---|---|
| D1, D2 | Danh sách 25/93, 93/93 | Có |
| D3, D4 | B07 trang 1 và 2 | Có |
| D5 | Quy tắc truy cập dữ liệu | Có |
| D6, D7 | Memberships, Sessions | Có |
| D8 | Credentials được bảo vệ | Có |
| D9 | **`iam_audit_logs`** (tên file ghi `fnd_audit_logs`) | Có, nhưng cho `iam_audit_logs` |
| D10 | `fnd_modules` | Có |
| A1, A3, A4 | Lọc ISSUES / nguồn IAM / 7 ngày + trang 2 | Có |
| A2 | Lọc action `MODULE_VERSION.ACTIVATE` (không phải drawer) | Có, cho bộ lọc action |
| H1 (png + txt) | System Health | Có |
| `_claude\` | `db-crosscheck.txt`, `scc-requests-resolved.txt` (timeline 45 request SCC), `backend-log-capture.txt`, `precheck.txt`, `db-reference-before.txt` | — |

## 4. Dữ liệu nhạy cảm

| Kiểm tra | Kết quả |
|---|---|
| Ảnh D6 / D7 / D8: phần **Dữ liệu** | Không có `employee_id`, token, hash. Credentials không có phần dữ liệu |
| Log | Không có request `rows` nào tới bảng PROTECTED (`iam_credentials`, `iam_audit_logs`, …) |
| Quét rò rỉ trên TEST (Installer Gate 0.1.2, cùng runtime) | 314 request / 7,09 MB: 0 lần xuất hiện của 42 `session_token_hash`, `password_hash`, `employee_id`; 0 mẫu hash mật khẩu / JWT / cookie → `NO_LEAK_DETECTED` (có đối chứng dương 42/42) |
| Cấu trúc (metadata) | Có tên cột `session_token_hash` / `password_hash` / `employee_id`, không có giá trị. Đây là thiết kế: chỉ tên cột từ catalog |

**Kết luận: không lộ dữ liệu nhạy cảm.**

## 5. Lỗi thực tế và hạn chế

| # | Mức | Mô tả | Đề xuất |
|---|---|---|---|
| U-1 | Thấp (hiển thị) | Banner ghi cứng **"SYSTEM_CONTROLLER_CENTER · V0.1.0"** (`frontend/DiagnosticsTab.tsx:55`) và **"TEST EXECUTION · V0.1.0"** (`RunnerTab.tsx:31`), trong khi runtime là 0.1.2 (VERSION_MIC xác nhận 0.1.2 ACTIVE). Có từ 0.1.0 | Lấy version từ manifest hoặc API ở bản sửa sau |
| U-2 | Thấp (nội dung) | Dòng mô tả đầu Data Inspection vẫn là văn bản 0.1.1 ("dữ liệu tài khoản bị chặn ở Backend; bảng khác hiển thị nguyên giá trị…"), chưa nhắc "Đọc có kiểm soát" / "Được bảo vệ" | Cập nhật văn bản ở bản sửa sau |
| D-1 | Dữ liệu TEST | 41 fixture `FBET_*` ENABLED không có ACTIVE → `FLEET_LIFECYCLE` FAIL | Gate dọn fixture riêng (đã thống nhất) |
| L-1 | Hạn chế thiết kế | Danh mục fleet giới hạn 200 module (`FLEET_DISCOVERY` WARN), nên chỉ liệt kê 2 / 41 fixture | Chấp nhận hoặc phân trang ở bản sau |
| L-2 | Hạn chế thiết kế | `fnd_audit_logs` / `iam_audit_logs` không xem dạng bảng thô, chỉ qua Audit Logs (trường đã chuẩn hóa, không trả metadata tự do) | Chủ đích bảo mật |
| L-3 | Hạn chế thiết kế | B07 qua Data Inspection: cửa sổ 366 ngày, offset ≤ 100000 | Đủ cho TEST hiện tại (6750 sự kiện) |
| L-4 | Hạn chế thiết kế | Tab "Cấu trúc" hiển thị tên mọi cột, kể cả cột bí mật (không có giá trị) | Chấp nhận (metadata) hoặc ẩn tên ở bản sau nếu muốn |

## 6. Bằng chứng còn thiếu (danh sách bổ sung ngắn)

| # | Thao tác | File |
|---|---|---|
| 1 | Nhật ký hệ thống → bấm vào **một dòng** để mở panel "Chi tiết sự kiện audit" | `A2b-drawer.png` |
| 2 | Dữ liệu hệ thống → chọn **`foundation.fnd_audit_logs`** | `D9b-fnd_audit_logs.png` |
| 3 | Kết quả kiểm thử → ảnh + "↓ Xuất báo cáo TXT đầy đủ" | `T1-tests.png` + TXT |
| 4 | Foundation & Module → danh sách → bấm SCC xem Function/Action | `F1-modules.png`, `F2-scc-functions.png` |
| 5 | Ma trận phân quyền → chọn Administrator → Xuất | `M1-matrix.png` + TXT |

## 7. Chức năng đã hoàn thành (có bằng chứng giao diện + dữ liệu)

- Data Inspection:
  - phân loại bảng nghiệp vụ và hệ thống (25/93 ↔ 93/93);
  - nhãn Đọc trực tiếp / Đọc có kiểm soát / Được bảo vệ / Không có quyền SELECT;
  - đọc dữ liệu thật **B07** (có phân trang), **quy tắc truy cập dữ liệu**, **thành viên IAM**, **metadata phiên IAM**, **`fnd_modules`**;
  - bảo vệ dữ liệu xác thực;
  - hướng dẫn sang Audit Logs cho bảng audit IAM.
- Audit Logs:
  - đọc Foundation + IAM qua `audit_api`;
  - lọc theo kết quả, nguồn, action code, khoảng thời gian;
  - phân trang;
  - sự kiện kích hoạt 0.1.2 ngày 28/10/2026;
  - **không còn `42501`**.
- System Health: 22 phép kiểm với dữ liệu thật, xuất TXT.
- Không lộ dữ liệu nhạy cảm.

## 8. Kết luận

**SCC 0.1.2 RUNTIME ACCEPTANCE: PARTIAL.**

- **Mục tiêu ưu tiên đã đạt:** Administrator **xem được dữ liệu PostgreSQL thực tế** qua giao diện.
  - Data Inspection: B07, quy tắc truy cập dữ liệu, thành viên, phiên, `fnd_modules`.
  - Audit Logs: Foundation và IAM.
  - Số liệu khớp DB từng dòng, không có `42501`, không lộ dữ liệu nhạy cảm.
- **Chưa thể kết luận PASS toàn bộ**, vì:
  - còn 2 tiêu chí phụ chưa có ảnh: drawer chi tiết của Audit Logs và màn hình `fnd_audit_logs`;
  - 3 màn hình chưa có ảnh: Kết quả kiểm thử, Foundation & Module, Ma trận phân quyền.

  Ở mức API và dữ liệu, cả 3 màn hình này đã PASS (09, 13), nhưng theo nguyên tắc gate thì chưa đánh PASS giao diện.
- Lỗi phát hiện chỉ ở mức thấp (U-1, U-2), không chặn sử dụng.

Dừng tại đây để chủ dự án quyết định:
1. bổ sung 5 mục ở §6 rồi đóng phạm vi SCC; hoặc
2. mở gate sửa U-1 / U-2 (bản vá giao diện); và / hoặc
3. gate dọn fixture FBET (D-1).

## 9. Cập nhật — bộ bằng chứng COMPLETE (28/10/2026, 16:12)

### 9.1 Kiểm kê

- 21 ảnh PNG, 3 TXT (H1, T1, F1), README, `SHA256SUMS.txt`.
- `sha256sum -c` khớp **25/25** (2 dòng chú thích không phải checksum).
- **16 file đã kiểm chứng ở §1–§8 không thay đổi** (so với `_claude/evidence-sha256.txt`).
- 6 ảnh bổ sung: A2b, D9b, T1, F1, F2, M1.

### 9.2 Đối chiếu bổ sung (log backend 15:58–16:12, DB READ ONLY)

| Bằng chứng | Nội dung | API (log) | PostgreSQL | Kết quả |
|---|---|---|---|---|
| A2b-drawer | Panel **"Chi tiết sự kiện audit"**: 00:31:01 28/10, IAM, FAILURE, LOGIN, USER_ACCOUNT, Target `0e7b0190…`, Reason (đã lọc) BAD_PASSWORD, Event ID `45a96b64…`; ghi chú "không tải raw metadata hoặc mật khẩu/token" | `audit/logs` 200 | `iam_audit_logs` `45a96b64…` LOGIN FAILURE, target `0e7b0190…`, reason BAD_PASSWORD (khớp) | **PASS** |
| D9b | **`foundation.fnd_audit_logs`**: nhãn "Không có quyền SELECT", 15 cột (chỉ cấu trúc); "Dữ liệu audit không xem dạng bảng thô: mở màn hình Nhật ký hệ thống…" | `columns` 200; không gọi `rows` | `talo_app` không có SELECT (đúng thiết kế) | **PASS** |
| T1 + TXT | Quick tests 16:02:56; 17 PASS / 1 FAIL / 2 WARN / 0 UNAVAILABLE / 2 NOT_TESTED; FULL REGRESSION NOT_RUN | `/results` 200 ×4, `/checks/run` 200 ×2 | TXT run `e7944894…` 09:02:53Z, cùng số liệu | **PASS** |
| F1 + TXT | Danh sách Module & phiên bản (DATA_INSPECTOR 0.1.0 ACTIVE DISABLED, FBET…); TXT "Full pagination complete: 29 page(s), **2861** row(s)"; SCC 0.1.2 ACTIVE `7c8b0167…`, 0.1.1 RETIRED `2aabf890…`, 0.1.0 RETIRED `8114f05f…` | `architecture/modules` 200 ×59 (xem + xuất 29 trang) | modules LEFT JOIN versions = **2861**; hash MIC khớp B02 | **PASS** (danh sách / version) |
| F2 | Trang 29: SCC 0.1.2 / 0.1.1 / 0.1.0; **chưa mở panel Function/Action** | **0** request `architecture/functions` | 0.1.2 có 7 function-action (DB) | Tiêu chí Function/Action: **NOT_TESTED** |
| M1 | "Quyền của admin": tài khoản admin ACTIVE TALO_SYSTEM_ADMIN, it03 PENDING_MEMBERSHIP; cột Role / **Admin kế thừa** / Direct ALLOW / Direct DENY / Nguồn hiệu lực; **11/34 dòng hiển thị**, tất cả "Admin kế thừa = Có", ALLOW | `access/accounts` 200 ×2, `access/matrix` 200 ×1 (không có lượt xuất) | Tính lại từ DB: 11 dòng hiển thị **khớp** (`data_inspector.*`: role —, admin Có, direct ALLOW Có; `foundation.*`: role Có, admin Có); 34/34 có admin kế thừa | **PARTIAL**: 23/34 dòng (gồm 7 quyền SCC) chưa có ảnh; chưa có TXT |

Toàn bộ cửa sổ chụp (15:16–16:12): 509 dòng log, **0 error, 0 phản hồi 5xx, 0 `42501`, 0 restart, 0 lần đăng nhập mới**.

### 9.3 Kết quả hiện hành sáu màn hình

| # | Màn hình | Kết quả | Thiếu |
|---|---|---|---|
| 1 | Sức khỏe hệ thống | **PASS** | — |
| 2 | Kết quả kiểm thử | **PASS** | — |
| 3 | Dữ liệu hệ thống | **PASS** (10/10) | — |
| 4 | Foundation & Module | **PARTIAL** | Ảnh panel Function/Action của SCC 0.1.2 |
| 5 | Ma trận phân quyền | **PARTIAL** | TXT "Xuất TXT toàn bộ" (hoặc ảnh phần 7 quyền `system_controller_center.*`) |
| 6 | Nhật ký hệ thống | **PASS** (6/6) | — |

### 9.4 Phát hiện bổ sung

- **U-3 (thấp, nội dung file xuất):** đầu file TXT xuất toàn bộ (`exportAll`, ví dụ F1) vẫn có dòng "Read-only; current page only." ngay dưới "Full pagination complete: 29 page(s)". Hai câu mâu thuẫn nhau; dữ liệu đầy đủ (2861 = DB).

Tổng kết cuối: `15_SCC_012_FINAL_ACCEPTANCE_SUMMARY.md`.
