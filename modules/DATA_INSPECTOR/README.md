# DATA_INSPECTOR — Trình xem PostgreSQL chỉ đọc (admin)

Package `TALO-MODULE-PACKAGE-1`, Host protocol `TALO-MODULE-HOST-1`, MIC `MIC-1.0`, version 0.1.0.
Spec: `documents/module-specs/MODULE-DATA_INSPECTOR-SPEC-v0.2/` (13 tệp).

## Chức năng
- `GET /api/data-inspector/tables` — mọi bảng `relkind r/p` của database đang kết nối, tất cả schema, kèm `readStatus`
  (`READABLE` / `PARTIAL` / `NOT_READABLE` / `UNKNOWN`) theo quyền SQL thật của vai trò API (không GRANT, không SET ROLE).
- `GET /api/data-inspector/tables/{tableKey}/columns` — cột, kiểu, NULL, PK, quyền SELECT từng cột.
- `GET /api/data-inspector/tables/{tableKey}/rows?page=&pageSize=` — 1 trang (mặc định 50, tối đa 100), chỉ cột được SELECT,
  ô dài cắt ở 1000 ký tự, tối đa 100 cột/trang, ORDER BY khóa chính nếu đọc được, RLS giữ nguyên.
- Không có POST/PUT/PATCH/DELETE, SQL editor, export, sửa dữ liệu, DDL, cấp quyền.

## FIX-01 — Che dữ liệu nhạy cảm (backend, mọi schema)
`backend/data-inspector.masking.ts`. Theo **tên** cột / key JSON (tách snake/camel case):
- `FULL`: tên chứa password/passwd/pwd/passphrase/secret/token/credential/salt/otp/totp/cookie/bearer/conninfo/umoptions
  hoặc cặp api_key, private_key, access_key, secret_key, signing_key, encryption_key, session_key, auth_code, recovery_code…
  Ngoại lệ: tên kết thúc `_id/_ids/_at/_count`, hoặc kiểu boolean / số / ngày giờ. Cột FULL **không được SELECT**: SQL trả
  hằng `'[MASKED]'` (cả khi NULL / rỗng). `json[]`, `jsonb[]`, `hstore` cũng FULL.
- `JSON_KEYS`: json/jsonb đọc tối đa 65 536 ký tự, parse, che đệ quy giá trị dưới key nhạy cảm; quá dài / không parse được → che toàn bộ.
- Không có tham số nào tắt được masking. Giới hạn: bí mật nằm dưới tên trung tính hoặc trong văn bản tự do **không** được phát hiện.

## Kiểm soát truy cập (mỗi request)
Session (Host) → IAM `data_inspector.catalog.read` / `data_inspector.rows.read` (Host AccessGuard, Direct DENY thắng)
→ lifecycle (ENABLED + đúng 1 ACTIVE) → **một** transaction READ ONLY của Host: tra `iam.iam_user_accounts` theo
`actor.userAccountId`, chỉ cho phép `username === 'admin'` (phân biệt hoa thường), ACTIVE, `disabled_at IS NULL`
→ kiểm tham số / `tableKey` (tái xác định theo OID trong `pg_catalog`) → SELECT.
Menu B09 chỉ lọc theo IAM: muốn chỉ `admin` thấy menu thì chỉ cấp hai quyền trên **trực tiếp cho `admin`**.

## Cài vào Foundation
1. Thư mục `modules/DATA_INSPECTOR/`; `npm run build` / `npm run dev` ở `backend/` và `frontend/` tự chạy `modules:sync`.
2. Đăng ký qua Foundation API (người có quyền): REGISTER → VERSION 0.1.0 → PUT MIC (`mic/data-inspector.mic.ts`) → SUBMIT →
   APPROVE → ACTIVATE → ENABLE, tạo mục menu `/data-inspector`; IAM định nghĩa + cấp 2 quyền. Sync **không** phải phê duyệt.

## Kiểm thử (chạy từ `backend/`)
```
npm run modules:sync
npx tsc -p ../modules/DATA_INSPECTOR/tests/tsconfig.json
npx vitest run --config ../modules/DATA_INSPECTOR/tests/vitest.config.mjs
# PostgreSQL TEST (talo_mos_v4_test / talo_app, chỉ đọc):
TALO_DATA_INSPECTOR_DB=1 node --env-file=../.env ./node_modules/vitest/vitest.mjs run --config ../modules/DATA_INSPECTOR/tests/vitest.config.mjs
```
