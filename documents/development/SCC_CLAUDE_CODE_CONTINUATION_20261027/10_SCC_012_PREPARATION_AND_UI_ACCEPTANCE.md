# SCC RUNTIME ACCEPTANCE CONTINUATION — Nghiệm thu giao diện 0.1.1 và chuẩn bị SCC 0.1.2

```
NGÀY:      28/10/2026
YÊU CẦU:   "SCC RUNTIME ACCEPTANCE CONTINUATION" (phần A + phần B)
TRẠNG THÁI:
  A — Nghiệm thu giao diện 0.1.1: CHỜ BẰNG CHỨNG của chủ dự án (thư mục đã tạo, chưa có file)
  B — SCC 0.1.2: ĐÃ CHUẨN BỊ VÀ KIỂM THỬ CÔ LẬP. Chưa áp dụng lên TEST, chưa cài, chưa commit.
TEST:      không thay đổi gì (HEAD 0e491a3, lock aaf14a2c…, ACL không đổi; SCC 0.1.1 vẫn ACTIVE)
NHÁNH:     git worktree D:\Documents\ClaudeProject\TALO-MOS-V4-wt-scc012, nhánh feat/scc-0.1.2-controlled-read
           (tách từ 0e491a3 + baseline 0.1.1 chưa commit; không đổi nhánh của thư mục runtime)
EVIDENCE:  D:\Documents\ClaudeProject\TALO-MOS-V4_exports\SCC_012_ISOLATED_20261028-143303\  (evidence-sha256.txt)
           D:\Documents\ClaudeProject\TALO-MOS-V4_exports\SCC_UI_EVIDENCE_20261028-142841\  (chờ chủ dự án)
```

## PHẦN A — Nghiệm thu giao diện SCC 0.1.1

### A.1 Cách thu bằng chứng (không cần cửa sổ tự động)

Claude Code không có công cụ điều khiển trình duyệt của chủ dự án. Bằng chứng gồm ảnh chụp và file TXT do chính SCC xuất ra, cộng với log backend và DB mà Claude Code đối chiếu.

Thư mục lưu file: `SCC_UI_EVIDENCE_20261028-142841\`.

| # | Màn hình | Thao tác | File |
|---|---|---|---|
| 1 | Sức khỏe hệ thống | Chạy kiểm tra → Xuất TXT | `1-health.png` + TXT |
| 2 | Báo cáo kiểm thử | ↓ Xuất báo cáo TXT đầy đủ | `2-tests.png` + TXT |
| 3 | Dữ liệu hệ thống | Mở `fnd_modules` (bấm "Tiếp ›" 1 lần), `iam_user_accounts`, `fnd_audit_logs` | `3a`, `3b`, `3c` .png |
| 4 | Foundation & Module | Danh sách → Xuất FOUNDATION_VERSIONS → mở SCC | `4a`, `4b` .png + TXT |
| 5 | Ma trận phân quyền | Chọn Administrator → Xuất IAM_GRANT_MATRIX | `5-access.png` + TXT |
| 6 | Nhật ký hệ thống | Trang 1 → mở 1 dòng → lọc ISSUES → "Tiếp →" | `6a`–`6d` .png |

### A.2 Trạng thái hiện tại

**Kết luận phần A: chưa đủ bằng chứng giao diện.**
- Thư mục hiện chưa có file.
- Log backend sau thời điểm đánh dấu chỉ có 2 lần `audit/logs` và 1 lần `columns`, đều trả 200.
- Ở mức API, dữ liệu và IAM, các màn hình đã PASS trong `09_RUNTIME_ACCEPTANCE_RESULT.md`.

| Màn hình | API / dữ liệu (09) | Giao diện | Kết luận hiện tại |
|---|---|---|---|
| Sức khỏe hệ thống | PASS | chưa có bằng chứng | PARTIAL |
| Báo cáo kiểm thử | PASS | chưa có | PARTIAL |
| Data Inspection | PASS (13 bảng nghiệp vụ); hạn chế SELECT → giải ở 0.1.2 | gọi API 200 (log), chưa có ảnh | PARTIAL — **còn hạn chế** |
| Foundation & Module | PASS | gọi API 200 (log), chưa có ảnh | PARTIAL |
| Ma trận phân quyền | PASS (kể cả DENY / Manager trên bản sao) | chưa có | PARTIAL |
| Nhật ký hệ thống | PASS (dữ liệu khớp DB) | gọi API 200 nhiều lần (log), chưa có ảnh | PARTIAL |

Khi có file, Claude Code đối chiếu từng ảnh / TXT với log (requestId, status) và DB (READ ONLY), rồi kết luận PASS / FAIL theo màn hình.

### A.3 Phát hiện thật từ System Health

Phép kiểm `FLEET_LIFECYCLE` trả FAIL, và nguyên nhân là đúng. TEST có **41 module fixture `FBET_*`** (sinh ra từ các bộ test DB ngày 17–24/10) đang ENABLED nhưng không có phiên bản ACTIVE (đã xác minh READ ONLY).
- Không liên quan SCC.
- Đề xuất xử lý bằng một gate dọn fixture riêng (kiểu FMI-CLEAN), dùng Lifecycle DISABLE, không xóa dữ liệu.

## Danh sách bảng Administrator xem được

| Bảng | 0.1.1 (TEST hiện tại) | 0.1.2 (đề xuất, đã thử cô lập) | Cơ chế 0.1.2 |
|---|---|---|---|
| 11 bảng `fnd_*` cấu trúc / version / navigation | Xem được | Xem được | DIRECT (SELECT sẵn có) |
| `iam_permissions`, `iam_roles` | Xem được | Xem được | DIRECT |
| `fnd_audit_logs`, `iam_audit_logs` | Qua Audit Logs | Qua Audit Logs; Data Inspection hướng dẫn sang màn hình này | `audit_api` (0.1.1) |
| **`fnd_module_events` (B07)** | **Không** | **Xem được** | `foundation_read_api.read_module_events` (DB Gate mới) |
| **`fnd_data_access_rules`** | **Không** | **Xem được** | `foundation_read_api.read_data_access_rules` (DB Gate mới) |
| **`iam_memberships`** | **Không** | **Xem được** (trừ `employee_id`) | Projection backend; **không cần đổi DB** |
| **`iam_sessions`** | **Không** | **Xem metadata** (không token / hash) | Projection backend; **không cần đổi DB** |
| `iam_user_accounts`, `iam_user_roles`, `iam_user_permissions`, `iam_role_permissions` | Qua Access Matrix (tổng hợp) | Không đổi | PROTECTED trong Data Inspection |
| `iam_credentials`, `iam_account_verifications` | Không | **Không** (bảo toàn) | PROTECTED |
| 68 bảng `pg_catalog` / `information_schema` | Lẫn trong danh sách | Gắn nhãn `SYSTEM_CATALOG`, **ẩn mặc định** | Phân loại ở server |

## PHẦN B — Phương án SCC 0.1.2

### B.1 Kiểm tra kiến trúc trước khi đề xuất

| Bảng | Owner | Quyền `talo_app` | Hệ quả |
|---|---|---|---|
| `fnd_module_events` | `talo_foundation_owner` | không SELECT | cần cơ chế DB có kiểm soát |
| `fnd_data_access_rules` | `talo_foundation_owner` | không SELECT | cần cơ chế DB có kiểm soát |
| `iam_memberships` | `admin` | **SELECT** | chỉ chặn ở chính sách SCC → giải ở backend |
| `iam_sessions` | `admin` | **SELECT** (+INSERT) | chỉ chặn ở chính sách SCC → giải ở backend |

- `iam_sessions` không có cột IP hay user agent.
- Cột bí mật duy nhất của `iam_sessions` là `session_token_hash`.
- `fnd_module_events.before_state` / `after_state` chỉ chứa các khóa `status`, `is_enabled`, `manifest_hash`, `module_*`, `description`.

### B.2 Database Access (chỉ cho 2 bảng Foundation)

Thiết kế theo mẫu `audit_api` đã duyệt, nhưng **độc lập hoàn toàn** với nó: role riêng, schema riêng, rollback riêng.

- Role `talo_foundation_reader`:
  - NOLOGIN NOINHERIT, không superuser / createrole / createdb / replication / bypassrls, không thành viên;
  - chỉ có `USAGE foundation` và SELECT cấp cột trên đúng 2 bảng đích.
- Schema `foundation_read_api`: không cấp gì cho PUBLIC.
- `read_module_events(from, to, module_id, event_type, limit, offset)`:
  - SECURITY DEFINER, `search_path = pg_catalog`, kiểm `session_user = 'talo_app'`;
  - giới hạn cửa sổ ≤ 366 ngày, `event_type` thuộc danh sách đóng, tối đa 101 dòng, offset ≤ 100000;
  - JSON trạng thái **không ra khỏi DB**, chỉ trả 5 trường đã kiểm định dạng.
- `read_data_access_rules(data_contract_id, enabled, limit, offset)`: cùng các ràng buộc.
- `talo_app` chỉ có **EXECUTE**, không có SELECT trên bảng.
- Các phép join sang `fnd_modules`, `fnd_module_versions`, `fnd_data_contracts`, `username` do backend thực hiện bằng quyền `talo_app` sẵn có. Nhờ vậy role definer không cần thêm quyền nào.

### B.3 Đề xuất chính sách IAM Memberships / Sessions

| | Hiển thị | Không bao giờ hiển thị | Lý do |
|---|---|---|---|
| **Memberships** | `membership_id`, `employee_code`, `full_name`, `membership_status`, `joined_at`, `left_at`, `created_at`, số tài khoản liên kết | `employee_id` | Đủ để quản trị vòng đời thành viên. `employee_id` là định danh liên hệ thống nhân sự, không cần cho quản trị SCC |
| **Sessions** | `session_id`, `username`, `user_account_id`, trạng thái suy ra (ACTIVE / EXPIRED / REVOKED), `assurance_level`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at` | `session_token_hash` (SQL **không bao giờ** nêu tên cột này) | Theo dõi phiên và thu hồi bất thường. `session_id` là khóa nội bộ, không dùng được để chiếm phiên (cookie là token) |
| Credentials / Verifications | — | toàn bộ dữ liệu | Dữ liệu xác thực |

**ĐÃ DUYỆT** ("SCC 0.1.2 POLICY DECISION", 28/10/2026): chấp thuận đúng phương án trên; không trả token / hash / refresh token / cookie / thông tin xác thực; không thêm chức năng kết thúc hay sửa phiên. Câu hỏi ban đầu:
1. Có cho Administrator xem `full_name` và `employee_code` không.
2. Có cho Administrator xem danh sách phiên của **mọi** tài khoản không, hay chỉ số đếm theo trạng thái.

Mặc định đã chuẩn bị là phương án ở bảng trên.

### B.4 Thay đổi mã nguồn (worktree, so với SCC 0.1.1 `e47e0084…`)

Gói SCC 0.1.2: hash **`76003a14c0214718f370b014ac9ad9361fe7bd51d15d95bc731a152631096495`**, PACKAGE_FILES_SHA256 60 mục (cập nhật 28/10 sau quyết định chính sách: chú thích chính sách, test khóa cột, script kiểm kê 06; bản trước `2de88ccb…` không còn hiệu lực).

| File | Thay đổi |
|---|---|
| `backend/data-inspector.controlled.ts` *(mới)* | Danh sách 4 projection (SQL hằng số, tham số bind), `categoryOf()` |
| `backend/data-inspector.service.ts` | Thêm `category` / `access` cho mỗi bảng; route rows → projection có kiểm soát; reader thiếu → `503 CONTROLLED_READ_UNAVAILABLE` (**không** quay về đọc bảng thô); offset quá giới hạn → 400; module tắt → `503 MODULE_UNAVAILABLE` |
| `backend/system-audit.service.ts` | Module tắt → `503 MODULE_UNAVAILABLE`; lỗi kiểm tra lifecycle thật vẫn là `SERVICE_BUSY` |
| `frontend/dataInspectorApi.ts` | Parse `category`, `access`, `projection`, `PROJECTION_ORDER`; thông điệp cho `MODULE_UNAVAILABLE`, `ACCOUNT_DATA_PROTECTED`, `CONTROLLED_READ_UNAVAILABLE` |
| `frontend/DataInspectorScreen.tsx`, `data-inspector.css` | Nhãn đường truy cập, ô "Hiện bảng hệ thống PostgreSQL" (mặc định ẩn), ghi chú projection và cột không đọc, hướng dẫn sang Audit Logs cho bảng audit |
| `mic/module.mic.json`, `module.json` | 0.1.2; MIC-09 CHANGE từ 0.1.1; MIC-06 +4 resource (ROWS.READ). **MIC-02/03/04/05/07/08/10 không đổi** (đã kiểm bằng script): không thêm quyền IAM, route hay menu |
| `tests/scc-controlled-read.test.ts` *(mới)* | 11 test |
| `database/foundation-read/` *(mới)* | Bản sao SQL B.5 |
| `README.md`, `PACKAGE_FILES_SHA256.txt` | Cập nhật |

Không sửa `backend/src`, `frontend/src` của Host. Không thêm dependency.

### B.5 SQL migration / rollback dự kiến

Đường dẫn: `database/scripts/scc-foundation-read/`, trong worktree và trong gói.

| File | Chạy trên | Nội dung |
|---|---|---|
| `01-create-owner-role.sql` | `postgres` (admin) | `CREATE ROLE talo_foundation_reader …`, có guard |
| `02-grant-owner-test-database.sql` | `talo_mos_v4_test` | `USAGE foundation` + SELECT cấp cột trên 2 bảng; guard baseline (`talo_app` không đọc trực tiếp) |
| `03-create-functions-test-database.sql` | `talo_mos_v4_test` | Schema + 2 hàm + REVOKE PUBLIC + GRANT EXECUTE `talo_app` |
| `04-verify-admin-read-only.sql` | admin, READ ONLY | 9 nhóm kiểm tra cấu trúc / ACL / đặc quyền tối thiểu |
| `05-verify-as-app-read-only.sql` | kết nối `talo_app` trực tiếp | Đọc thật; 10 đầu vào sai → 22023; SELECT thô → 42501; SET ROLE → 42501; kiểm hình dạng kết quả |
| `90-rollback-test-database.sql` | `talo_mos_v4_test` | Gỡ hàm / schema / quyền; guard |
| `91-drop-owner-role.sql` | `postgres` | `DROP ROLE` sau 90 |

SHA-256 các file: `SCC_012_ISOLATED_…\sql-sha256.txt`.

### B.6 Báo cáo kiểm thử (tất cả cô lập; TEST không đổi)

| # | Kiểm thử | Kết quả |
|---|---|---|
| 1 | SQL 01→05 trên bản sao TEST (`postgres:18`) | exit 0; 04 PASS; 05 PASS: 15 sự kiện B07 của SCC (= B07 trên TEST), 101 quy tắc (giới hạn trang) |
| 2 | Rollback 90 → áp lại 02/03 → 04 | PASS (lặp lại được) |
| 3 | 90 + 91 | Role bị xóa; **ACL đầy đủ (bảng + cột) giống hệt TEST**; `scc-audit-read/04` của 0.1.1 vẫn PASS |
| 4 | Test gói SCC (cấu hình preflight) | **25/25** (14 cũ + 11 mới) |
| 5 | Mutation (3 lỗi cố ý) | **6 test FAIL** đúng chỗ: SQL lộ `session_token_hash`, bỏ định tuyến projection, `SERVICE_BUSY` khi module tắt |
| 6 | `tsc` backend Host với SCC 0.1.2 trong staging | 0 lỗi |
| 7 | `tsc -b` frontend Host với SCC 0.1.2 trong staging | 0 lỗi |
| 8 | HTTP thật trên bản sao (router 0.1.2 + Host capabilities thật, `talo_app`, có DB Gate 0.1.2) | 251 lời gọi: 226 trả 200, **0 phản hồi 5xx**. 4 bảng CONTROLLED trả 200 với các cột đã duyệt. Danh mục: BUSINESS 25 / SYSTEM_CATALOG 68; DIRECT 75 / CONTROLLED 4 / PROTECTED 7 / NOT_READABLE 7. Audit Logs 15/15 `complete=true`; 6/6 ca sai trả 400 |
| 9 | SCC tắt (bản sao) | 6/6 route trả **503 `MODULE_UNAVAILABLE`** |
| 10 | Cài 0.1.2 **trước** DB Gate (sau rollback 90) | Module events / rules trả **503 `CONTROLLED_READ_UNAVAILABLE`**, không đọc bảng thô; memberships / sessions vẫn 200 |

**Chưa kiểm tra:**
- Hiển thị UI 0.1.2 trong trình duyệt (cần cài lên TEST).
- `npm test` toàn bộ backend trong worktree. Backend Host không đổi, và `pretest` sẽ chạy `modules:sync`, vốn bị chặn ở worktree do lệch CRLF của release store.
- Preflight thật của Foundation cho 0.1.2.

### B.7 Gate cần chủ dự án phê duyệt (theo thứ tự)

| # | Gate | Nội dung | Tác động |
|---|---|---|---|
| 1 | **UI Evidence 0.1.1** | Chủ dự án lưu ảnh / TXT theo A.1; Claude Code đối chiếu | Chỉ đọc |
| 2 | ~~Chính sách IAM~~ | **ĐÃ DUYỆT** 28/10/2026 | — |
| 3 | ~~Database Access Gate 0.1.2~~ | **PASS** 28/10/2026 07:58Z (`12_SCC_012_DB_GATE_RESULT.md`) | Tạo 1 role, 1 schema, 2 hàm, quyền cấp cột cho role NOLOGIN; `talo_app` chỉ thêm EXECUTE |
| 4 | **Installer Gate 0.1.2** | Quét / candidate `76003a14…` → preflight READY → plan UPGRADE → Commit → restart → Tiếp tục → INSTALLED_ACTIVE | 0.1.1 → RETIRED (release giữ nguyên); điểm phục hồi về 0.1.1 |
| 5 | **Runtime Acceptance 0.1.2** | 6 màn hình, ưu tiên Data Inspection với 4 bảng mới | Chỉ đọc |
| 6 | Git | Commit / push / merge (0.1.1 và 0.1.2, worktree) | Theo phê duyệt |
| — | (tùy chọn) Dọn fixture | DISABLE 41 module `FBET_*` không có ACTIVE (A.3) | Lifecycle |

**SCC chưa COMPLETED:** nhu cầu xem B07, quy tắc truy cập dữ liệu, thành viên và phiên chỉ được đáp ứng sau gate 3–5.
