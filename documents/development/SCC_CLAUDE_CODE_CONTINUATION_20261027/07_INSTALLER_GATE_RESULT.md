# INSTALLER GATE RESULT — SCC 0.1.0 → 0.1.1

```
GATE:      SCC 0.1.1 INSTALLER-APPROVAL
STATUS:    PASS (Installer). Lỗi SELECT trên giao diện SCC: CHƯA kết luận — chờ Runtime Acceptance Gate (08)
TARGET:    TEST — talo_mos_v4_test, Backend :3000 / Frontend :5173 (dev watch / HMR)
APPROVAL:  chủ dự án, "SCC 0.1.1 INSTALLER GATE APPROVAL", 28/10/2026
JOURNAL:   8f22fc3b-3a28-43af-9669-e727d4e7c82e (UPGRADE) → INSTALLED_ACTIVE 2026-10-28T06:43:44.461Z
CANDIDATE: a0cefb10-dc9c-4c6d-a8be-45a11acbbbdb · SYSTEM_CONTROLLER_CENTER 0.1.1 · package e47e0084f5e0de3c5dd05e1a43126e0ccc4910f44b214ad3b3c44709bfa0ea51
EVIDENCE:  D:\Documents\ClaudeProject\TALO-MOS-V4_exports\SCC_INSTALLER_GATE_20261028-012514\  (evidence-sha256.txt)
ACTOR:     0e7b0190-0173-4bc2-8e35-816730a4002b (TALO_SYSTEM_ADMIN) — mọi thao tác UI do chủ dự án thực hiện
```

Claude Code không gọi API Installer, không sửa source, không lưu file mã nguồn, không chạy `npm test` và không ghi DB. Mọi truy vấn DB của Claude Code đều READ ONLY.

## 1. Precheck (trước Commit)

| Mục | Kết quả |
|---|---|
| Git | HEAD `0e491a3`, working tree giống lúc bàn giao (30 mục) |
| Journal mở | 0 (SCC: `d6fa3a06…` `FAILED_SAFE`) |
| Source / PACKAGE_FILES_SHA256 | `e47e0084…`, 49/49 OK |
| DB Gate | ACL giống hệt lúc kết thúc DB Gate; 3 hàm `audit_api` SECURITY DEFINER thuộc `talo_audit_reader`; `talo_app` không có quyền SELECT trực tiếp, chỉ có EXECUTE |
| Journal Gate | B01 SCC tắt, B02 0.1.0 ACTIVE |
| Backup | `talo_test_before_scc011_20261028-012514.dump` `756e1eab…`, globals `a0925ab6…` |
| Thử restore | Container tạm `postgres:18`: `pg_restore` exit 0; 25/25 bảng khớp số dòng; container đã hủy |
| Smoke | 16/16 |

## 2. Candidate, preflight và hash

| Mục | Giá trị |
|---|---|
| Scan / candidate | `4cdf4a82…` / `a0cefb10…`; SCANNED 18:27:56Z → READY 18:28:07Z |
| Preflight `d53c7f3a…` | **READY**: PASS 9 · FAIL 0 · WARN 0 · NOT_TESTED 1 (P8, tùy chọn) · N/A 1 (P5b). Report `cefcf2a7…` = `readyReportHash` |
| Hash | source = snapshot candidate = kho release 0.1.1 = **`e47e0084…`**; release 0.1.1 giống source từng byte |
| Runtime | `installed-modules` backend / frontend / mic = release 0.1.1; log nạp `SYSTEM_CONTROLLER_CENTER 0.1.1 e47e0084…` |

## 3. Journal và lifecycle

| Thời điểm (UTC) | Trạng thái / bước |
|---|---|
| 27/10 18:28:20 | PREPARED, 0 blocker |
| 18:28:44–45 | VERIFY → RELEASE (ghi 0.1.1) → REGISTER SKIPPED → VERSION DRAFT `7edf2cae…` → MIC (đọc lại khớp `2aabf890…`) → SUBMIT → APPROVE → LOCK → **AWAITING_RESTART**; điểm phục hồi: 0.1.0 `928b3499…`, MIC `8114f05f…`, enabled=false, lock `f049fb88…` |
| 28/10 06:31:41 | Control Center RESTART (PASS) nạp 0.1.1 |
| 06:43:42 | RESTART DONE → CUTTING_OVER → ACTIVATE (0.1.1 ACTIVE, 0.1.0 RETIRED, có ghi nhật ký kích hoạt) → ENABLE → IAM_CATALOG SKIPPED (0 mới / 7 có sẵn) → NAVIGATION (không ghi) |
| 06:43:44 | POSTCHECK 7/7 PASS → **INSTALLED_ACTIVE**; `rollback` = null, `recovery` = [], `nextActions` = [] |

| Mục | Trước gate | Sau gate |
|---|---|---|
| B01 SCC `is_enabled` | false | **true** |
| B02 0.1.0 `928b3499…` | ACTIVE | **RETIRED** (MIC `8114f05f…` giữ nguyên) |
| B02 0.1.1 `7edf2cae…` | — | **ACTIVE** (MIC `2aabf890…`, activated 06:43:42.546Z) |
| B07 SCC | 8 | 15 |
| B08 SCC | 10 | 18 |
| B09 SCC | 6 (6 hiển thị), md5 `9c1e025f…` | **giống hệt** |
| Lock | `d0835db3…` (SCC 0.1.0) | `aaf14a2c…` (SCC 0.1.1 `e47e0084…`; 2 module khác không đổi) |
| Kho release | 0.1.0 | 0.1.0 `f049fb88…` (bảo toàn) + 0.1.1 `e47e0084…` |

Các bản ghi B07 / B08 mới:
- Do Installer tạo: SUBMIT, APPROVE, RETIRE 0.1.0, ACTIVATE 0.1.1, ENABLE; B08 tương ứng là `VERSION.CREATE`, `UPDATE_MANIFEST`, `SUBMIT`, `APPROVE`, `ACTIVATE`, `REGISTRY.ENABLE`. Tất cả đều SUCCESS.
- Do thao tác ngoài Installer (xem §6): ENABLE lúc 18:29:19Z và DISABLE lúc 06:37:02Z.

## 4. Postcheck (do Installer chạy thật)

| Postcheck | Kết quả |
|---|---|
| B02_ACTIVE | PASS: B02 ACTIVE, module bật |
| RUNTIME_RELEASE | PASS: backend, frontend và lock khớp nhau |
| IAM_CATALOG | PASS: 7/7 quyền có đúng một bản ghi |
| IAM_POLICY | PASS: có 1 nguồn policy (TALO_SYSTEM_ADMIN kế thừa động); không tạo GRANT |
| NAVIGATION | PASS: 6/6 chức năng có liên kết hiển thị |
| API_SMOKE | PASS: 11/11 API trả 401 khi không có phiên |
| **ACCESS_VERIFIED** | **PASS: 8/8 API GET trả 200 JSON với phiên Admin.** Gồm assertion `audit/logs`: `complete=true`, FOUNDATION `AVAILABLE`, IAM `AVAILABLE` |

So với lần cài 24/10: 6 API từng trả 403 nay trả 200 nhờ Admin Inheritance; 2 API từng trả 400 nay trả 200 nhờ `readProbe`.

## 5. Bằng chứng đọc audit qua `audit_api`

1. **Code đang chạy** (`backend/src/installed-modules/SYSTEM_CONTROLLER_CENTER`, = release 0.1.1):
   - Audit Logs gọi `audit_api.read_foundation_audit(...)` và `audit_api.read_iam_audit(...)`.
   - Diagnostics gọi `audit_api.read_foundation_audit_summary(...)`.
   - Không còn SQL nào đọc trực tiếp `fnd_audit_logs` / `iam_audit_logs`.
2. **Quyền DB:** `talo_app` không có SELECT trên 2 bảng audit, chỉ có EXECUTE trên `audit_api`. Như vậy dữ liệu audit chỉ có thể đến từ `audit_api`.
3. **ACCESS_VERIFIED** đọc audit thành công với phiên Admin, qua router thật của runtime.
4. **Chạy service của runtime** (`audit-service-proof.json`): `SystemAuditService` / `SqlSystemTestRepository` lấy từ `installed-modules`, chạy bằng `talo_app@talo_mos_v4_test` (current_user = session_user), giao dịch READ ONLY, `statement_timeout` 5000. Kết quả:

| Truy vấn | complete | FOUNDATION / IAM | Sự kiện | Thời gian |
|---|---|---|---|---|
| Mặc định 24 giờ | true | AVAILABLE / AVAILABLE | **15** (9 Foundation + 6 IAM) | 101 ms |
| 31 ngày, 50 dòng/trang | true | AVAILABLE / AVAILABLE | **50** (30 + 20), còn trang sau | 75 ms |
| 31 ngày, ISSUES | true | AVAILABLE / AVAILABLE | **25** (16 + 9), còn trang sau | 30 ms |
| Diagnostics: audit summary | — | AVAILABLE | denied 0, failures 0 | — |

5. **Log backend từ lúc restart 06:31:57Z** (178 dòng): 0 lỗi `42501`, 0 cảnh báo "audit source unavailable", 0 error / fatal, 0 phản hồi 5xx, 1 lần khởi động. Lỗi `42501` cuối cùng xuất hiện lúc 18:29:36Z, khi runtime vẫn còn là 0.1.0 (§6).

`track_functions = none`, nên PostgreSQL không đếm số lần gọi hàm. Việc chứng minh dựa vào mục 1–5 ở trên.

## 6. Thao tác ngoài kế hoạch (đã đối chiếu, không ảnh hưởng kết quả)

1. Commit được bấm trước khi Claude Code kiểm tra. Đã kiểm tra lại sau đó: 0 blocker, hash đúng.
2. Bấm "Tiếp tục" 2 lần trước khi restart: trả 409, journal không đổi.
3. SCC bị **BẬT thủ công** lúc 18:29:19Z, khi runtime vẫn là 0.1.0 → `/audit/logs` trả `42501`. Đây là lỗi cũ của 0.1.0.
4. Backend dừng lúc 01:29:49 (giờ máy), khi phiên Windows kết thúc. Control Center restart lúc 13:31:41 (giờ máy) nạp 0.1.1. Claude Code không restart thêm.
5. SCC bị **TẮT thủ công** lúc 06:37:02Z, trở về đúng trạng thái của điểm phục hồi trước khi bấm Tiếp tục.

## 7. Phạm vi không bị ảnh hưởng

| Mục | Kết quả |
|---|---|
| Fingerprint module khác (B01 / B02), toàn bộ B09, `iam_permissions`, `iam_role_permissions` | **Giống hệt** trước gate (md5) |
| DATA_INSPECTOR 0.1.0 / SYSTEM_TEST 1.1.1 | ACTIVE, tắt; không đổi |
| Số module bật | 259 → 260 (chỉ SCC) |
| ACL / quyền PostgreSQL | **Giống hệt** trước gate và lúc kết thúc DB Gate |
| IAM | 0 quyền mới, 0 gán quyền; IAM audit chỉ có LOGIN; session +2 (đăng nhập của chủ dự án) |
| `.env` | `82bd1f7d…`, không đổi |
| Git | Ngoài 30 mục ban đầu, chỉ thêm 2 file do Installer ghi: `backend/module-deployments.json` (M) và `backend/module-releases/SYSTEM_CONTROLLER_CENTER/0.1.1/` (??). Chưa commit |
| Smoke | 16/16 trước Commit, sau restart và cuối gate |

## 8. Đối chiếu điều kiện bắt buộc

| Điều kiện | Kết quả |
|---|---|
| Không còn journal mở | PASS |
| Candidate READY, 0 blocker | PASS |
| Hash release và nội dung khớp | PASS: `e47e0084…`, giống từng byte |
| Bảo toàn 0.1.0 theo chính sách lifecycle | PASS: RETIRED đúng trình tự (có nhật ký kích hoạt); release và MIC giữ nguyên |
| IAM contract không đổi | PASS: md5 permission và role-permission không đổi |
| Không đổi quyền PostgreSQL | PASS: ACL giống hệt |
| Postcheck chạy thật, có bằng chứng | PASS: 7/7, gồm ACCESS_VERIFIED với phiên Admin |
| Không tự tiếp tục hoặc thử lại khi lỗi | PASS: không có lỗi phát sinh từ Installer |

**Kết luận: INSTALLER GATE PASS.**

**Chưa kết luận lỗi SELECT trên giao diện đã được khắc phục.** Bằng chứng mới dừng ở mức API và service. Việc Administrator xem dữ liệu thật trên 6 màn hình SCC sẽ được nghiệm thu ở `08_RUNTIME_ACCEPTANCE_PLAN.md`.

## 9. Tồn tại

- Chưa nghiệm thu trên giao diện, gồm Audit Logs và Dữ liệu hệ thống (Data Inspection).
- Các ca Manager 403 và Direct DENY chưa kiểm được live: TEST chỉ có 1 tài khoản ACTIVE và 0 Direct DENY.
- Runtime TEST vẫn chạy chế độ watch / HMR.
- 2 test Playwright `auth-flow` lỗi từ trước, chưa xử lý.
- Toàn bộ thay đổi chưa commit Git.
