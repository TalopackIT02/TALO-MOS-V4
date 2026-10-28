# TEST REPORT, FILES CHANGED, PENDING WORK — 27/10/2026

## 1. Kiểm thử thực tế phiên này

Log nằm ở `D:\Documents\ClaudeProject\TALO-MOS-V4_exports\SCC_DB_ACCESS_20261027\`.

| # | Lệnh | Exit | Kết quả |
|---|---|---|---|
| 1 | `npm run typecheck` (backend: src + test) | 0 | PASS |
| 2 | `npm test` (backend, toàn bộ) | 0 | **465 passed / 0 failed / 172 skipped** (34 file PASS, 23 file skip DB/gated) |
| 3 | SCC contract (cấu hình preflight) — baseline trước khi sửa | 0 | 9/9 |
| 4 | SCC contract — RED (bản sao source cũ + test mới) | 1 | 4 failed / 10 passed |
| 5 | SCC contract — sau khi sửa | 0 | **14/14** |
| 6 | Installer `close-failed` — RED (gỡ route) | 1 | 7 failed |
| 7 | Installer `close-failed` — sau khi sửa | 0 | 7/7 (trong file 42 test) |
| 8 | `npm run build` (frontend: typecheck + vite) | 0 | PASS (99 modules) |
| 9 | `tests`: `tsc --noEmit` | 0 | PASS |
| 10 | `npx playwright test --project=react-dev --project=react-preview` | 1 | **315 passed / 2 failed / 9 skipped / 6 did not run**. 2 fail = `auth-flow.e2e.spec.ts:38`, có từ trước (react-dev + react-preview); 6 did not run = khối serial sau auth-flow, giống các lượt trước |
| 11 | Probe EXPLAIN `talo_app` trên TEST (0.1.1 source) | 0 | 18 OK, 3 × `3F000` (`audit_api` chưa có) |
| 12 | Probe EXPLAIN `talo_app` trên TEST (release 0.1.0) | 0 | `audit` → `42501` (`fnd_audit_logs`) |
| 13 | SQL 01–06, 90, áp dụng lại, ca âm tính, timing, service end-to-end trên bản sao cô lập | 0 | PASS (chi tiết `01_DB_APPROVAL_PACK.md` §4) |
| 14 | Inventory TEST trước / sau | — | Giống hệt (không có thay đổi trên TEST) |

**Không chạy trong phiên này:**
- DB suites `TALO_FOUNDATION_DB=1` (ghi fixture lên TEST, ngoài phạm vi gate này);
- HTTP / UI có session thật trên TEST (chưa deploy, chưa migration).

IAM inheritance và Foundation authorization được bao phủ trong mục 2: `module-host.permissions`, `foundation.canonical`, `foundation.installer.iam` và evaluator tests đều PASS.

## 2. File thay đổi trong phiên này

Không cài dependency. Không sửa `documents/` của chủ dự án và release 0.1.0.

### Backend

- `backend/src/modules/foundation/foundation.installer.service.ts`: thêm `closeFailedInstall` và 2 mã lỗi `JOURNAL_STATE_MISMATCH`, `CLOSE_NOT_APPLICABLE`.
- `backend/src/modules/foundation/foundation.installer.routes.ts`: thêm route `POST …/close-failed`.
- `backend/test/unit/foundation/foundation.installer.test.ts`: thêm 7 test CF-1 … CF-7 và công tắc lỗi `disable`.
- `backend/scripts/scc-sql-privilege-probe.ts` *(mới)*: probe EXPLAIN chỉ đọc.

### Frontend và e2e

- `frontend/src/services/foundation/moduleScanApi.ts`: thêm `hasRecoveryPoint`, `closeFailed()`.
- `frontend/src/pages/foundation/CandidateWorkspace.tsx`: thêm nút đóng lượt cài đặt thất bại kèm ConfirmModal và thông điệp lỗi.
- `tests/e2e/installer-close-failed.e2e.spec.ts` *(mới)*.
- `tests/e2e/support/candidate-mock.ts`: export `install` / `steps`.

### Gói SCC 0.1.1 (`modules/SYSTEM_CONTROLLER_CENTER/`)

- `backend/controller-overview.service.ts`: Matrix có `viaAdministrator` và điều kiện evaluator; `dataUnavailable()` phân loại theo SQLSTATE.
- `backend/controller-overview.routes.ts`: thêm `details.sqlstate`.
- `frontend/AccessMatrixTab.tsx`: thêm cột "Admin kế thừa" và "Nguồn hiệu lực".
- `frontend/SystemLogsTab.tsx`: thông điệp theo SQLSTATE.
- `tests/scc-contract.test.ts`: thêm 5 test.
- `database/06-verify-extended-as-app-read-only.sql` và `database/README.md`.
- `PACKAGE_FILES_SHA256.txt`: tạo lại, 49 mục.
- **Package hash mới:** `e47e0084f5e0de3c5dd05e1a43126e0ccc4910f44b214ad3b3c44709bfa0ea51`.

### SQL

- `database/scripts/scc-audit-read/06-verify-extended-as-app-read-only.sql` *(mới)*.
- `database/scripts/scc-audit-read/README.md`: cập nhật sự thật thực thi.
- 01–05 và 90 không đổi.

## 3. Việc còn lại để SCC hoạt động hoàn chỉnh

1. ~~DB gate~~ — **PASS** 27/10/2026, xem `03_DATABASE_GATE_RESULT.md`.
2. ~~Deploy gate~~ — **PASS** 27/10/2026 (`04_DEPLOY_GATE_RESULT.md`). Nội dung cũ: restart Backend + Frontend chạy source đã test. Cần cho route `close-failed`, alias Host, UI mới. Release 0.1.0 không đổi.
3. ~~Journal gate~~ — **PASS** 27/10/2026 17:33Z (`05_JOURNAL_GATE_RESULT.md`); SCC đang TẮT. Nội dung cũ: gọi `close-failed` cho `d6fa3a06-1707-43c1-84bd-470b4107a78f`.
   - SCC đang enabled → sẽ DISABLE (B07 / B08), SCC tạm ngừng cho đến bước 4.
   - Kiểm tra: journal chuyển `FAILED_SAFE`; B02 0.1.0 vẫn ACTIVE; lock / release / B09 giữ nguyên; plan mới không còn `INSTALL_IN_PROGRESS`.
4. ~~Installer gate 0.1.1~~ — **PASS** 28/10/2026 06:43Z, journal `8f22fc3b…` INSTALLED_ACTIVE (`07_INSTALLER_GATE_RESULT.md`). Nội dung cũ:
   - quét lại, rồi chạy preflight mới (hash `e47e0084…`; kết quả READY của Work thuộc hash cũ);
   - plan UPGRADE: recovery point từ lock 0.1.0 `f049fb88…` và release store; người thao tác cần thêm quyền `foundation.module_version.retire`;
   - commit → restart → continue → INSTALLED_ACTIVE;
   - nếu thất bại: phục hồi chính thức (RECOVERY_AWAITING_RESTART → RECOVERED).
5. **Nghiệm thu runtime 6 màn hình** (kế hoạch: `08_RUNTIME_ACCEPTANCE_PLAN.md`):
   - Admin được phép; Manager bị 403 (`ADMIN_ROLE_REQUIRED`); Direct DENY thắng; module disabled → 503;
   - Audit Logs: `complete=true` + FOUNDATION / IAM AVAILABLE, kiểm ở cửa sổ có sự kiện (Foundation cần ≥ 2 ngày vì sự kiện mới nhất là 26/10);
   - Access Matrix của Admin hiện "Admin kế thừa = Có".
6. **Git:** commit / push / merge theo phê duyệt riêng.

## 4. Phê duyệt cần chủ dự án

| Gate | Nội dung cần duyệt | Trạng thái |
|---|---|---|
| DB | `01_DB_APPROVAL_PACK.md` §7 | **PASS** 27/10/2026 (`03_DATABASE_GATE_RESULT.md`) |
| Deploy | Restart TEST với source hiện tại | **PASS** 27/10/2026 (`04_DEPLOY_GATE_RESULT.md`) |
| Journal / Lifecycle | `close-failed` cho `d6fa3a06…` (có DISABLE SCC tạm thời) | **PASS** 27/10/2026 (`05_JOURNAL_GATE_RESULT.md`) |
| Installer | Plan / commit / cutover SCC 0.1.1 (hash `e47e0084…`) | **PASS** 28/10/2026 (`07_INSTALLER_GATE_RESULT.md`) |
| Runtime acceptance | 6 màn hình SCC bằng giao diện Admin | **PARTIAL** 28/10/2026 (`09_RUNTIME_ACCEPTANCE_RESULT.md`): API/IAM/dữ liệu PASS; UI có ảnh NOT_TESTED; SELECT OPEN (B07, fnd_data_access_rules, memberships/sessions) |
| Git | Commit / push / merge | Chưa xin |
