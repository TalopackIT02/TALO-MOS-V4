# DATA_INSPECTOR 0.1.0 — Implementation Addendum (bổ sung cho spec v0.2, không thay thế)

Spec gốc `documents/module-specs/MODULE-DATA_INSPECTOR-SPEC-v0.2/` giữ nguyên. Tài liệu này ghi các quyết định và trạng
thái triển khai thực tế trên TEST (`talo_mos_v4_test`).

## 1. Quyết định đã áp dụng
| Mục | Nội dung |
|---|---|
| FIX-01 (thay BL-05) | Che dữ liệu nhạy cảm tại backend, mọi schema. `FULL`: cột theo tên (password/passwd/pwd/secret/token/credential/api_key/private_key/conninfo/umoptions…, trừ `_id/_at/_count` và kiểu boolean/số/ngày giờ) — **không SELECT**, trả `[MASKED]` (kể cả NULL/rỗng). `JSON_KEYS`: json/jsonb che đệ quy theo key (> 65 536 ký tự hoặc không parse được → che toàn bộ). Không tham số nào tắt được. |
| Hợp đồng API (bổ sung, tương thích) | `columns[].masking` (`NONE`/`FULL`/`JSON_KEYS`); rows: `columnMasking[]`, `rows[].masked[]` (chỉ số ô bị che), `rows[].truncated[]`, `columnTypes[]`, `columnsLimited`, `cellMaxChars`, `orderBy[]`. |
| Quyền IAM thật | `data_inspector.catalog.read` (DATA_INSPECTOR/CATALOG/READ, assurance 1), `data_inspector.rows.read` (DATA_INSPECTOR/ROWS/READ, assurance 1). Chỉ Direct ALLOW cho `admin`; không qua role. |
| Username gate | Mỗi request: Host session → IAM (AccessGuard, Direct DENY thắng) → lifecycle (ENABLED + 1 ACTIVE) → trong **một** transaction READ ONLY: `iam.iam_user_accounts` theo `actor.userAccountId`, chỉ `username === 'admin'`, ACTIVE, chưa disabled. |
| MIC-10 | 8 nhóm tiền kích hoạt, đều PASS: DI-UNIT, DI-DB, DI-MASK, DI-MIC, DI-HOST, DI-TYPECHECK, DI-REGRESSION, DI-IAM-DB (FIXTURE). Tham chiếu `evidence/DI-04-PRE-20261022/` và `evidence/DI-03B-FBET_DI_MVJD8RZ44461/`. Kiểm thử sau kích hoạt không thuộc MIC-10. |
| Version | `0.1.0` (đăng ký lần đầu). MIC-01…09 giữ nguyên như spec 08. |

## 2. Hạn chế đã biết
- **IAM fixture (DI-IAM-DB):** K05 fixture `FBET_DI_<run>`, không phải quyền thật `data_inspector.*` (chưa tồn tại lúc test); session `admin` giả lập; lifecycle stub. AccessGuard, IAM evaluator, PostgreSQL, audit B08 và Host `readOnly` là thật.
- **Menu B09:** Foundation lọc menu theo IAM, không theo username. Tài khoản khác bị cấp nhầm quyền sẽ **thấy** menu, nhưng API vẫn 403 (username gate). Chính sách được chấp nhận: chỉ cấp quyền cho `admin`.
- **Masking dựa trên tên** cột / key JSON: bí mật nằm dưới tên trung tính hoặc trong văn bản tự do không được phát hiện.
- **Quyền SELECT thực tế của `talo_app`** (TEST, 22/10/2026): 93 bảng / 4 schema; 81 READABLE, 1 PARTIAL, 11 NOT_READABLE (vd. `pg_authid`, `iam_audit_logs`, `fnd_audit_logs`, `fnd_module_events`, `fnd_data_access_rules`). Module không mở rộng quyền.

## 3. Quy trình đăng ký / kích hoạt (TEST)
1. Backup (`pg_dump -Fc`, kiểm `pg_restore -l`, SHA-256) — đã làm: `D:/TaloData/backups/data-inspector/talo_mos_v4_test-di04-20261022-165457.dump` (sha256 `9c5f319c…14fadc`).
2. Backend TEST với `NODE_ENV=test` (để B13 ghi môi trường `TEST`): helper **tự khởi động** một backend con ở
   `127.0.0.1:3100` (`NODE_ENV=test`, log tại `D:/TaloData/di04/backend-3100-<ts>.log`), chờ `/api/health` = 200 trước khi
   hỏi mật khẩu và tắt nó khi kết thúc. Cổng 3100 phải trống (không cần mở terminal backend riêng).
3. Chủ dự án chạy helper (đăng nhập `admin` ở prompt ẩn), ngoài Git, từ PowerShell hoặc cmd:
   `cd D:\Documents\ClaudeProject\TALO-MOS-V4\backend` rồi
   `npx tsx ../../TALO-MOS-V4_exports/DI-04-INTEGRATION/register-data-inspector.ts`
   REGISTER → VERSION 0.1.0 → PUT MIC → SUBMIT → kiểm B13/B14 → APPROVE → ACTIVATE → 2 permission (IAM API) →
   bootstrap B1 (`bootstrap-b1.mjs` prep/exec/verify: 2 Direct ALLOW cho `admin` bằng `talo_iam_admin`; rollback =
   UPDATE `revoked_at` của đúng 2 dòng) → menu B09 "Data Inspector" (Function CATALOG) → ENABLE → nghiệm thu bằng session
   thật (API, masking, menu, 401, DISABLE→503→ENABLE) → LOGOUT. Có thể chạy lại (tiếp tục từ trạng thái thực).
4. Nghiệm thu non-admin (lifecycle/quyền/menu thật, tài khoản fixture):
   `TALO_DATA_INSPECTOR_ACCEPT_DB=1 node --env-file=../.env ./node_modules/vitest/vitest.mjs run --config ../modules/DATA_INSPECTOR/tests/vitest.config.mjs data-inspector.acceptance.db`

## 4. Kết quả nghiệm thu (22/10/2026)
| Hạng mục | Kết quả |
|---|---|
| DI-03B IAM fixture IAM-01…07 | PASS (7/7), cleanup 0 dòng còn lại, 10 dòng B08 DENIED giữ lại |
| Evidence tiền kích hoạt DI-04-PRE (10 bước) | PASS |
| Đăng ký / kích hoạt (helper chủ dự án, session `admin` thật, 11:24Z) | PASS — module `cc2bdba4-35e1-4a50-b540-72a9eb2fafcd` ENABLED; version `0edc6f5f-9332-4abd-9a1e-dad4995c0921` 0.1.0 ACTIVE (duy nhất); MIC sha256 `7739cbcb…691110`; B13 TEST/PASS, 0 blocking |
| Quyền thật + bootstrap B1 | PASS — 2 permission qua IAM API; `admin` giữ đúng 2 Direct ALLOW (bootstrap VERIFY OK, fingerprint quyền PostgreSQL không đổi); 0 role grant; không tài khoản khác |
| Menu B09 | PASS — `ebe21cdf-9adf-46f3-9771-d1a5a4e4bcfd` "Data Inspector" → Function CATALOG; menu của `admin` có `/data-inspector` |
| Runtime với session `admin` thật (login E2E qua API) | PASS 20/20 — 3 API GET, pageSize 50/100/101, key tiêm/cũ, không route ghi, masking `password_hash` / `session_token_hash`, `?unmask` → 400, 401, DISABLE → 503 → ENABLE |
| Nghiệm thu non-admin (ACC-01…04) | PASS 4/4 — không quyền → 403 + B08 DENIED, không thấy menu; cấp nhầm → menu hiện (giới hạn B09 đã biết) nhưng API 403; 401 trên backend TEST; cleanup 0 dòng còn lại |
| Frontend build + kết nối AppShell (không trình duyệt) | PASS — build exit 0, `/data-inspector` 200, proxy `/api` → 401 khi chưa đăng nhập |
| Giao diện trên trình duyệt (BROWSER_E2E) | **NOT_TESTED** — không có công cụ trình duyệt trong phiên; cần chủ dự án mở `/data-inspector` với `admin` |
| Verification cuối DI-04-FINAL-20261022-R2 | PASS 10/10 bước; regression 347 / 0 FAIL |

Bằng chứng: `evidence/DI-04-ACCEPT-20261022/`, `evidence/DI-04-FINAL-20261022-R2/`. Lần `DI-04-FINAL-20261022` có 1 FAIL do
test TC-19 giả định module chưa đăng ký; test đã đổi sang key chắc chắn chưa đăng ký (cùng hành vi fail-closed) — giữ lại làm hồ sơ.
