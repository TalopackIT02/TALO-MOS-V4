# CLOSURE-D2 — IAM PostgreSQL privilege

Trạng thái: **PASS — không cần GRANT, không thực thi GRANT nào.**

## Nguyên nhân

`IAM_DB_GRANT_MISSING` trước đây là kết quả âm tính giả.

`writable()` dùng `has_table_privilege('iam.iam_permissions','INSERT')`, và hàm này trả false. Nhưng trên TEST, `talo_iam_admin` đã có sẵn quyền **mức cột** từ IAM-NEXT, và đó đúng là những quyền mà đường ghi thật cần:

- INSERT trên 6 cột của `iam_permissions`;
- SELECT trên `iam_permissions`;
- INSERT trên 6 cột của `iam_audit_logs`;
- SELECT trên `fnd_modules` và `fnd_module_versions`.

**Cách sửa** (`foundation.installer.iam.ts`): `writable()` nay kiểm `has_column_privilege` đúng các cột mà `createPermission()` và `mutation()` ghi hoặc đọc, trên chính kết nối của Installer.

## Kết nối thật của Installer

Kết quả lấy từ test DB, `$OUT/t-installer-db.log`:

| current_database | current_user | session_user |
|---|---|---|
| talo_mos_v4_test | talo_iam_admin | talo_iam_admin |

**Đường gọi:**
1. `ModuleInstallerService.continueInstall` → `IamCatalog.create`;
2. → `createIamCatalog(prismaFoundationDb(IAM_ADMIN_DATABASE_URL))`;
3. → `IamAdminRepository.authorize(iam.permissions.manage)`;
4. → `createPermission()`. Hàm này khóa advisory theo bộ K05, kiểm MIC-07 của bản ACTIVE với hash còn nguyên vẹn, kiểm trùng, rồi INSERT và ghi IAM audit.

## Script trong `database/scripts/iam-admin/`

| File | Nội dung | Đã chạy? |
|---|---|---|
| `10-installer-catalog-precheck.sql` | Identity, thuộc tính role, quyền cột cần có, quyền cấm, ACL (read-only) | Có, với role admin (`$OUT/d2-precheck-admin.txt`). Mọi quyền cần có = t; UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER / CREATE ON SCHEMA = f; rolsuper / bypassrls / createrole / createdb = f |
| `11-installer-catalog-grant.sql` | GRANT tối thiểu mức cột, có guard `talo_mos_v4_test` | **Không**: quyền đã có sẵn |
| `12-installer-catalog-postcheck.sql` | Fail (chia 0) nếu thiếu quyền cần có hoặc có quyền cấm | Có: `postcheck_ok = 1` (`$OUT/d2-postcheck-admin.txt`) |
| `13-installer-catalog-rollback.sql` | REVOKE INSERT mức cột | **Không**, và **không được chạy trên TEST**: các quyền này có trước task và IAM Management đang dùng |

**Báo cáo trước / sau:** không có thay đổi quyền nào. ACL trước và sau giống nhau, vì không có GRANT hay REVOKE nào được thực thi.

## Kiểm chứng qua IAM repository thật (DB TEST)

Test `foundation.installer.db.test.ts`. Installer nay chỉ dùng catalog thật; catalog test-only đã được gỡ.

| Ca | Kết quả |
|---|---|
| `writable()` | `true` (trước đây false) |
| K05 hợp lệ do Installer tạo | 2 dòng (ORDER.READ, ORDER.CREATE) |
| Module chưa ACTIVE | 422 `BINDING_INVALID`, 0 dòng |
| Sai K05 (ORDER/DELETE) | 422 `BINDING_INVALID` |
| Sai mức đảm bảo (READ cấp 2) | 422 `BINDING_INVALID` |
| Trùng (ORDER/READ) | 409 `PERMISSION_TRIPLE_EXISTS`, vẫn 2 dòng |
| Actor không có `iam.permissions.manage` | 403 |
| IAM audit | `IAM.PERMISSION.CREATE` SUCCESS = 2 (actor của run) |
| Tự gán quyền | Không. IAM_POLICY chỉ PASS sau khi test gán quyền cho role của chính fixture (harness, theo UUID) |

**Cleanup** (`[fmi-03]` evidence):
- `iamDeleted 2`: quyền K05 của run, xóa theo UUID sau khi gỡ role_permissions của role run;
- `remaining 0`;
- leftovers 0/0/0;
- IAM về 27/25/1/2.

## Cần chủ dự án quyết định

- Harness `AuthFixtures.cleanup()` có sẵn từ trước xóa `iam_audit_logs` của chính account fixture AUTHT-. Lượt này xóa 4 dòng, gồm cả 2 dòng audit `IAM.PERMISSION.CREATE` của actor fixture. Mục đích là gỡ được account (ràng buộc FK). Hành vi này chưa được thay đổi; xin quyết định có giữ hay không, so với nguyên tắc "không xóa IAM audit".
