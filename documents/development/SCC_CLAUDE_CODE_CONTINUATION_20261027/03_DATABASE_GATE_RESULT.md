# DATABASE GATE RESULT — SCC Audit Read

```
GATE:      DB (SCC audit_api)
STATUS:    PASS
TARGET:    PostgreSQL 18.6 · 127.0.0.1:5433 (container talo-mos-v4-postgres) · cluster role + DB talo_mos_v4_test
APPROVAL:  chủ dự án, "TALO-MOS-V4 — DB GATE APPROVAL", 27/10/2026 (7 file SQL của 01_DB_APPROVAL_PACK.md)
EXECUTED:  2026-10-27T15:10:11Z → 15:10:12Z (UTC), bởi Claude Code, role admin (superuser), psql trong container
EVIDENCE:  D:\Documents\ClaudeProject\TALO-MOS-V4_exports\SCC_DB_GATE_20261027-220903\  (evidence-sha256.txt)
ROLLBACK:  đã chuẩn bị (90 + backup đã thử restore); KHÔNG cần chạy
```

## 1. Điều kiện tiên quyết

| Yêu cầu của phê duyệt | Kết quả | Bằng chứng |
|---|---|---|
| Xác minh SHA-256 | 7/7 khớp gói phê duyệt, ở cả `database/scripts/scc-audit-read/` và `modules/SYSTEM_CONTROLLER_CENTER/database/` | `approved-sha256.txt`, `sha256-check.txt` |
| Sao lưu | Database: `talo_test_before_scc_db_20261027-220903.dump` (pg_dump -Fc, 25 bảng dữ liệu), SHA-256 `96fdb576faa633c3d73011bc4ab29c4cdd1f8d784286edfb75dd86104175fb36`. Globals: `globals_before_20261027-220903.sql` (pg_dumpall --globals-only, không mật khẩu), SHA-256 `7914edb5fe86c39990829ec0893bb0a04b4a23c05afd649ba02016f997e8b21d` | `backup.sha256` |
| Kiểm tra khả năng khôi phục | Restore vào container tạm `postgres:18` bằng `pg_restore --exit-on-error`: exit 0. Số dòng **mọi bảng** khớp TEST (`foundation.fnd_audit_logs` 14.559, `iam.iam_audit_logs` 148, `fnd_modules` 2.083, …). Container đã hủy sau kiểm tra. | `restore-check.log`, `rowcounts-test.txt` = `rowcounts-restored.txt` |
| Database / role / quyền thực thi | `admin` là superuser và có CREATEROLE trên `postgres` và `talo_mos_v4_test`. `talo_app` đăng nhập đúng (current = session = `talo_app`). Trước khi chạy: chưa có `talo_audit_reader`, chưa có `audit_api`. | `precheck-identity.txt` |
| Không thay đổi ngoài manifest | Inventory trước khi chạy = inventory cuối phiên chuẩn bị | `inventory-before.txt` |

## 2. Thực thi (exit code)

| Bước | Lệnh | Exit | Kết quả |
|---|---|---|---|
| 01 | `psql -U admin -d postgres < 01-create-owner-role.sql` | 0 | `talo_audit_reader` NOLOGIN, không superuser / inherit / createrole / createdb / bypassrls |
| 02 | `psql -U admin -d talo_mos_v4_test < 02-…` | 0 | 4 GRANT (USAGE 2 schema, SELECT theo cột 3 bảng) |
| 03 | `psql -U admin -d talo_mos_v4_test < 03-…` | 0 | schema `audit_api`, 3 function, đổi owner, REVOKE PUBLIC, GRANT EXECUTE `talo_app` |

## 3. Postcheck

| Kiểm tra | Exit | Kết quả |
|---|---|---|
| 04 static verify (admin) | 0 | `SCC audit static verification: OK` |
| 05 app verify (talo_app, 24h) | 0 | FOUNDATION 0 dòng (sự kiện Foundation mới nhất 26/10, nằm ngoài cửa sổ — không phải lỗi); IAM 2; summary 0/0; SELECT thô bị chặn |
| 06 extended verify (talo_app) | 0 | FOUNDATION 31 ngày **501** (trần); IAM **148**; ISSUES 501; summary tại mốc mới nhất DENIED **11**; input sai 9/9 → `22023`; SELECT thô, `SET ROLE` → `42501`; không có CREATE; đúng 12 cột |
| Probe EXPLAIN `talo_app` — SCC 0.1.1 source | 0 | **21/21 OK** (trước migration: 18 OK + 3 × `3F000`) |
| Probe — release 0.1.0 đang chạy | 0 | 18 OK, `audit` vẫn `42501` (đúng dự kiến: 0.1.0 đọc bảng thô) |
| Role khác gọi hàm | — | `talo_iam_admin`, `talo_test_harness`: `permission denied for schema audit_api`; `admin`: `caller not allowed` |
| Service thật SCC 0.1.1 qua READ ONLY + timeout 5 s (talo_app) | 0 | 24h: `complete=true`, FOUNDATION + IAM **AVAILABLE**, 2 sự kiện (51 ms). 31 ngày: `complete=true`, trang 1 = 28 FOUNDATION + 22 IAM, `hasNext` (56 ms). ISSUES 31 ngày: 17 + 8 (27 ms). Diagnostics fleet / activity / audit **AVAILABLE** |

## 4. Không thay đổi ngoài manifest

- **Delta ACL thực tế = delta đã kiểm chứng trên bản sao cô lập**, so khớp từng dòng (26 dòng mới). Bằng chứng: `acl-delta-test.diff` = `acl-delta-isolated.diff`.
- Inventory sau khi chạy chỉ khác ở:
  - role `talo_audit_reader`;
  - USAGE của role này trên schema `foundation` / `iam`;
  - schema `audit_api`;
  - 3 function.
- Quyền của `talo_app` trên bảng audit **không đổi**: vẫn không có SELECT.
- `talo_audit_reader`: owner đúng 3 function, 0 bảng, 0 membership. `pg_default_acl` = 0.
- Dữ liệu: số dòng mọi bảng trước = sau (`rowcounts-after.txt`).
- Không chạm:
  - SCC trên TEST (0.1.0 ACTIVE, enabled);
  - journal `d6fa3a06…` (`RECOVERY_REQUIRED`, `updatedAt` 2026-10-24T07:08:38Z);
  - lock `module-deployments.json` (sha256 `d0835db3…`).

## 5. Rollback

Không cần chạy. Nếu chủ dự án muốn gỡ sau này:
- chạy `90-rollback-test-database.sql` (đã kiểm chứng trên bản sao: ACL trở về như trước, giữ role);
- `DROP ROLE talo_audit_reader` cần phê duyệt cluster riêng.

## 6. Ý nghĩa và giới hạn

- PostgreSQL đã cho phép SCC **0.1.1** đọc audit qua hàm giới hạn.
- Runtime TEST **vẫn chạy SCC 0.1.0**, nên màn Audit Logs trên giao diện chưa thay đổi. Release 0.1.0 vẫn trả `UNAVAILABLE` / `42501` cho đến khi cài 0.1.1.
- Chưa nghiệm thu HTTP/UI qua phiên đăng nhập thật.

## 7. Gate đề xuất tiếp theo (chưa thực hiện, cần phê duyệt riêng)

**DEPLOY / RESTART TEST:** khởi động lại Backend + Frontend với source hiện tại đã kiểm thử, gồm:
- route Installer `close-failed`;
- alias Host;
- UI Candidate Workspace mới.

Release 0.1.0 không đổi, nên runtime SCC vẫn 0.1.0. Sau đó mới đến **JOURNAL** (`close-failed` cho `d6fa3a06…`), rồi **INSTALLER 0.1.1**.
