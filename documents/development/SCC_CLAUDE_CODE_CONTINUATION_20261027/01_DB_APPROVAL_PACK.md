# DB-APPROVAL PACK — SCC Audit Read (talo_mos_v4_test)

**Trạng thái:** `PENDING OWNER APPROVAL`. Chưa có lệnh ghi nào chạy trên TEST.
**Phạm vi xin duyệt:**
- tạo 1 role cluster;
- trên `talo_mos_v4_test`: 1 schema, 3 function, các GRANT/REVOKE liệt kê ở §3.

**Không bao gồm:** Deploy, Journal/Lifecycle, Installer, Git, DEV/PROD, index, dữ liệu.

## 1. Nguyên nhân PostgreSQL chặn truy vấn

| Hiện tượng | Nguyên nhân đã đo | Bằng chứng |
|---|---|---|
| Audit Logs / Diagnostics audit: SQLSTATE `42501` | `talo_app` không có SELECT trên `foundation.fnd_audit_logs` (chỉ INSERT theo cột) và `iam.iam_audit_logs` (chỉ INSERT). Không có RLS. Lỗi ở **tầng PostgreSQL**, sau khi IAM đã cho phép. | `$EV/test-readonly-inventory.txt`, `$EV/test-sql-privilege-probe-0.1.0-runtime.json` |
| SCC 0.1.1 gọi `audit_api.*`: `3F000` | Schema/function chưa được tạo | `$EV/test-sql-privilege-probe-0.1.1-source.json` |
| Các câu SQL khác của SCC (18 câu: Admin gate, Diagnostics, Data Inspection catalog, Architecture, Access Matrix) | **Đủ quyền.** EXPLAIN với `talo_app` đều OK; không cần GRANT thêm | như trên |

**Quyết định giữ nguyên của Work:** không GRANT SELECT thô; dùng 3 hàm projection cố định. Phương án đạt yêu cầu khi kiểm lại nên **không thiết kế lại**.

## 2. Bộ SQL cuối cùng (giữ nguyên byte của Work + 1 file kiểm tra mới)

Thư mục `database/scripts/scc-audit-read/`. Bản sao giống hệt nằm trong `modules/SYSTEM_CONTROLLER_CENTER/database/`.

| File | Chạy với | DB | SHA-256 |
|---|---|---|---|
| `01-create-owner-role.sql` | `admin` (superuser) | `postgres` | `c26376142a6f665b8fb623ff0f55ecb28193f346ea0cf97e4999b60aa365e293` |
| `02-grant-owner-test-database.sql` | `admin` | `talo_mos_v4_test` | `539a45fb7e492ba2a8e8dca678273d3808f0302cbf413e2d334c6d4ae888a736` |
| `03-create-functions-test-database.sql` | `admin` | `talo_mos_v4_test` | `b37edea9dc3a723ebad02c22c733f659ad1877a4bdf817757a8bb60ce770105e` |
| `04-verify-admin-read-only.sql` | `admin` | `talo_mos_v4_test` | `d73eca6e8d4c7037d69c76f2c5ec370ef7d6e06feee1b9e25b0d44b2147a5d13` |
| `05-verify-as-app-read-only.sql` | `talo_app` | `talo_mos_v4_test` | `db308b775df7fda59b21e6db389f81ac648fb0d0ac68c877fe2cbca4e47a5a92` |
| `06-verify-extended-as-app-read-only.sql` *(mới)* | `talo_app` | `talo_mos_v4_test` | `0cf253e30e67a0442c2401738547b64ebaac0139199e903549cdf2380480caf0` |
| `90-rollback-test-database.sql` | `admin` | `talo_mos_v4_test` | `9054f06edf4644c73c16b1642f86245f894c37590ee7636d3e2aa2636e13e244` |

`DATABASE_MIGRATION.sql` của gói Phase 2 = 01 + 02 + 03 + 04 nối bằng `\connect`. Nội dung tương đương, nhưng chỉ chạy được bằng `psql`, không chạy được trong pgAdmin Query Tool. Đề xuất chạy **từng file** như §6.

## 3. Đối tượng và quyền thay đổi (delta đo được trên bản sao)

| Principal | Đối tượng | Quyền mới |
|---|---|---|
| `talo_audit_reader` (mới) | cluster | `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`, không membership |
| `talo_audit_reader` | schema `foundation`, `iam`, `audit_api` | USAGE |
| `talo_audit_reader` | `foundation.fnd_audit_logs` | SELECT 9 cột (event_id, actor_account_id, action_code, target_type, target_id, outcome, occurred_at, correlation_id, metadata) |
| `talo_audit_reader` | `iam.iam_audit_logs` | SELECT 8 cột |
| `talo_audit_reader` | `iam.iam_user_accounts` | SELECT (user_account_id, username) |
| `talo_audit_reader` | 3 function `audit_api.read_*` | owner (SECURITY DEFINER, `search_path=pg_catalog`) |
| `talo_app` | schema `audit_api` | USAGE (không CREATE) |
| `talo_app` | 3 function | EXECUTE |
| `PUBLIC` | schema / function `audit_api` | không có (REVOKE) |

**Không thay đổi:**
- quyền bảng/cột của `talo_app` trên bảng nguồn;
- quyền của mọi role khác;
- dữ liệu, schema `foundation`/`iam`;
- IAM assignment, B01/B02, journal.

## 4. Kết quả kiểm thử cô lập (27/10/2026)

**Môi trường:** container tạm `postgres:18` (PG 18.6, giống TEST), port `127.0.0.1:5499`.
- Dựng bằng `pg_dumpall --roles-only` (không mật khẩu) và `pg_dump` của TEST; với TEST chỉ thao tác đọc.
- Đã hủy container và dump tạm sau khi chạy.
- Log trong `$EV/isolated/`.

| Kiểm tra | Kết quả |
|---|---|
| 01 → 04 (exit 0) | PASS; 04: `SCC audit static verification: OK` |
| 05 bằng `talo_app` | PASS. Foundation **0 dòng / 24h** (đúng dữ liệu: mới nhất 2026-10-26); IAM 2; summary 0/0 |
| 06 bằng `talo_app` | Foundation 31 ngày: 501 dòng (chạm trần); IAM: 148; ISSUES: 501; summary tại mốc mới nhất: DENIED 11 |
| Input sai | 9/9 bị từ chối `22023` |
| Truy cập trái phép | Raw SELECT 2 bảng: `42501`; `SET ROLE talo_audit_reader`: `42501`; `talo_app` không có CREATE trên `audit_api` |
| Role khác gọi hàm | `talo_iam_admin`, `talo_test_harness`: `42501` (schema); `talo_foundation_owner`: không đăng nhập được; superuser `admin`: bị chặn bởi kiểm tra `session_user` |
| Shape kết quả | Đúng 12 cột; không có cột metadata |
| Hiệu năng | Foundation 31 ngày / 501 dòng: 53 ms; có filter: 20 ms; IAM: 1,8 ms |
| Probe EXPLAIN sau migration | SCC 0.1.1 **21/21 OK**; 0.1.0 audit vẫn `42501` |
| Service thật SCC 0.1.1 (READ ONLY + `SET LOCAL statement_timeout=5000`) | 24h: `complete=true`, hai nguồn AVAILABLE (2 IAM). 31 ngày: `complete=true`, 28 Foundation + 22 IAM ở trang 1, `hasNext`. Diagnostics audit AVAILABLE |
| 90 rollback | PASS. ACL sau rollback = trước migration, trừ role được giữ có chủ ý; `audit_api` → `3F000` |
| Áp dụng lại sau rollback | 01 dừng có chủ ý ("already exists"); 02 + 03 + 04 PASS |

## 5. Rủi ro và biện pháp

| Rủi ro | Mức | Biện pháp |
|---|---|---|
| Lỗ hổng SECURITY DEFINER | Thấp | Không dynamic SQL; object đầy đủ schema; `search_path=pg_catalog` (pg_temp không được dùng cho function/operator; mọi bảng đều qua schema); EXECUTE chỉ cho `talo_app`; owner NOLOGIN, không membership |
| `talo_app` dùng chung | Trung bình | Mọi code chạy bằng `talo_app` đều gọi được 3 hàm. Hàm tự giới hạn: 31 ngày, 501 dòng, filter đóng, không trả metadata thô. SCC Administrator Gate + IAM K05 + lifecycle vẫn bắt buộc ở Backend |
| Timeout | — | `SET statement_timeout='5s'` trong định nghĩa hàm **không** giới hạn chính lời gọi đó (đã thử: thân hàm ngủ 3s vẫn chạy hết). Giới hạn 5s thực tế đến từ `SET LOCAL statement_timeout = 5000` của Module Host. Giữ khai báo trong hàm (vô hại, 04 kiểm tra), không dựa vào nó |
| Filter `p_action` | Thấp | ILIKE coi `_` là wildcard 1 ký tự, có thể khớp rộng hơn một chút trong cùng cột `action_code`; `%` và dấu nháy bị chặn |
| Hiệu năng `fnd_audit_logs` (không có index `occurred_at`) | Thấp hiện tại | 14.559 dòng: 53 ms. Không thêm index trong gate này |
| Phạm vi cluster | Lưu ý | `CREATE ROLE` ở cấp cluster. Rollback **giữ** role; `DROP ROLE` cần phê duyệt riêng |
| TEST container | Quan sát | `pg_hba` cho phép `trust` qua socket nội bộ container. Không thay đổi trong gate này |
| 0.1.0 không hưởng lợi | — | Release 0.1.0 vẫn đọc bảng thô (42501). Audit chỉ hoạt động sau khi cài 0.1.1 (gate Installer) |

## 6. Chuỗi thực thi đề xuất (chỉ sau phê duyệt)

```
# 0. Sao lưu và chụp trước (read-only)
docker exec talo-mos-v4-postgres pg_dump -U admin -d talo_mos_v4_test -Fc > <exports>/talo_test_before_scc_db_<ts>.dump
docker exec talo-mos-v4-postgres pg_dumpall -U admin --roles-only --no-role-passwords > <exports>/roles_before_<ts>.sql
docker exec -i talo-mos-v4-postgres psql -U admin -d talo_mos_v4_test -X < $EV/acl-snapshot-read-only.sql > <exports>/acl-before.txt
# 1. Migration (ON_ERROR_STOP trong từng file; guard đúng database)
docker exec -i talo-mos-v4-postgres psql -U admin -d postgres          -X < database/scripts/scc-audit-read/01-create-owner-role.sql
docker exec -i talo-mos-v4-postgres psql -U admin -d talo_mos_v4_test  -X < database/scripts/scc-audit-read/02-grant-owner-test-database.sql
docker exec -i talo-mos-v4-postgres psql -U admin -d talo_mos_v4_test  -X < database/scripts/scc-audit-read/03-create-functions-test-database.sql
# 2. Verify
docker exec -i talo-mos-v4-postgres psql -U admin    -d talo_mos_v4_test -X < database/scripts/scc-audit-read/04-verify-admin-read-only.sql
docker exec -i talo-mos-v4-postgres psql -U talo_app -d talo_mos_v4_test -X < database/scripts/scc-audit-read/05-verify-as-app-read-only.sql
docker exec -i talo-mos-v4-postgres psql -U talo_app -d talo_mos_v4_test -X < database/scripts/scc-audit-read/06-verify-extended-as-app-read-only.sql
cd backend && npx tsx --env-file=../.env scripts/scc-sql-privilege-probe.ts        # kỳ vọng 21/21 OK
# 3. Chỉ khi 04/05/06/probe FAIL: rollback rồi đối chiếu ACL
docker exec -i talo-mos-v4-postgres psql -U admin -d talo_mos_v4_test -X < database/scripts/scc-audit-read/90-rollback-test-database.sql
```

**Tiêu chí PASS:**
- 04 in `OK`;
- 05 / 06 exit 0;
- 06: Foundation 31 ngày > 0, IAM > 0, 9/9 `22023`;
- probe 21/21 OK;
- inventory: `talo_app` vẫn không có SELECT bảng audit.

**Đánh dấu DB PASS chỉ sau khi chạy thật trên TEST.**

## 7. Câu phê duyệt đề nghị

> PHÊ DUYỆT DB: cho phép Claude Code chạy §6 bước 0–2 (và bước 3 nếu FAIL) trên `talo_mos_v4_test` + tạo role cluster `talo_audit_reader`, đúng 7 file có SHA-256 ở §2. Không bao gồm Deploy / Journal / Installer / Git.
