# SCC 0.1.2 — DATABASE ACCESS GATE: hồ sơ phê duyệt (CHƯA THỰC HIỆN)

```
GATE:      SCC 0.1.2 DATABASE ACCESS (fnd_module_events, fnd_data_access_rules)
STATUS:    CHỜ PHÊ DUYỆT — chưa chạy bất kỳ SQL nào trên TEST (đã xác minh: không có role talo_foundation_reader,
           không có schema foundation_read_api)
TARGET:    talo_mos_v4_test (container talo-mos-v4-postgres, 127.0.0.1:5433), chạy bằng admin
SOURCE:    D:\Documents\ClaudeProject\TALO-MOS-V4-wt-scc012\database\scripts\scc-foundation-read\
           (bản sao giống hệt trong gói SCC 0.1.2: modules/SYSTEM_CONTROLLER_CENTER/database/foundation-read/)
EVIDENCE:  D:\Documents\ClaudeProject\TALO-MOS-V4_exports\SCC_012_DBGATE_PREP_20261028-145028\  (evidence-sha256.txt)
           D:\Documents\ClaudeProject\TALO-MOS-V4_exports\SCC_012_ISOLATED_20261028-143303\
POLICY:    "SCC 0.1.2 POLICY DECISION" 28/10/2026 (memberships / sessions — không cần thay đổi DB)
```

## 1. Phạm vi

Gate này **chỉ** cấp cơ chế đọc có kiểm soát cho 2 bảng Foundation mà `talo_app` không có quyền SELECT.

`iam_memberships` / `iam_sessions` **không thuộc gate này**: `talo_app` đã có quyền SELECT, và SCC 0.1.2 trả về bộ cột cố định theo chính sách đã duyệt.

Không thay đổi:
- `audit_api`;
- quyền hiện có của `talo_app` trên bảng;
- schema bảng, dữ liệu, IAM, lifecycle;
- SCC 0.1.1 đang chạy.

## 2. Bộ SQL cần phê duyệt (SHA-256)

| File | SHA-256 | Chạy trên |
|---|---|---|
| `01-create-owner-role.sql` | `ff44c8355829497af95b4bd64b8e48d8619680677b4110fb774fd699113555d2` | `postgres` |
| `02-grant-owner-test-database.sql` | `882a6165d402f66194de35e0573b5855e0c6ce3ced77f3e7c6c93374345866ad` | `talo_mos_v4_test` |
| `03-create-functions-test-database.sql` | `87c0b0f39b6634c7358ac3b4d9f669356c0fd9f77e5fe32d0188783f82726294` | `talo_mos_v4_test` |
| `04-verify-admin-read-only.sql` | `daffa46e48d0378fa6fa7f83bc38866234ffa420b162e36bdda928299a746bfd` | `talo_mos_v4_test` (READ ONLY) |
| `05-verify-as-app-read-only.sql` | `c180a7e5a3baadd5916032abf1c29c4193f7ab1cf8b770c2ea5a9209f0e59072` | kết nối `talo_app` (READ ONLY) |
| `06-privilege-inventory-read-only.sql` | `6cf6e969504ab1399b259319e345807b341d3c0224e7e8d964d39c625a8432a2` | `talo_mos_v4_test` (READ ONLY) |
| `90-rollback-test-database.sql` | `ab4703303c21b657581dfd5437655617b8df5c5142b8f99d5b3814852234ce17` | `talo_mos_v4_test` (chỉ khi rollback) |
| `91-drop-owner-role.sql` | `c943ca56ee45bdefb2ec1009921c70cca16290bc43542040ca8c764f8faaa3d0` | `postgres` (chỉ khi rollback) |

Mọi script ghi đều có guard:
- sai database thì dừng;
- role / schema đã tồn tại thì dừng;
- role mang thuộc tính hoặc quyền ngoài dự kiến thì dừng;
- `talo_app` đã đọc trực tiếp bảng đích (baseline lệch) thì dừng.

## 3. ACL delta được phép (đo trên bản sao bằng 06; ngoài danh sách này là FAIL)

| Đối tượng | Trước | Sau |
|---|---|---|
| Role `talo_foundation_reader` | không có | NOLOGIN, NOINHERIT, không superuser / createrole / createdb / bypassrls, không thành viên |
| Schema `foundation` | ACL hiện tại | + `talo_foundation_reader=U` |
| `foundation.fnd_module_events` (cột) | `talo_app=a` trên 7 cột | + `talo_foundation_reader=r` trên 9 cột: `event_id, module_id, version_id, event_type, actor_account_id, before_state, after_state, occurred_at, correlation_id` |
| `foundation.fnd_data_access_rules` (cột) | `talo_app=a` trên 5 cột | + `talo_foundation_reader=r` trên 8 cột: `access_rule_id, data_contract_id, version_action_id, data_operation, approval_mode, workflow_key, is_enabled, created_at` |
| Schema `foundation_read_api` | không có | owner admin; `USAGE` cho `talo_foundation_reader`, `talo_app`; không cho PUBLIC |
| `foundation_read_api.read_module_events(...)` | không có | SECURITY DEFINER, owner `talo_foundation_reader`, `search_path=pg_catalog`, EXECUTE: `talo_app` |
| `foundation_read_api.read_data_access_rules(...)` | không có | như trên |

**Không có** thay đổi nào khác: mọi bảng / cột khác, `iam`, `audit_api`, quyền bảng của `talo_app` đều giữ nguyên.

## 4. Trình tự thực hiện (sau khi phê duyệt)

1. Xác minh SHA-256 của 8 file SQL đúng như §2.
2. Xác minh mục tiêu: `current_database() = talo_mos_v4_test`, container và cổng đúng. Role / schema 0.1.2 chưa tồn tại.
3. **Backup:** `pg_dump -Fc` + `pg_dumpall --globals-only --no-role-passwords`. Thử restore vào container `postgres:18` tạm; số dòng 25 bảng phải khớp. Hủy container.
4. `06` → `privilege-before.txt`.
5. `01` (`postgres`) → `02` → `03` (`talo_mos_v4_test`), dừng ở lỗi đầu tiên (`ON_ERROR_STOP`).
6. `04` (admin) phải in `PASS 04`. `05` (kết nối `talo_app` trực tiếp) phải in `PASS 05` và trả số dòng.
7. `06` → `privilege-after.txt`. Diff phải đúng bằng §3.
8. Kiểm tra dữ liệu không đổi: số dòng 25 bảng trước = sau. Smoke 16/16. SCC 0.1.1 vẫn INSTALLED_ACTIVE.
9. **FAIL ở bất kỳ bước nào:** chạy `90` rồi `91`, `06` phải trở về đúng baseline, báo cáo, dừng. Không sửa tay.

**Không cần restart.** SCC 0.1.1 đang chạy không gọi `foundation_read_api`, nên gate này không ảnh hưởng runtime.

## 5. Bằng chứng kiểm thử cô lập (bản sao TEST, `postgres:18`)

| Kiểm thử | Kết quả |
|---|---|
| 01→05 | exit 0; `PASS 04`; `PASS 05`: 15 sự kiện B07 của SCC (= TEST), 101 dòng / trang tối đa; 10 đầu vào sai → `22023`; SELECT thô → `42501`; `SET ROLE` → `42501` |
| Delta 06 | Đúng như §3 (`acl-ext-delta.diff`) |
| 90 → áp lại → 04 | PASS, lặp lại được |
| 90 + 91 | Kiểm kê 06 (role, schema, bảng, cột, hàm) **giống hệt TEST**; `scc-audit-read/04` (0.1.1) vẫn PASS |
| HTTP với SCC 0.1.2 (router + Host thật, `talo_app`) | 4 bảng CONTROLLED trả 200; 0 phản hồi 5xx; Audit Logs 15/15 `complete`; SCC tắt → 6/6 trả `503 MODULE_UNAVAILABLE`; thiếu DB Gate → `503 CONTROLLED_READ_UNAVAILABLE` (không đọc bảng thô) |
| **Quét rò rỉ** | 315 request / 7,2 MB response (mọi bảng, mọi cột, 300 dòng module events, 300 rules, toàn bộ 42 phiên, ma trận, audit 31 ngày): **0 lần xuất hiện** của 42 `session_token_hash`, `password_hash`, `employee_id`; 0 mẫu argon2 / bcrypt / scrypt / pbkdf2 / JWT / tên cookie → `NO_LEAK_DETECTED` |
| Đối chứng dương | Cố ý đưa `session_token_hash` vào projection → bộ quét phát hiện **42/42** → bộ quét có hiệu lực |
| Test gói SCC 0.1.2 | **26/26** (gồm test khóa cột theo chính sách); mutation 3 lỗi → 6 test FAIL đúng chỗ |
| `tsc` backend / frontend Host với SCC 0.1.2 | 0 lỗi / 0 lỗi |

## 6. Rủi ro và giới hạn

- `talo_app` là role dùng chung. Mọi code backend chạy bằng `talo_app` đều có thể gọi 2 hàm này. Hàm tự kiểm tra lại mọi giới hạn, và chỉ trả cột đã duyệt (không trả JSON thô). Đây cũng là mức đánh đổi đã chấp nhận với `audit_api`.
- `before_state` / `after_state` vẫn được role definer đọc, nhưng hàm chỉ trả 5 trường đã kiểm định dạng.
- Cửa sổ sự kiện ≤ 366 ngày, offset ≤ 100000. Sự kiện cũ hơn không xem được qua SCC.
- Gate này **không** làm SCC hiển thị 2 bảng ngay. Cần thêm Installer Gate 0.1.2 (gói hash `76003a14…`), sau đó nghiệm thu runtime.

## 7. Nội dung xin phê duyệt

1. Chạy §4 bước 1–8 trên `talo_mos_v4_test` với đúng 8 file theo SHA-256 ở §2.
2. Rollback bằng 90 + 91 nếu có bất kỳ sai lệch nào so với §3 hoặc §4.
3. Giới hạn:
   - không restart, không deploy;
   - không cài SCC 0.1.2;
   - không đổi lifecycle;
   - không commit / push;
   - không đụng `iam_*` hay `audit_api`;
   - không sang Installer Gate khi chưa có phê duyệt riêng.
