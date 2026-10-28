# SCC 0.1.2 INSTALLER GATE — KẾT QUẢ

```
GATE:      SCC 0.1.2 INSTALLER (giai đoạn 1 Source Deployment + giai đoạn 2 Foundation Installer)
STATUS:    PASS
TARGET:    TEST — talo_mos_v4_test; Backend :3000 / Frontend :5173 (dev watch / HMR)
APPROVAL:  chủ dự án, "SCC 0.1.2 INSTALLER GATE APPROVAL", 28/10/2026
JOURNAL:   0c0e9fcb-b357-457c-befe-c092d043edcb (UPGRADE 0.1.1 → 0.1.2) → INSTALLED_ACTIVE 2026-10-28T08:11:32.575Z
CANDIDATE: 0b1e0193-247e-40ba-b6a1-fd093c5a9916 · package 76003a14c0214718f370b014ac9ad9361fe7bd51d15d95bc731a152631096495
EVIDENCE:  D:\Documents\ClaudeProject\TALO-MOS-V4_exports\SCC_012_INSTALLER_GATE_20261028-150206\  (evidence-sha256.txt, 54 file)
NEXT:      dừng tại Runtime Acceptance Gate 0.1.2
```

Thao tác cần phiên Administrator (scan, candidate, preflight, lập kế hoạch, Commit, Tiếp tục) do chủ dự án thực hiện. Mỗi thao tác đúng **một lần** và theo đúng thứ tự; log xác nhận không có lần gọi thừa.

Claude Code thực hiện:
- chép source;
- backup và thử restore;
- restart qua Control Center;
- các kiểm tra READ ONLY.

Không sửa DB thủ công, không đổi quyền PostgreSQL / IAM, không dọn fixture FBET, không commit / push.

## 1. Giai đoạn 1 — Source Deployment

| Bước | Kết quả |
|---|---|
| Worktree | `feat/scc-0.1.2-controlled-read` (base `0e491a3`); gói `76003a14…`; PACKAGE_FILES_SHA256 60/60 OK; `module.json` / MIC 0.1.2, MIC-09 CHANGE từ 0.1.1 |
| Snapshot | Source 0.1.1: `scc-0.1.1-source-snapshot.tar` (`c06ba7c4…`). Runtime: lock, `.env`, registry, cây `installed-modules` |
| Chép | Ghi đè `modules/SYSTEM_CONTROLLER_CENTER` (0.1.2 không xóa file nào). Kết quả **giống từng byte** worktree; hash `76003a14…` |
| Watch / HMR | Runtime chỉ nạp từ `installed-modules`, `modules/` không thuộc phạm vi watch. Log: **0 reload backend, 0 HMR frontend**. Lock / registry / `installed-modules` không đổi. Runtime vẫn 0.1.1, audit vẫn AVAILABLE; smoke 16/16 |

## 2. Giai đoạn 2 — Foundation Installer

### 2.1 Precheck và backup

| Mục | Kết quả |
|---|---|
| DB Gate 0.1.2 | Kiểm kê phân quyền = kết quả DB Gate; `PASS 04` |
| SCC 0.1.1 | ACTIVE / bật; journal `8f22fc3b…` INSTALLED_ACTIVE; 0 journal đang mở |
| Backup | `talo_test_before_scc012_install_20261028-150206.dump` `70acaf1c…`, globals `d7cc3d26…` |
| Thử restore | `pg_restore` exit 0; 25/25 bảng khớp số dòng; phân quyền khớp (kể cả `foundation_read_api`) |

### 2.2 Candidate, preflight, kế hoạch (kiểm tra trước Commit)

| Mục | Kết quả |
|---|---|
| Candidate `0b1e0193…` | READY (SCANNED 08:05:04Z → READY 08:05:23Z) |
| Preflight `71ca3668…` | READY: PASS 9, **FAIL 0**, WARN 0. P8 là bước tùy chọn, P5b N/A. P3 = 26/26 test. Report `96056ab5…` = `readyReportHash` |
| Hash | source = snapshot = **`76003a14…`** |
| Kế hoạch | PREPARED, UPGRADE, **0 blocker**; tình trạng trước: lock 0.1.1 `e47e0084…`, ACTIVE 0.1.1 |
| MIC diff so với release 0.1.1 | Chỉ **MIC-01, MIC-06, MIC-09**. MIC-06 thêm 4 resource ROWS.READ, không sửa resource cũ |

### 2.3 Commit → restart → Tiếp tục

| Thời điểm (UTC) | Sự kiện |
|---|---|
| 08:08:08 | Commit. Điểm phục hồi: 0.1.1 `7edf2cae…`, MIC `2aabf890…`, enabled=true, lock `e47e0084…`, 7 quyền IAM, revision B09 |
| 08:08:08–09 | RELEASE (ghi `module-releases/…/0.1.2`) → VERSION DRAFT `d84a1ffc…` → MIC (đọc lại khớp) → SUBMIT → APPROVE → LOCK → `AWAITING_RESTART` |
| 08:09:59–08:10:39 (15:09–15:10 giờ máy) | Claude Code restart qua Control Center: **PASS**. Backend và frontend nạp **0.1.2 `76003a14…`**; `installed-modules` = release 0.1.2; smoke 16/16 |
| 08:11:31 | Tiếp tục: RESTART DONE → ACTIVATE (0.1.2 ACTIVE, 0.1.1 RETIRED, có nhật ký kích hoạt) → ENABLE SKIPPED (đã bật) → IAM_CATALOG SKIPPED (0 mới / 7 có sẵn, không gán) → NAVIGATION (không ghi) |
| 08:11:32 | **POSTCHECK 7/7 PASS → INSTALLED_ACTIVE**; rollback = null |

Postcheck:
- B02_ACTIVE, RUNTIME_RELEASE, IAM_CATALOG (7/7), IAM_POLICY (TALO_SYSTEM_ADMIN kế thừa, không tạo GRANT), NAVIGATION (6/6), API_SMOKE (11/11 trả 401): đều PASS.
- **ACCESS_VERIFIED:** 8/8 API GET trả 200 với phiên Admin, gồm assertion `audit/logs` `complete=true`, FOUNDATION / IAM `AVAILABLE`.

## 3. Trạng thái sau cùng

| Mục | Trước | Sau |
|---|---|---|
| B01 SCC | bật | bật |
| B02 0.1.0 / 0.1.1 / 0.1.2 | RETIRED / **ACTIVE** / — | RETIRED / **RETIRED** (MIC `2aabf890…` giữ nguyên) / **ACTIVE** (`d84a1ffc…`, MIC `7c8b0167…`) |
| B07 SCC | 15 | 19 (SUBMIT, APPROVE, RETIRE 0.1.1, ACTIVATE 0.1.2) |
| B08 | — | +5: `VERSION.CREATE`, `UPDATE_MANIFEST`, `SUBMIT`, `APPROVE`, `ACTIVATE`, tất cả SUCCESS |
| B09 SCC | 6 (6 hiển thị) | **không đổi** |
| Kho release | 0.1.0 `f049fb88…`, 0.1.1 `e47e0084…` | **giữ nguyên** + 0.1.2 `76003a14…` |
| Lock | SCC 0.1.1 | SCC 0.1.2 `76003a14…`; DATA_INSPECTOR / SYSTEM_TEST không đổi |
| IAM (permissions, role-permissions), module / version khác | — | fingerprint **không đổi**; 0 quyền mới, 0 gán; IAM audit không có bản ghi mới |
| Phân quyền PostgreSQL | — | **không đổi** (= sau DB Gate 0.1.2) |
| Số dòng | — | Chỉ các bảng Foundation do Installer publish MIC 0.1.2 thay đổi (+1 version, +11 contract / rule, +57 field, +7 version function / action, +1 / +4 compatibility, +4 B07, +5 B08). Bảng IAM và các bảng khác không đổi |
| DATA_INSPECTOR / SYSTEM_TEST | ACTIVE, tắt | không đổi |
| Log backend sau restart | — | 0 error, 0 phản hồi 5xx, 0 `42501`; đúng 1 lần gọi `continue` (200) |

## 4. Runtime 0.1.2 đọc dữ liệu thật và không rò rỉ (TEST, READ ONLY)

Router SCC 0.1.2 đang cài (từ `installed-modules`, có guard hash `76003a14…`) được mount qua Host capabilities thật. Kết nối bằng `talo_app` (lấy từ `.env`) tới `talo_mos_v4_test`. Chỉ dùng GET. Phiên Admin được stub; mọi thứ khác là code và quyền thật.

| Kiểm tra | Kết quả |
|---|---|
| `fnd_module_events` qua `foundation_read_api.read_module_events` | 3 trang × 100 = **300 sự kiện thật**. Sự kiện mới nhất: `ACTIVATE` 0.1.2 08:11:31Z, rồi `RETIRE` 0.1.1, `APPROVE` |
| `fnd_data_access_rules` qua `read_data_access_rules` | **300 quy tắc thật** (3 trang) |
| `iam_memberships` (projection) | 1 dòng, các cột đã duyệt, không có `employee_id` |
| `iam_sessions` (projection) | **42 phiên của mọi tài khoản**, metadata đã duyệt |
| **Quét rò rỉ** | 314 request, 7,09 MB (93 bảng: mọi cột và trang, ma trận mọi tài khoản, audit 31 ngày, kiến trúc): **0** lần xuất hiện của 42 `session_token_hash`, `password_hash`, `employee_id`; **0** mẫu argon2 / bcrypt / scrypt / pbkdf2 / JWT / tên cookie → **NO_LEAK_DETECTED**. Bộ quét đã có đối chứng dương: phát hiện 42/42 khi cố ý làm lộ |
| Sau lần chứng minh | Fingerprint, số dòng, phân quyền không đổi; smoke 16/16 |

## 5. Kết luận

**SCC 0.1.2 INSTALLER GATE: PASS.**

| Yêu cầu bàn giao | Kết quả |
|---|---|
| Journal 0.1.2 INSTALLED_ACTIVE | Đạt |
| SCC 0.1.2 ACTIVE / bật | Đạt |
| Release 0.1.1 bảo toàn | Đạt (`e47e0084…`; B02 RETIRED, MIC giữ nguyên) |
| Postcheck IAM / API | Đạt (7/7, ACCESS_VERIFIED 8/8) |
| 2 hàm `foundation_read_api` đọc dữ liệu thật | Đạt (300 + 300 dòng qua runtime) |
| Access Matrix / Memberships / Sessions không rò rỉ | Đạt (`NO_LEAK_DETECTED`) |
| Module khác không bị ảnh hưởng | Đạt |

**SCC chưa COMPLETED:** cần Runtime Acceptance Gate 0.1.2 trên giao diện.

## 6. Chuẩn bị Runtime Acceptance Gate 0.1.2

**Mục tiêu:** Administrator xem dữ liệu thật trên 6 màn hình, ưu tiên **Data Inspection** và **Audit Logs**.

**Bằng chứng do chủ dự án lưu** vào thư mục mới `SCC_UI_EVIDENCE_012_<ngày>`:

| # | Màn hình | Thao tác | Tiêu chí PASS (Claude Code đối chiếu với log và DB) |
|---|---|---|---|
| 1 | Sức khỏe hệ thống | Chạy kiểm tra → Xuất TXT | Kết quả có AUTH / SESSION / IAM / POSTGRESQL PASS; audit AVAILABLE. `FLEET_LIFECYCLE` FAIL là đúng (41 fixture FBET, gate riêng) |
| 2 | Báo cáo kiểm thử | Xuất TXT | Hiển thị kết quả hoặc trạng thái "chưa có" rõ ràng |
| 3 | **Data Inspection** | (a) Danh sách mặc định (bảng hệ thống ẩn) rồi bật "Hiện bảng hệ thống"; (b) `fnd_modules`; (c) **`fnd_module_events`**; (d) **`fnd_data_access_rules`**; (e) **`iam_memberships`**; (f) **`iam_sessions`**; (g) `iam_credentials` (phải bị bảo vệ); (h) `fnd_audit_logs` (phải hướng dẫn sang Nhật ký) | Nhãn đúng: Đọc trực tiếp / Đọc có kiểm soát / Được bảo vệ. (c)–(f) có dữ liệu thật và ghi chú cột không đọc. (f) không có cột token / hash. Số liệu khớp DB |
| 4 | Foundation & Module | Danh sách → SCC | SCC **0.1.2 ACTIVE**, 0.1.1 / 0.1.0 RETIRED; 7 chức năng |
| 5 | Ma trận phân quyền | Chọn Administrator → Xuất | "Admin kế thừa = Có" cho 34 quyền |
| 6 | **Nhật ký hệ thống** | Trang 1 → mở 1 dòng → lọc ISSUES → trang 2 | Thấy sự kiện thật hôm nay (`MODULE_VERSION.ACTIVATE` 08:11Z…); `complete=true`; phân trang và bộ lọc đúng |

Phạm vi gate chỉ đọc. Không đổi DB, lifecycle hay source; không commit.

Ca Manager 403 và Direct DENY giữ kết quả kiểm cô lập ở 09 (router 0.1.1, cùng cổng). Có thể chạy lại trên bản sao với router 0.1.2 nếu được yêu cầu.
