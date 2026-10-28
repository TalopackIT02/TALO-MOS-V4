# SCC — CONTEXT CHO PHIÊN CLAUDE CODE TIẾP THEO

**Cập nhật:** 27/10/2026 · **DB Gate: PASS** (`03_DATABASE_GATE_RESULT.md`) · **DEPLOY Gate: PASS** (`04_DEPLOY_GATE_RESULT.md`) · **Đang dừng tại:** JOURNAL-APPROVAL. Lưu ý: runtime TEST là dev server watch/HMR — lưu file src hoặc chạy `npm test` sẽ nạp thẳng vào runtime.
**Đọc theo thứ tự:** file này → `01_DB_APPROVAL_PACK.md` → `02_TEST_REPORT_AND_PENDING.md`.
**Nguồn bàn giao gốc (chỉ đọc):** `documents/development/TALO_MOS_V4_SCC_HANDOFF_20261027/` (5 file, SHA256SUMS khớp) và
`D:\Documents\ClaudeProject\TALO-MOS-V4_exports\CLAUDE_CODE_CONTINUATION_HANDOFF_20261027-201021\` (7/7 khớp; Phase 2 31/31 khớp).
**Bằng chứng phiên này:** `D:\Documents\ClaudeProject\TALO-MOS-V4_exports\SCC_DB_ACCESS_20261027\` (gọi tắt `$EV`).

## 1. Dự án và quyết định không được thay đổi

- SCC (`SYSTEM_CONTROLLER_CENTER`) có 6 màn hình:
  - System Health / Diagnostics;
  - Test Results;
  - Data Inspection;
  - Foundation & Module (Architecture);
  - IAM Access Matrix;
  - System Audit Logs.
- Lớp kiểm soát gồm ba tầng:
  - **IAM** quyết định *người dùng* được làm gì: Administrator Gate `TALO_SYSTEM_ADMIN`, K05 permission, Direct DENY thắng, assurance, lifecycle ACTIVE + ENABLED.
  - **PostgreSQL** giới hạn *năng lực truy vấn của dịch vụ* (`talo_app`).
  - Hai tầng này **không** bắc cầu cho nhau: quyền IAM không sinh GRANT SQL, và GRANT SQL không thay quyền IAM.
- `TALO_SYSTEM_ADMIN` kế thừa động mọi permission đã định nghĩa, kể cả của module tương lai. Không tạo ALLOW tĩnh giả.
- Đọc audit đi qua 3 hàm `audit_api.read_*` (SECURITY DEFINER, owner `talo_audit_reader` NOLOGIN). Không GRANT SELECT thô bảng audit cho `talo_app`.
- Release `backend/module-releases/SYSTEM_CONTROLLER_CENTER/0.1.0` là bất biến. Hash `f049fb88…` đã kiểm lại khớp lock.
- Mọi thao tác ghi thật cần phê duyệt riêng theo từng gate, không gộp: DB / Deploy / Journal-Lifecycle / Installer 0.1.1 / Git.

## 2. Trạng thái thực tế đã kiểm chứng (27/10/2026)

| Lớp | Trạng thái | Nguồn kiểm chứng |
|---|---|---|
| Git | Branch `feat/iam-admin-inheritance-20261024`, HEAD `0e491a3`, khớp handoff. Còn 14 file tracked + 4 nhóm untracked của Work, cộng thay đổi của phiên này (mục 4). Chưa commit/push. | `git status` |
| PostgreSQL TEST | PG 18.6, `127.0.0.1:5433`, DB `talo_mos_v4_test`. **Sau DB Gate (2026-10-27T15:10Z):** có role `talo_audit_reader` + `audit_api` (3 hàm), `talo_app` chỉ EXECUTE; dữ liệu không đổi; probe 0.1.1 21/21 OK. | `03_DATABASE_GATE_RESULT.md` |
| SCC trên TEST | 0.1.0 ACTIVE, enabled = true | inventory |
| Installer journal `d6fa3a06…` | `RECOVERY_REQUIRED`, NEW_MODULE, lỗi `ACCESS_VERIFIED`. Journal ghi `enabled=false` nhưng DB là `true` (journal cũ). Đang chặn plan 0.1.1 bằng `INSTALL_IN_PROGRESS`. Phiên này không chạm. | file journal, `updatedAt` 2026-10-24T07:08:38Z |
| Source SCC 0.1.1 | package hash Foundation mới **`e47e0084f5e0de3c5dd05e1a43126e0ccc4910f44b214ad3b3c44709bfa0ea51`**. Thay `576eed9a…` của Work vì phiên này sửa source; candidate/run FMI-02 và `SCC_0.1.1_RELEASE.zip` của Work **không còn dùng làm bằng chứng**. | `hashPackage` |

## 3. Nguyên nhân SQLSTATE 42501 (đã xác định chính xác)

- `talo_app` có trên `foundation.fnd_audit_logs` chỉ INSERT mức cột, **không có SELECT**. Trên `iam.iam_audit_logs` cũng chỉ có INSERT. Không có RLS hay policy. Owner hai bảng là `talo_foundation_owner` / `admin`.
- Probe EXPLAIN từng câu SQL thật của SCC dưới phiên `talo_app` (`backend/scripts/scc-sql-privilege-probe.ts`):
  - **Release 0.1.0 đang chạy:** câu `audit` của Diagnostics bị 42501 trên `fnd_audit_logs`. SQL Audit Logs đọc bảng thô, nên cũng bị 42501.
  - **Source 0.1.1:** 18/21 câu OK. 3 câu audit lỗi `3F000` vì `audit_api` chưa tồn tại.
  - **Sau migration** (bản sao cô lập): 0.1.1 đạt **21/21 OK**; 0.1.0 vẫn 42501, nên phải cài 0.1.1.
- Mọi bảng/cột còn lại mà SCC cần (Foundation B01–B14, IAM accounts/roles/permissions, pg_catalog) **đã đủ quyền**. Không cần GRANT nào khác.

## 4. Phiên này đã làm (Claude Code)

1. Xác minh toàn bộ checksum bàn giao, HEAD và working tree, hash release 0.1.0; đối chiếu `DATABASE_MIGRATION.sql` = 01 + 02 + 03 + 04 + `\connect`.
2. Inventory quyền read-only trên TEST. Thêm probe EXPLAIN chính xác theo cột (`backend/scripts/scc-sql-privilege-probe.ts`), vì inventory theo bảng của Work báo sai khi quyền cấp theo cột.
3. Chạy lại toàn bộ SQL của Work trên **bản sao cô lập TEST** (PG 18.6, role + dữ liệu thật; container đã hủy sau khi chạy):
   - migration, verify;
   - ca âm tính;
   - hiệu năng;
   - rollback, so sánh ACL;
   - áp dụng lại.
   Kết quả: **PASS**. Chi tiết trong `01_DB_APPROVAL_PACK.md`.
4. Thêm `06-verify-extended-as-app-read-only.sql`. Lý do: 05 dùng cửa sổ 24h, mà Foundation audit mới nhất là 2026-10-26 nên 05 trả 0 dòng, không chứng minh có dữ liệu. 06 dùng cửa sổ 31 ngày và kiểm 9 ca input sai, raw SELECT, SET ROLE và shape kết quả.
5. Sửa source SCC 0.1.1:
   - **Access Matrix:** thêm nguồn `viaAdministrator` (kế thừa `TALO_SYSTEM_ADMIN`); điều kiện hiệu lực khớp evaluator (`assigned_at`); thêm cột "Nguồn hiệu lực" (Direct DENY thắng).
   - **Overview:** lỗi PostgreSQL trả mã theo SQLSTATE:
     - 42501 → `DB_PRIVILEGE_MISSING`;
     - 3F000 / 42P01 / 42883 → `DB_OBJECT_MISSING`;
     - khác → `DATA_UNAVAILABLE`.
     Có `details.sqlstate`; không còn gắn nhãn "quyền" cho mọi lỗi.
   - **Audit Logs UI:** thông điệp theo SQLSTATE, ghi rõ là lỗi database, không phải IAM.
   - 5 contract test mới. RED trên code cũ: 4 fail.
6. Thêm Installer operation Foundation-native `POST /foundation/module-installations/:id/close-failed` `{acknowledge:true}` để đóng journal NEW_MODULE thất bại thành `FAILED_SAFE`:
   - chạy dưới module lock;
   - đọc lại journal và B01/B02;
   - DISABLE qua Lifecycle nếu module đang bật;
   - fail closed.
   Kèm nút trong Candidate Workspace có ConfirmModal, 7 unit test (RED 7 fail) và 2 Playwright test. **Chưa gọi trên TEST.**
7. Hồi quy: backend 465 PASS / 0 FAIL / 172 skip; SCC contract 14/14; frontend build PASS; Playwright react-dev + preview 315 PASS, 2 fail `auth-flow:38` có từ trước.

## 5. Thứ tự gate tiếp theo

1. **DB-APPROVAL:** chạy đúng chuỗi lệnh ở `01_DB_APPROVAL_PACK.md` §6.
2. **DEPLOY:** restart Backend + Frontend với source đã test (Installer có `close-failed`, Host alias, UI mới).
3. **JOURNAL/LIFECYCLE:** gọi `close-failed` cho `d6fa3a06…`. Module SCC đang enabled sẽ bị DISABLE (có audit) cho đến khi 0.1.1 được cài.
4. **INSTALLER 0.1.1:**
   - quét lại và preflight mới (hash `e47e0084…`);
   - plan UPGRADE: kiểm tra recovery point từ lock 0.1.0 `f049fb88…` và release store;
   - commit → restart → continue.
5. **Nghiệm thu 6 màn hình:**
   - Admin / Manager / Direct DENY;
   - Audit chỉ PASS khi `complete=true` + hai nguồn AVAILABLE + có dữ liệu ở cửa sổ có sự kiện.
6. **GIT:** commit / push / merge, mỗi thao tác cần phê duyệt riêng.

## 6. Lưu ý kỹ thuật cho phiên sau

- Chạy contract test của gói SCC giống preflight:
  ```
  cd backend
  TALO_PREFLIGHT_TESTS=../modules/SYSTEM_CONTROLLER_CENTER/tests node node_modules/vitest/vitest.mjs run --config scripts/installer/preflight.vitest.config.mjs
  ```
- Sửa bất kỳ file nào trong `modules/SYSTEM_CONTROLLER_CENTER/` đều phải:
  - tạo lại `PACKAGE_FILES_SHA256.txt` (mọi file trừ chính nó và `node_modules/`, sắp theo hash);
  - tính lại package hash;
  - giữ `database/` của gói giống hệt `database/scripts/scc-audit-read/`.
- Dùng probe:
  ```
  npx tsx --env-file=../.env scripts/scc-sql-privilege-probe.ts
  ```
  Thêm `SCC_PROBE_PACKAGE=module-releases/SYSTEM_CONTROLLER_CENTER/0.1.0` để probe release đang chạy. Chỉ EXPLAIN, READ ONLY, có guard `talo_app` @ `talo_mos_v4_test`.
- Không in credential. Chuỗi kết nối chỉ đọc từ `.env`.
