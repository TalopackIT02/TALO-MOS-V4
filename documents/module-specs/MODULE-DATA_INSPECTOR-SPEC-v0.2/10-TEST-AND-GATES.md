# 10 — Kiểm thử và các gate

> TALO-MOS-V4 | DATA_INSPECTOR | Hồ sơ v0.2 DRAFT | Package/MIC dự kiến 0.1.0 | 22/10/2026 | Repo `main` `fafc4d5f5e0215d40dc9ee7308d23973d1a7b19d`
> USER REVISED SCOPE (22/10/2026). Chỉ thiết kế; không cấp IAM/SQL privileges, không sửa Foundation/Host, không deploy. Bằng chứng runtime: NOT_TESTED.

## Static vs runtime evidence

- `08-MIC-1.0.json`, `09-module.json` là **design artifacts**, không phải code Host đã sync.
- MIC-10 `NOT_TESTED` cho đến khi có log thật; `NOT_TESTED` ngăn activation gate hiện tại.
- Không suy ra build/DB/session/IAM/menu/activation PASS từ JSON.

## Test matrix chưa thực thi

| Test | Kỳ vọng |
|---|---|
| TC-01 | Catalog liệt kê **mọi** schema và bảng relkind r/p (kể cả system tables) trong DB test, không lọc schema |
| TC-02 | Admin xem structure của bảng có SELECT |
| TC-03 | Admin xem rows chỉ đọc; không có mutation |
| TC-04 | username `admin` với IAM ALLOW truy cập; một username khác dù có IAM ALLOW vẫn nhận 403 ở API |
| TC-05 | Không có grant: user khác không thấy menu B09, deep-link API 403 |
| TC-06 | Cấp nhầm permission cho user khác: xác nhận B09 có thể lộ menu → **block acceptance strict menu-only** cho đến giải pháp IAM kiểm soát |
| TC-07 | Header/body/query giả mạo username/userId admin không bypass backend |
| TC-08 | Bảng của Foundation/IAM/pg_catalog trong catalog; db role không đọc được vẫn có metadata + NOT_READABLE |
| TC-09 | Cột có JSON/numeric/NULL/bytea hiển thị đúng, không XSS |
| TC-10 | Thử POST/PUT/PATCH/DELETE trên API -> 404/405; không có thay đổi DB |
| TC-11 | Host.readOnly `transaction_read_only=on`, timeout 5s; DB role không được GRANT mới |
| TC-12 | page 1, 2, last; pageSize default 50 max 100, reject overflow |
| TC-13 | Không có PK: UI cảnh báo thứ tự không ổn định; không khẳng định exact count |
| TC-14 | SQLSTATE 42501, RLS: không bypass, báo trạng thái đúng |
| TC-15 | Table OID stale/drop/rename => CATALOG_CHANGED |
| TC-16 | IAM permission undefined -> 403 |
| TC-17 | IAM direct DENY thắng admin/direct ALLOW/role ALLOW |
| TC-18 | Disabled/revoked/expired session/assurance thấp -> deny |
| TC-19 | Module disabled/0 ACTIVE/2 ACTIVE -> fail closed |
| TC-20 | MIC refs K05 1:1, no duplicates, compatible identity |
| TC-21 | `module.json` routes, screen export, backend entry, Host capability handshake thật |
| TC-22 | MIC10 remains NOT_TESTED until real evidence, no auto-activation |
| TC-23 | Non-admin querying tableKey guessed returns 403 before any rows/metadata |
| TC-24 | SQL identifiers quoted safely; injection payload trong search và tableKey không chạy SQL |
| TC-25 | DB role thiếu SELECT trên `iam.iam_user_accounts` -> fail closed, không tự grant |
| TC-26 | DB credential/session tables exposure: review owner risk before production |

## Gate

| Gate | Trạng thái |
|---|---|
| G0 — Source/Scope | PASS thiết kế: user thay thế highest-class/app-only scope bằng hard-coded admin + all schemas |
| G1 — BRS | DRAFT hoàn tất logic read-only |
| G2 — IAM/API/Data | **CONDITIONAL:** admin gate thiết kế được; menu strict + SQL privilege chưa verify |
| G3 — Static spec | Chỉ PASS nếu checker chạy thực tế (ghi vào evidence bổ sung) |
| G4 — Owner Review | Yêu cầu rà rủi ro bảng nhạy cảm và policy IAM grant riêng |
| G5 — Coding | Chưa được ủy quyền |
| G6 — Runtime/DB TEST | NOT_TESTED |
| G7 — Permission/B09/Activation | BLOCKED tới khi provision được duyệt + MIC10 test PASS thật |

Không sửa IAM v0.3, Foundation, AppShell, Postgres privilege trong task đặc tả. Đề nghị acceptance menu chỉ admin phải được đánh giá **cả khi grant bị cấu hình sai**, thay vì giả định `username` backend tự ẩn menu.
