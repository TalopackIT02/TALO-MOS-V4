# SCC 0.1.2 DATABASE ACCESS GATE — KẾT QUẢ

```
GATE:      SCC 0.1.2 DATABASE ACCESS (fnd_module_events, fnd_data_access_rules)
STATUS:    PASS
TARGET:    talo_mos_v4_test — container talo-mos-v4-postgres (127.0.0.1:5433), PostgreSQL 18.6, chạy bằng admin
APPROVAL:  chủ dự án, "SCC 0.1.2 DATABASE GATE APPROVAL", 28/10/2026, theo 11_SCC_012_DB_ACCESS_GATE_PACK.md
EXECUTED:  2026-10-28T07:58:32Z → 07:58:34Z (01 → 02 → 03)
EVIDENCE:  D:\Documents\ClaudeProject\TALO-MOS-V4_exports\SCC_012_DB_GATE_20261028-145728\  (evidence-sha256.txt, 47 file)
ROLLBACK:  90 + 91 đã chuẩn bị và kiểm thử trên bản sao; KHÔNG cần chạy
NEXT:      dừng tại SCC 0.1.2 INSTALLER-APPROVAL
```

Không restart / deploy. Không cài SCC 0.1.2. Không đổi lifecycle, IAM, dữ liệu. Không commit / push. Không đụng fixture FBET.

## 1. Precheck (trước khi ghi)

| Kiểm tra | Kết quả |
|---|---|
| SHA-256 của 8 file SQL so với hồ sơ §2 | **8/8 OK** (`sha256-check.txt`) |
| Mục tiêu | `talo_mos_v4_test`, PostgreSQL 18.6, cổng 127.0.0.1:5433 |
| Role `talo_foundation_reader` / schema `foundation_read_api` | chưa tồn tại |
| Kiểm kê phân quyền (06) | **Giống hệt** baseline trong hồ sơ, không có trôi lệch |
| SCC 0.1.1 | journal `8f22fc3b…` INSTALLED_ACTIVE; B02 0.1.1 ACTIVE; module bật |
| Audit qua `audit_api` (service 0.1.1, `talo_app`) | `complete=true`; 24 giờ: 15 sự kiện; 31 ngày: 50+; audit summary AVAILABLE |
| Smoke | 16/16 |

## 2. Backup và kiểm tra restore

| Mục | Giá trị |
|---|---|
| Database | `talo_test_before_scc012_db_20261028-145728.dump` (`pg_dump -Fc`), SHA-256 `d11e6476972a75132b5c686f45da112c9bcaa8962b0ffa3d97be437bf16a178d` |
| Globals | `globals_before_20261028-145728.sql` (`--no-role-passwords`), SHA-256 `c259832e19c8ec4d92a7b93e1a7643197d0b7ae62e88ed47f945e9dca30b5b5b` |
| Restore | Container tạm `postgres:18`: `pg_restore --exit-on-error` exit 0. Lỗi duy nhất ở globals: `role "admin" already exists` (dự kiến) |
| Đối chiếu | **25/25 bảng khớp số dòng**; kiểm kê phân quyền của bản restore giống TEST. Container đã hủy |

## 3. Thực thi SQL

| File | Exit | Kết quả |
|---|---|---|
| `01-create-owner-role.sql` (postgres) | 0 | `CREATE ROLE`, `COMMENT` |
| `02-grant-owner-test-database.sql` | 0 | 3 `GRANT` trong 1 transaction |
| `03-create-functions-test-database.sql` | 0 | Schema, 2 hàm, ALTER OWNER, REVOKE PUBLIC, GRANT EXECUTE, COMMENT; COMMIT |
| `04-verify-admin-read-only.sql` | 0 | **PASS 04**: thuộc tính role, không có thành viên, SECURITY DEFINER + owner + `search_path`, EXECUTE chỉ cho `talo_app`, schema không PUBLIC, `talo_app` không SELECT thô, reader chỉ đọc 2 bảng và không ghi |
| `05-verify-as-app-read-only.sql` (kết nối `talo_app` trực tiếp) | 0 | **PASS 05** (§4, §5) |
| `06` trước / sau | 0 / 0 | §6 |

## 4. SELECT qua hai hàm mới (`talo_app`, READ ONLY)

| Truy vấn | Qua hàm | Thực tế trong DB (admin) |
|---|---|---|
| `read_module_events`, 366 ngày, trang 1 | 101 (giới hạn trang) | 6746 sự kiện trong 366 ngày |
| `read_module_events`, offset 6700 | **46** | 6746 − 6700 = **46** |
| `read_module_events`, SCC, toàn bộ | **15** | B07 của SCC = **15** |
| `read_module_events`, SCC, `ENABLE` | **4** | **4** |
| Sự kiện mới nhất | `ENABLE` 2026-10-28T06:43:42.715371Z, `after_enabled=true` | ENABLE của Installer Gate 0.1.1 |
| `read_data_access_rules`, trang 1 | 101 (giới hạn trang) | 3926 quy tắc |
| `read_data_access_rules`, offset 3900 | **26** | 3926 − 3900 = **26** |
| Hình dạng kết quả | 12 cột text đã khai báo, **không có cột JSON** | — |

Thuộc tính hàm:
- Cả hai hàm: owner `talo_foundation_reader`, `prosecdef=true`, `search_path=pg_catalog`.
- ACL `{talo_foundation_reader=X, talo_app=X}`; `has_function_privilege('public', …, 'EXECUTE') = false`.
- Giới hạn dữ liệu: 10 đầu vào sai (NULL, `from > to`, cửa sổ 367 ngày, event type lạ hoặc NULL, limit 102, offset âm hoặc > 100000, rules limit 0, rules offset > 100000) → tất cả trả **22023**.

## 5. Từ chối SELECT trực tiếp

| Kiểm tra | Kết quả |
|---|---|
| `talo_app`: `SELECT … FROM foundation.fnd_module_events` | **42501** |
| `talo_app`: `SELECT … FROM foundation.fnd_data_access_rules` | **42501** |
| `talo_app`: `SET ROLE talo_foundation_reader` | **42501** |
| `has_table_privilege` / `has_any_column_privilege` SELECT của `talo_app` trên 2 bảng | `false` / `false` |

## 6. So sánh ACL và dữ liệu trước / sau

- **Phân quyền:** `diff(06 trước, 06 sau)` trên TEST **trùng khớp tuyệt đối** với delta đã duyệt (hồ sơ §3, đo trên bản sao).
  - Gồm: 1 role NOLOGIN; `USAGE foundation`; SELECT cấp cột 9 + 8 cột cho `talo_foundation_reader`; schema `foundation_read_api`; 2 hàm, EXECUTE cho `talo_app`.
  - Không có thay đổi nào khác (`privilege-delta-test.diff`).
- **IAM:** fingerprint `iam_permissions`, `iam_role_permissions`, B09, module và version khác **không đổi**. Không có role, quyền hay gán quyền người dùng mới.
- **`audit_api` 0.1.1:** `scc-audit-read/04` vẫn exit 0; hàm đọc audit vẫn trả dữ liệu (9 sự kiện Foundation trong 24 giờ).
- **Dữ liệu:** **25/25 bảng giữ nguyên số dòng**. Trạng thái SCC / B07 / B08 / B09 / module giữ nguyên.

## 7. SCC 0.1.1 vẫn hoạt động

| Kiểm tra | Kết quả |
|---|---|
| Journal / B02 / B01 | INSTALLED_ACTIVE / 0.1.1 ACTIVE / bật, không đổi |
| Lock `backend/module-deployments.json`, `.env` | `aaf14a2c…`, `82bd1f7d…` (không đổi) |
| Service audit 0.1.1 (`talo_app`, READ ONLY) sau gate | `complete=true`; 24 giờ 15, 31 ngày 50+, ISSUES 25; Diagnostics fleet / activity / audit AVAILABLE |
| Smoke | 16/16 |
| Log backend trong gate | 0 lần restart, 0 error, 0 `42501`, 0 phản hồi 5xx |

## 8. Kết luận

**SCC 0.1.2 DATABASE ACCESS GATE: PASS.**

TEST hiện có `foundation_read_api` sẵn sàng cho SCC 0.1.2. SCC 0.1.1 đang chạy không dùng các hàm này nên không bị ảnh hưởng.

**Dừng tại SCC 0.1.2 INSTALLER-APPROVAL.** Gói cài: `76003a14c0214718f370b014ac9ad9361fe7bd51d15d95bc731a152631096495`, hiện nằm trong worktree `TALO-MOS-V4-wt-scc012`. Hồ sơ Installer Gate cần chuẩn bị khi được yêu cầu, và phải xử lý hai điểm:
1. **Đưa gói 0.1.2 vào `modules/SYSTEM_CONTROLLER_CENTER` của thư mục runtime.** Việc này thay source 0.1.1 bằng 0.1.2. Release 0.1.1 vẫn được bảo toàn trong `module-releases`. Cần phê duyệt vì chạm vào thư mục runtime watch / HMR.
2. **Chạy quy trình Installer** như với 0.1.1: preflight READY → plan UPGRADE (điểm phục hồi 0.1.1 `e47e0084…`) → Commit → restart → Tiếp tục.

Rollback DB (nếu cần sau này): chạy `90` rồi `91` từ thư mục evidence (`sql/`), đúng SHA-256 đã duyệt. Trên bản sao, thao tác này đưa kiểm kê phân quyền về giống hệt baseline.
