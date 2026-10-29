# CM_FOUNDATION_PREFLIGHT_REPORT

**Task:** CM-DB-PREFLIGHT-001
**Mode:** READ-ONLY
**Date/time:** 2026-10-29, khoảng 10:45–11:05 (+07:00). Truy vấn catalog chạy lúc `2026-10-29T03:57:20Z`.
**Repository path / branch / HEAD:** `D:/Documents/ClaudeProject/TALO-MOS-V4` · `feat/iam-admin-inheritance-20261024` · `439cba578861fd8afa20824e7f7cf2f3c69d0aae` ("Ship SCC 0.1.2 controlled data access"). `main` = `fafc4d5`.
**Database target:** PostgreSQL 18.6 · database `talo_mos_v4_test` · host loopback `127.0.0.1:5433` · role `talo_app`. Đây là role runtime, có quyền tối thiểu. Mật khẩu và DSN đã che.
**Phạm vi truy cập thực tế:**
- Đọc source, tài liệu repo và thư mục export ngoài repo `TALO-MOS-V4_exports`.
- Đọc catalog PostgreSQL trên TEST trong phiên `default_transaction_read_only=on` + `BEGIN READ ONLY`, có guard `current_database()='talo_mos_v4_test'` và kết thúc bằng `ROLLBACK`.
- Không truy cập DEV hoặc PROD. Không đọc dòng dữ liệu nghiệp vụ nào.

**Overall:** `PARTIAL`
- Về vật lý, 27 bảng chưa tồn tại nên không có va chạm tên.
- Tuy vậy, có các điểm CONFLICT/OPEN_DECISION mang tính kiến trúc:
  - Foundation **không** tạo hoặc migrate bảng nghiệp vụ.
  - Thiết kế chưa chỉ định schema.
  - `public` không dùng được cho `talo_app`.
  - Master Data chưa có chủ sở hữu.
  - Quy ước cột hệ thống khác hiện trạng.
- Thiết kế **không** được coi là APPROVED.

---

## 1. Executive summary

1. **Kết luận chắc chắn (TEST):** chỉ có 4 schema ứng dụng:
   - `iam` (11 bảng);
   - `foundation` (14 bảng `fnd_*`);
   - `audit_api` và `foundation_read_api` (chỉ có function).

   Không có bảng Customer/CRM/Master Data nào (Q03, Q14 = 0 dòng; `pg_class` không bị lọc theo quyền). Vì vậy **27/27 bảng = NEW** trên TEST; không có bảng nào REUSE được.
2. **Foundation không quản lý DDL nghiệp vụ.**
   - Installer/preflight chỉ kiểm tra bảng MIC-06 *đã tồn tại và `talo_app` SELECT được*. `DIRECT_DB` bị gắn cờ "cần phê duyệt riêng" (`backend/src/modules/foundation/foundation.preflight.ts:381-397`, `:389`).
   - DDL hiện được triển khai bằng **gói SQL do chủ dự án duyệt và tự chạy**: role admin + `SET LOCAL ROLE <owner>`, manifest SHA-256, backup `pg_dump -Fc`, script rollback `90/91-*`.
   - Điều này mâu thuẫn với giả định trong `00_SCOPE_FREEZE.md:L4` ("Foundation quản lý trực tiếp cấu trúc DB và cơ chế thay đổi") → **CONFLICT F07**.
3. **Prisma chỉ dùng cho introspection/client, và chỉ cho schema `iam`.**
   - `schema.prisma:18-21` khai báo `schemas = ["iam"]`.
   - Cấm `prisma migrate`/`db push` (`backend/prisma.config.ts:7-8`, `database/prisma/README.md:7-10`).
   - Foundation truy cập DB bằng SQL thuần (`foundation.repository.ts:92`).
4. **Quy ước hiện hành (quan sát, không phải chuẩn được ban hành chung):**
   - PK `uuid DEFAULT gen_random_uuid()` có tên `<entity>_id`; không cần extension (PG 18; chỉ có `plpgsql`).
   - Tên ràng buộc trong Foundation: `pk_/fk_/uq_/ck_fnd_<table>_<cols>`; FK luôn `ON DELETE RESTRICT`.
   - Tham chiếu tài khoản IAM dùng cột `*_account_id uuid` **không có FK** (0 FK từ schema khác vào `iam`).
   - **Không** bảng nào có `row_version`, `created_by` hoặc `updated_by`.
5. **Quyền DB khác quyền IAM.**
   - `talo_app` không có CREATE trên DB/schema và không có USAGE trên `public`.
   - Ghi dữ liệu Foundation qua **GRANT INSERT/UPDATE cấp cột**.
   - Cột "SELECT" trên UI Data Inspector là `has_column_privilege` của `talo_app`, không phải quyền IAM của người dùng.
6. **Chưa xác minh:** DEV/PROD; chính sách lưu file/tài liệu; owner Master Data; danh sách bảng của dự án khác (V2/V3).
7. **Zero-change:** không sửa file trong repo, không DDL/DML/GRANT, không commit (xem §8).

---

## 2. Source inventory / Git

| Hạng mục | Giá trị | Nguồn bằng chứng | Kết quả |
|---|---|---|---|
| Repo root | `D:/Documents/ClaudeProject/TALO-MOS-V4` | `git rev-parse --show-toplevel` | PASS |
| Branch/HEAD | `feat/iam-admin-inheritance-20261024` @ `439cba5`. Worktree phụ `TALO-MOS-V4-wt-scc012` @ `0e491a3` | `git rev-parse HEAD`, `git worktree list` | PASS |
| Worktree status | Chỉ có `?? documents/database-design/TALO_MOS_CM_DB_PREFLIGHT_v0_1/` (gói đầu vào do User đặt vào, untracked). Không có file tracked nào bị sửa | `git status --short` (trước và sau khảo sát) | PASS |
| Gói đầu vào | 12/12 file khớp `MANIFEST_SHA256.txt` | `sha256sum` | PASS |
| CLAUDE.md rules | Ranh giới 1–7: `documents/` chỉ đọc; không đổi cấu trúc DB/SQL/Prisma/dữ liệu; không migration/seed/GRANT khi chưa duyệt | `CLAUDE.md:L14–L21` | PASS |
| AUTH-CONTEXT | "IAM v0.3 bất biến; DB dev tuyệt đối không đụng; test DB là `talo_mos_v4_test`"; role `talo_app`/`talo_provisioner`/`talo_test_harness`; CAS trên `updated_at`. Snapshot ngày 2026-10-14, phần HIBP đã bị thay thế | `AUTH-CONTEXT/00-START-HERE.md:L3, L22–L24` | PASS (tham khảo) |
| Foundation DB Baseline v1.0 | **ĐÃ PHÊ DUYỆT 16/10/2026**: 14 bảng `foundation.*`, K01–K12, 30 quyết định | `documents/development/TALO-MOS-V4_Foundation_Database_Baseline_v1.0_FOR_CLAUDE.md:L1–L9, L315–L421` | ACTIVE |
| IAM v0.3 Decision Record | Nghiệp vụ Account/Role đã xác nhận 12/10/2026. "chưa phê duyệt thực thi DDL" là trạng thái ban đầu; thực tế đã deploy trên TEST | `documents/database-design/IAM&Sercurity/TALO-MOS-IAM-v0.3-Decision-Record.md:L1–L5` | ACTIVE (nghiệp vụ) |
| Governance docs | `AI-START-HERE`, `GOV-00`, `DAT-05`, `IAM-04`, `MOD-03`, `DEV-07`, ... đều là **DRAFT v0.1 — CHƯA PHÊ DUYỆT** | `documents/development/TALO_MOS_V4_AI_Governance_MD_v0_1/TALO_MOS_V4_AI_Governance_MD_v0_1/DAT-05.md:L9, L15`; `TALO_MOS_V4_AI_Governance_Master_v0_1.md:L3` | DRAFT (chỉ tham khảo) |
| Gói CM preflight | **DRAFT / THIẾT KẾ ĐỀ XUẤT / CHƯA TRIỂN KHAI** | `TALO_MOS_CM_DB_PREFLIGHT_v0_1/README.md:L5` | DRAFT |

---

## 3. Runtime DB & Foundation (F01–F20)

| F-ID | Yêu cầu | Kết quả | Bằng chứng cụ thể | Ảnh hưởng CM |
|---|---|---|---|---|
| F01 | Working tree / branch / commit | PASS | §2 | HEAD là nhánh feature, chưa merge `main` (`fafc4d5`). Gói SQL sau này cần ghi rõ baseline commit |
| F02 | CLAUDE.md, AUTH-CONTEXT, IAM | PASS | §2 | Mọi DDL/GRANT cho CM cần gate riêng |
| F03 | Driver/ORM, phiên bản PG | PASS | `backend/package.json:L27–L41`: `@prisma/client` 7.10.0, `@prisma/adapter-pg` 7.10.0, `pg` 8.23.1. `schema.prisma:L18–L21` chỉ có `schemas=["iam"]`. Foundation dùng SQL thuần (`foundation.repository.ts:92`). Q01: `server_version` 18.6 | Bảng CM sẽ **không** xuất hiện trong Prisma nếu không re-introspect (quy trình ở `database/prisma/README.md:L58–L70`). Cần quyết định: Prisma hay SQL thuần cho CM (D-CM-09) |
| F04 | DB/schema/search_path | PASS | Q01: `talo_mos_v4_test`, `search_path="$user", public`. Q02 liệt kê 5 schema `audit_api`, `foundation`, `foundation_read_api`, `iam`, `public`. Q09: `talo_app` USAGE trên `public` = **false** | Không được để bảng CM/Master ở `public` mà không có gate quyền. Mọi truy vấn phải ghi rõ schema |
| F05 | Bảng liên quan Customer/Master + FK | NOT_FOUND | Q03 có 25 bảng (14 `foundation`, 11 `iam`). Q14 (regex `cust/crm/client/partner/countr/admin_unit/province/region/bank/currenc/industr/ref_/lookup/master/contact/address/payment/tax/document/file`) = 0 dòng. Q18 sequence = 0 | 27 bảng NEW |
| F06 | Quy ước tên | PASS (quan sát) | Q04/Q05/Q06. Foundation: `pk_fnd_<t>`, `fk_fnd_<t>_<col>`, `uq_fnd_<t>_<cols>`, `ck_fnd_<t>_<rule>`; PK `<entity>_id uuid`; `created_at timestamptz NOT NULL DEFAULT now()`. IAM: `<t>_pkey`, `fk_<t>_<col>`, `uq_iam_*`, `ix_iam_*`. Không bảng nào có cột tên `id` hoặc `code` | Thiết kế CM dùng `id`, `code`, `created_by` → **lệch quy ước** (D-CM-04, D-CM-05) |
| F07 | Foundation tạo bảng mới bằng workflow nào? | **CONFLICT** | `foundation.preflight.ts:L20, L381–L397`: P5a chỉ chạy `to_regclass` + `has_table_privilege(...,'SELECT')`; `DIRECT_DB` → issue "cần phê duyệt riêng" (`:389`). Installer `foundation.installer.service.ts:L494` (WRONG_DB_TARGET). Baseline B10: "Không tự tạo bảng/column từ contract_spec" (`Baseline:L232`). Thực tế, DDL Foundation trên TEST được tạo bằng gói ngoài `TALO-MOS-V4_exports/FBE-01B-DB/03-foundation-deploy-test.sql` (`FBE01B-MANIFEST.md:L20`) | Bảng CM phải tạo bằng **DB Gate riêng** (gói SQL + manifest + backup + rollback). Không thể "đăng ký qua Foundation" để sinh bảng |
| F08 | Ràng buộc cấm đổi bảng/cột, mở schema | PASS | Baseline `L6, L9, L417–L421`. `FMI-02-03.../07_SECURITY_AND_GATES.md:L7`. `FOUNDATION-REV-01.../02_NON_NEGOTIABLE_GUARDS.md:L23, L44`. `10_DATA_AND_SECURITY.md:L20`. `CLAUDE.md:L16, L18` | Tạo schema mới cho CM là thay đổi protected → cần phê duyệt |
| F09 | Migration runner / preflight / checksum / rollback | PASS (thủ công, không có runner) | `database/prisma/migrations/` rỗng có chủ đích (`README.md:L10`). Gói số hóa `01-preflight…`, `03-deploy…`, `04-verification…`, `05-runtime-grants…`, `90/91-rollback…` (`FBE-01B-DB/`, `database/scripts/{foundation-f1,scc-audit-read,iam-admin,...}`). Backup `pg_dump -Fc` + `pg_restore --list` + hash (`F2-DB-GATE4-PREP-01/GATE4-PREFLIGHT-AND-BACKUP-RUNBOOK.md:L111–L132`). Guard DB/role trong SQL (`GATE4-FOUNDATION-DEPLOY-CANDIDATE.sql:L24–L40`) | Gói SQL CM nên theo cùng mẫu (đề xuất, chờ quyết định D-CM-02) |
| F10 | Định danh actor IAM | PASS | `iam.iam_user_accounts.user_account_id uuid` PK (Q04; `database/sql/...v0.3.sql:L35–L36`). `membership_id` trên TEST là **NULLABLE** (Q04; `schema.prisma:L164`; commit `aa14098` IAM Phase C), trong khi file SQL v0.3 trong repo ghi `NOT NULL` (`:L37`) → drift có phê duyệt (Phase C). Foundation dùng `created_by_account_id`, `submitted_by_account_id`, `actor_account_id`… **không FK** (Q05: 0 FK vào `iam`). Baseline quyết định 07: "không thêm FK vào IAM" (`L324`) | `created_by/updated_by/changed_by/assigned_by` của CM nên tham chiếu logic `user_account_id`. FK vật lý vào `iam` trái tiền lệ (D-CM-03) |
| F11 | Module Registry → Function → Action, MIC | PASS | Baseline MIC-01..10 (`L384–L394`). MIC-06 `mic06DataResources{resourceKey, interfaceKind, schema, table}` (`foundation.preflight.ts:L384–L386`). Package `TALO-MODULE-PACKAGE-1` (`modules/SYSTEM_CONTROLLER_CENTER/module.json`). K01 key `^[A-Z][A-Z0-9_]*$` (Q05 `ck_fnd_modules_module_key_format`) | Module CM tương lai phải khai báo MIC-06 cho 21 bảng CM (+ Master nếu dùng). Ngoài phạm vi tiền kiểm này |
| F12 | Permission UI vs GRANT | PASS | Q08/Q20: `talo_app` chỉ có `r` cấp bảng trên `foundation`, INSERT/UPDATE **cấp cột**; không SELECT `fnd_audit_logs`/`fnd_module_events`/`fnd_data_access_rules` (đọc qua function SECURITY DEFINER `audit_api.*`, `foundation_read_api.*`, Q15/Q21). Owner schema `foundation` = `talo_foundation_owner` (NOLOGIN, Q10). UI "SELECT" = `has_column_privilege` của role API (`modules/SYSTEM_CONTROLLER_CENTER/backend/data-inspector.sql.ts:L9, L47`). IAM permission là `module_code/resource_code/operation` (`database/sql/...v0.3.sql:L121–L130`; K05 `Baseline:L375`) | Phải thiết kế riêng: owner role CM, GRANT cột cho `talo_app`, permission IAM (D-CM-01, D-CM-08) |
| F13 | Audit / soft delete / retire / row version | PASS (quan sát) | Q04: không có `row_version`, `updated_by`, `created_by`, `is_hidden`, `deleted_at`. `retired_at` chỉ có ở `fnd_functions`/`fnd_actions` (K09 `L379`). `updated_at NOT NULL` ở `fnd_modules` (backend cập nhật, K03 `L373`, không trigger; Q16 = 0 trigger). IAM: `disabled_at`/`revoked_at`; CAS dùng `updated_at` (AUTH-CONTEXT `L24`). Audit ứng dụng chung `foundation.fnd_audit_logs` (append-only, `talo_app` chỉ INSERT) | `row_version`, `created_by/updated_by`, `is_hidden` của CM là **mới so với hệ thống**. Cần quyết định (D-CM-05, D-CM-06) |
| F14 | Danh mục sẵn có | NOT_FOUND | Q14 = 0 | 6 Master + 10 lookup đều NEW. Chưa có chủ sở hữu (D-CM-07) |
| F15 | UUID generator, extension | PASS | Q07: chỉ có `plpgsql 1.0`. Mọi PK `DEFAULT gen_random_uuid()` (Q04). PG 18 có sẵn hàm core này | Không cần extension. D07 của gói CM có thể đóng theo tiền lệ, chờ xác nhận |
| F16 | Code Customer/CRM cũ | NOT_FOUND | `grep -i "customer\|crm\|sales_order"` trên `backend/src`, `frontend/src`, `modules`, `database` chỉ thấy ví dụ placeholder "SALES_ORDER" (`foundation.module-scan.validation.ts:122`, `frontend/src/pages/foundation/ModuleScreen.tsx:207,210`) | Không có xung đột code |
| F17 | Approver / installer / DB migration | PASS | Installer gate `READY` → install, chặn sai DB (`installer.service.ts:L494, L783`). Không chạy SQL tùy ý (`07_SECURITY_AND_GATES.md:L13`). DB gate do chủ dự án chạy (FBE-*, SCC_DB_GATE_*) | DB Gate CM tách khỏi Installer Gate của module CM |
| F18 | PROD/TEST, kết nối hiện tại | PASS | `.env` (đã che): `DATABASE_URL` → `talo_app@127.0.0.1:5433/talo_mos_v4_test`; `IAM_ADMIN_DATABASE_URL` → `talo_iam_admin`, cùng DB. Q12: `talo_app` không có CREATE/TEMP trên DB | Không có PROD trong cấu hình. DEV `talo_mos_v4_dev` không được truy cập (theo AUTH-CONTEXT L22) |
| F19 | Lưu file/PDF, dữ liệu nhạy cảm | NOT_FOUND | Không thấy chính sách storage/upload trong `documents/**/*.md` (grep `storage_key/upload/object storage`). DAT-05 (DRAFT) `L51, L57`: không ghi dữ liệu nhạy cảm plaintext vào audit | `cm_customer_documents.storage_key` chưa có backend/kho lưu trữ đích. `account_number`, `tax_number`, phone/email là PII (D-CM-12) |
| F20 | Mapping 27 bảng | PASS | §5 | — |

---

## 4. Schema inventory liên quan (TEST, metadata)

| Existing schema.table | PK type | FK/Constraints | Tương đồng với CM | Quyết định | Bằng chứng |
|---|---|---|---|---|---|
| `iam.iam_user_accounts` | `user_account_id uuid` (`iam_user_accounts_pkey`) | FK `membership_id` → `iam_memberships`; `ck_account_status` (PENDING_MEMBERSHIP/PROVISIONED/ACTIVE/LOCKED/DISABLED); `ck_account_membership_state` | Đích logic cho `created_by/updated_by/changed_by/assigned_by` | REUSE (logic, không FK) | Q04, Q05 |
| `iam.iam_memberships` | `membership_id uuid` | `uq_iam_membership_employee`, `uq_iam_membership_code` | Nhân sự, không phải tài khoản; không dùng làm actor | — | Q04–Q06 |
| `iam.iam_permissions` | `permission_id uuid` | `uq_iam_permission_code` (lower) | Đăng ký quyền CM (`module_code`=CUSTOMER…) qua IAM Admin | REUSE (cơ chế) | Q04, SQL v0.3 L121 |
| `foundation.fnd_audit_logs` | `audit_id uuid` | `uq_fnd_audit_logs_event_id`; `talo_app` chỉ INSERT 13 cột | Audit kỹ thuật dùng chung. **Không** thay `cm_customer_status_history`/`cm_customer_activities` (đúng `01:L156`) | REUSE (audit ứng dụng) | Q05, Q20 |
| `foundation.fnd_modules` / `fnd_data_contracts` / `fnd_data_fields` | uuid | `ck_fnd_data_contracts_direct_db_target`, `interface_kind` ∈ API/VIEW/EVENT/DIRECT_DB | Đăng ký module CM + hợp đồng dữ liệu cho các bảng CM | REUSE (registry) | Q05 |
| `foundation.fnd_navigation_items` | `navigation_id uuid` | Self-FK `parent_id`, `ck_..._not_own_parent`; chống vòng làm ở backend | Tiền lệ cho `cm_customer_groups.parent_group_id` (C09) | Tham chiếu mẫu | Q05; Baseline B09 L207 |
| Bảng Customer / Master Data | — | — | — | Không tồn tại | Q14 = 0 |

Role trên TEST (Q10): `admin` (superuser), `talo_app`, `talo_iam_admin`, `talo_provisioner`, `talo_test_harness` (LOGIN); `talo_foundation_owner`, `talo_foundation_reader`, `talo_audit_reader`, `talo_credential_recovery`, `talo_iam_account_owner`, `talo_iam_lifecycle_owner` (NOLOGIN). Q11: không có membership role. Q13: không có default privileges.

---

## 5. Mapping 27 bảng đề xuất

Quy ước cho bảng dưới đây:
- "NEW" = không tồn tại trên `talo_mos_v4_test` (Q03/Q14, `pg_class` đầy đủ). DEV/PROD = NOT_VERIFIED.
- Mọi bảng đều có **chưa chỉ định schema** (D-CM-01). Điểm này không lặp lại ở từng dòng.

| Bảng trong thiết kế | Loại | Trạng thái | Bảng đích hiện có nếu REUSE | Sai khác kiểu/nullable/keys so với quy ước hiện hành | Source |
|---|---|---|---|---|---|
| cm_customers | CM | NEW | — | (a) PK `id` ≠ quy ước `<entity>_id` (vd `customer_id`); FK con trỏ `cm_customers.id`. (b) `status_code`/`entity_type_code`/`source_code`/`industry_code` FK tới PK `code` varchar(30) của lookup; Foundation thể hiện enum bằng CHECK (`ck_fnd_*`), không có bảng lookup → mẫu mới. (c) `sales_region_id` FK → `ref_business_regions.id` (Master chưa có owner/schema). (d) `is_hidden` + `retired_at` + `status_code` chồng ngữ nghĩa (03 L53). (e) Sinh `customer_code`: không có sequence nào (Q18) (D06) | 01 L20–L38; Q04/Q05/Q18 |
| cm_customer_legal | CM | NEW | — | PK=FK `customer_id` (1–0..1) hợp lệ. `tax_country_code char(2)` FK → `ref_countries`. Không UNIQUE `tax_number` (D05). `representative_phone`, `tax_number` là dữ liệu nhạy cảm | 01 L40–L58 |
| cm_customer_contacts | CM | NEW | — | `email varchar(254)` khác `iam_account_verifications.email varchar(320)`, chỉ để lưu ý vì không bắt buộc đồng bộ. C03 partial unique index: Foundation đã có tiền lệ partial UNIQUE (Gate4 L11). CHECK "phone hoặc zalo_phone" chưa ghi thành constraint (01 L78) | 01 L60–L78 |
| cm_customer_addresses | CM | NEW | — | `country_code` NOT NULL FK → `ref_countries` (chưa có) → bảng này **phụ thuộc cứng** Master. `admin_unit_id` FK → `ref_admin_units`. C06 partial unique | 01 L80–L100 |
| cm_customer_payments | CM | NEW | — | `currency_code char(3)` NOT NULL FK → `ref_currencies` (chưa có) + DEFAULT 'VND' phụ thuộc seed. CHECK `payment_term_days >= 0` theo tiền lệ `ck_*` | 01 L102–L119 |
| cm_customer_banks | CM | NEW | — | `bank_code` NOT NULL FK → `ref_banks` (chưa có). `account_number` là PII cần che khi log/export (DAT-05 DRAFT L51) | 01 L121–L137 |
| cm_customer_status_history | CM | NEW | — | `changed_by uuid` → tham chiếu logic `iam.iam_user_accounts.user_account_id`, không FK (tiền lệ `actor_account_id`). Append-only: tiền lệ Foundation là chỉ GRANT INSERT, không trigger | 01 L139–L156 |
| cm_customer_activities | CM | NEW | — | `source_event_key` uniqueness chưa có contract (D12). `source_module_code varchar(50)` khác `fnd_modules.module_key varchar(80)` → nếu chứa module_key thì có thể bị cắt (D-CM-10) | 01 L158–L177 |
| cm_customer_documents | CM | NEW | — | `sha256 char(64)`: tiền lệ có CHECK format `^[0-9a-f]{64}$` (`ck_fnd_*_hash_format`). Không có kho file/policy (F19) | 01 L179–L196 |
| cm_customer_groups | CM | NEW | — | Self-FK `parent_group_id`. C09 chống vòng: tiền lệ là CHECK self-parent + backend, không trigger (Baseline B09, K03) | 01 L198–L212 |
| cm_customer_group_members | CM | NEW | — | PK kép giống tiền lệ `iam_role_permissions`. `assigned_by` → logic `user_account_id`. Lịch sử ngừng/tái liên kết (D11): tiền lệ IAM dùng `revoked_at` + partial unique (`uq_iam_user_active_role`) thay cho PK kép | 01 L214–L225 |
| cm_ref_customer_status | Lookup | NEW | — | PK `code varchar(30)`, mẫu lookup mới với hệ thống. Có cả `is_active` lẫn `retired_at` (D10). Seed PROSPECT/NEW/ACTIVE/PAUSED/CLOSED là DML, cần gate riêng | 02 L5–L34 |
| cm_ref_entity_types | Lookup | NEW | — | Như trên. Seed COMPANY/PERSON | 02 |
| cm_ref_contact_roles | Lookup | NEW | — | Như trên. Mã seed chưa xác định | 02 |
| cm_ref_address_types | Lookup | NEW | — | Như trên. Mã seed chưa xác định | 02 |
| cm_ref_payment_methods | Lookup | NEW | — | Như trên. Seed BANK_TRANSFER/CASH/OTHER | 02 |
| cm_ref_activity_types | Lookup | NEW | — | Như trên. Mã seed chưa xác định | 02 |
| cm_ref_activity_statuses | Lookup | NEW | — | Như trên. Seed PLANNED/IN_PROGRESS/DONE/CANCELLED | 02 |
| cm_ref_document_types | Lookup | NEW | — | Như trên. Mã seed chưa xác định | 02 |
| cm_customer_sources | Lookup | NEW | — | Tên không theo tiền tố `cm_ref_` như 8 lookup còn lại (chỉ lưu ý) | 02 |
| cm_customer_industries | Lookup | NEW | — | Không có danh mục ngành dùng chung để REUSE (Q14). Tên lệch tiền tố `cm_ref_`. 02 L107 yêu cầu data owner (D04) | 02 |
| ref_countries | Master | NEW | — | Không tồn tại. **Chưa có schema/owner/module sở hữu**; 02 L103 cấm gắn ownership vào Customer | 02 L38–L45 |
| ref_admin_units | Master | NEW | — | Không tồn tại. Có `valid_from/valid_to` (date), khác mẫu `retired_at timestamptz`. Owner chưa rõ | 02 L47–L60 |
| ref_business_regions | Master | NEW | — | Không tồn tại. Owner chưa rõ | 02 L62–L72 |
| ref_region_members | Master | NEW | — | Không tồn tại. PK kép | 02 L74–L80 |
| ref_banks | Master | NEW | — | Không tồn tại. Cần data owner (02 L107) | 02 L82–L90 |
| ref_currencies | Master | NEW | — | Không tồn tại. `decimal_places smallint CHECK >= 0` | 02 L92–L100 |

**Tổng:** NEW 27 · REUSE 0 · CONFLICT 0 ở mức bảng · UNKNOWN 0 trên TEST.

Các CONFLICT nằm ở **mức kiến trúc/quy trình**, không ở mức bảng:
- F07: Foundation không tạo DDL.
- D-CM-01: schema chưa chỉ định; `public` không dùng được.
- D-CM-04/05: lệch quy ước tên cột.

DEV/PROD: UNKNOWN cho cả 27 bảng.

---

## 6. Đối chiếu tên, kiểu và quyền

- **Tên schema/namespace:**
  - Hiện có `iam`, `foundation`, `audit_api`, `foundation_read_api`. Mỗi miền có schema riêng và owner riêng.
  - `public` thuộc `pg_database_owner`, `talo_app` không có USAGE.
  - Thiết kế CM **không nêu schema** → OPEN (D-CM-01).
- **Khóa IAM chính:** `iam.iam_user_accounts.user_account_id uuid` (actor). Metadata: PK `iam_user_accounts_pkey`, default `gen_random_uuid()`.
- **Có thể gắn FK user audit?**
  - Về kỹ thuật thì được, nhưng tiền lệ đã duyệt là **không FK vào IAM**: Baseline quyết định 07, `L324`; 0 FK vào `iam` (Q05).
  - FK vào `iam` còn đòi GRANT REFERENCES trên bảng IAM, tức là sửa quyền IAM → protected.
- **`created_at`, `retired_at`, `row_version`:**
  - `created_at timestamptz NOT NULL DEFAULT now()`: khớp (CURRENT_TIMESTAMP ≡ now()).
  - `retired_at`: có tiền lệ (B03/B04, K09).
  - `updated_at`: có tiền lệ NOT NULL + backend cập nhật (K03); thiết kế CM để NULL → khác.
  - `row_version` và `created_by/updated_by`: **không có tiền lệ**. Concurrency hiện dùng CAS `updated_at` (IAM) hoặc advisory lock/`FOR UPDATE` (Foundation, `foundation.versions.repository.ts:26`).
- **UUID generator:** `gen_random_uuid()` core PG 18.6; không cần extension (Q07).
- **Migration installer, approvals, rollback/backup:**
  - Không có migration runner.
  - Dùng gói SQL thủ công do chủ dự án duyệt và chạy, gồm guard DB/role, transaction đơn, self-check, manifest SHA-256, `pg_dump -Fc`, rollback `90/91`.
  - Installer module chỉ kiểm tra bảng tồn tại + SELECT.
- **Master Data ownership:** không tồn tại bảng, không có module/schema sở hữu → OPEN (D-CM-07).
- **`SELECT` trên UI và DB grant thực:**
  - UI Data Inspector hiển thị `has_column_privilege` của role API `talo_app`, tức là **DB grant**, không phải quyền IAM của người xem.
  - Quyền IAM (`iam_permissions`) kiểm ở backend.
  - Hai lớp này độc lập: DAT-05 L27 (DRAFT) và thực tế metadata.

---

## 7. Risk & decision requests (chủ dự án quyết định)

| ID | Vấn đề | Dữ kiện xác minh | Ảnh hưởng | Lựa chọn để chủ dự án quyết định | Ưu tiên |
|---|---|---|---|---|---|
| D-CM-01 (≈D01) | Schema + owner role cho 21 bảng CM | Mỗi miền có schema + owner NOLOGIN riêng (`foundation`/`talo_foundation_owner`). `public` không có USAGE cho `talo_app` | Mọi DDL/GRANT/MIC-06 phụ thuộc | (a) schema riêng cho Customer, owner NOLOGIN riêng; (b) dùng `public` + mở quyền (trái tiền lệ); (c) phương án khác | BLOCKER |
| D-CM-02 (≈D13) | Cơ chế tạo bảng: giả định "Foundation quản lý DDL" sai với thực tế | F07 CONFLICT | Quy trình gói SQL, backup, rollback | (a) DB Gate thủ công theo mẫu FBE/SCC; (b) yêu cầu phát triển cơ chế migration mới cho Foundation (đổi phạm vi Foundation) | BLOCKER |
| D-CM-03 (≈D02) | Actor IAM cho `created_by/updated_by/changed_by/assigned_by` | `user_account_id uuid`, không FK vào IAM (tiền lệ) | FK/kiểu cột | (a) uuid logic không FK; (b) FK vật lý (cần GRANT REFERENCES trên `iam`, protected) | BLOCKER |
| D-CM-04 | Quy ước tên PK/FK: `id`/`code` so với `<entity>_id` | Q04: không bảng nào dùng `id`/`code` | Đổi tên cột trước DDL | Giữ thiết kế 0.1 hay đổi theo quy ước (vd `customer_id`, `status_code`…) | HIGH |
| D-CM-05 (≈D08) | Cột hệ thống `created_by/updated_by/row_version`, hậu tố `_account_id`, `updated_at` NULL hay NOT NULL | Không có tiền lệ `row_version`; CAS trên `updated_at` | Concurrency, backend | Chọn mẫu chung CM | HIGH |
| D-CM-06 (≈D10) | Ngữ nghĩa `is_hidden`/`is_active`/`retired_at`/`status_code` + cấm xóa vật lý | Tiền lệ K02 (không DELETE) + GRANT cột | Lifecycle, GRANT DELETE | Chốt lifecycle + có hay không GRANT DELETE cho `talo_app` | HIGH |
| D-CM-07 (≈D03, D04) | Owner/schema 6 Master Data + ngành nghề | Không tồn tại; 02 L103 cấm gắn vào Customer | `cm_customer_addresses`, `cm_customer_payments`, `cm_customer_banks` FK NOT NULL bị chặn nếu Master chưa có | (a) schema/module Master Data riêng trước CM; (b) tạm đặt cùng gói CM với owner riêng; (c) hoãn FK | BLOCKER |
| D-CM-08 (≈D18) | GRANT cho `talo_app` (bảng/cột) + permission IAM cho module CM | Tiền lệ GRANT cột, đăng ký permission qua IAM Admin | DB Gate + IAM catalog | Danh sách GRANT/permission cụ thể sẽ có ở gói SQL | HIGH |
| D-CM-09 | Truy cập dữ liệu từ backend: Prisma hay SQL thuần | Prisma chỉ map `iam`; Foundation dùng SQL thuần | Thêm schema vào `schemas[]` + re-introspect là thay đổi Prisma schema (protected) | Chọn phương án | MEDIUM |
| D-CM-10 (≈D16) | `source_module_code varchar(50)` so với `module_key varchar(80)` | Q04 | Có thể cắt dữ liệu | Thống nhất độ dài/ngữ nghĩa | MEDIUM |
| D-CM-11 (≈D06) | Sinh `customer_code` | Không có sequence nào (Q18) | DDL sequence hoặc logic service | Chọn cách sinh | MEDIUM |
| D-CM-12 (≈D17) | Lưu file tài liệu + PII (`account_number`, `tax_number`, phone/email) | F19 NOT_FOUND | `cm_customer_documents` chỉ là metadata | Chính sách storage/masking/export | MEDIUM |
| D-CM-13 | Seed lookup/Master là DML | Phần lớn mã seed chưa xác định (02 L34) | Cần gate DML riêng + data owner | Danh sách seed chính thức | MEDIUM |
| D-CM-14 | Môi trường đích DB Gate CM (TEST trước? DEV?) | AUTH-CONTEXT: DEV không đụng; Gate4 từng nhắm DEV, FBE-01B nhắm TEST | Guard `current_database()` | Chỉ định DB đích | HIGH |
| D-CM-15 | Index ứng viên (03 L35–L46) | Foundation hiện **không có index phụ** ngoài PK/UQ (Q06) | Hiệu năng; index là đối tượng phải được duyệt (Baseline L6) | Duyệt danh sách index | LOW |
| D05, D09, D11, D12, D14, D15 | Vẫn mở như `08_DECISION_LOG.md` | Không có bằng chứng hệ thống thay đổi các mục này | — | Giữ nguyên | theo 08 |

---

## 8. Kiểm chứng zero-change

- **Lệnh đã chạy (che secrets):**
  - `git status --short`, `git rev-parse`, `git worktree list`, `git log`.
  - `sha256sum` gói đầu vào.
  - Dùng `ls/cat/sed/grep/head/wc` trên repo và `TALO-MOS-V4_exports`.
  - Một script `node` đọc `.env` để **chỉ in** user/host/port/db của các biến `*_URL`; giá trị khác in "[hidden]".
  - 2 script metadata chạy bằng `node` + `pg` có sẵn trong `backend/node_modules` (không cài thêm gì): `evidence/cm_preflight_meta.cjs` (Q01–Q19) và `evidence/colacl.cjs` (Q20 quyền cột, Q21 EXECUTE function).
- **Truy vấn DB chỉ SELECT/metadata?** Có.
  - Chỉ đọc `pg_catalog`/`information_schema`/`current_setting`/`has_*_privilege`/`aclexplode`.
  - Phiên `default_transaction_read_only=on`, `BEGIN READ ONLY`, guard DB = `talo_mos_v4_test`, kết thúc bằng `ROLLBACK`.
  - Không đọc dòng nào của bảng `iam.*`/`foundation.*`.
- **File trong repo có bị đổi không?** Không.
  - `git status --short` trước và sau đều chỉ có `?? documents/database-design/TALO_MOS_CM_DB_PREFLIGHT_v0_1/` (gói User đặt sẵn).
  - Script và output nằm ở scratchpad và `TALO-MOS-V4_exports/CM_DB_PREFLIGHT_20261029-105936/` (ngoài repo).
- **Có migration/DDL/DML/GRANT/commit/push/deploy/restart không?** Không.
  - Không chạy `npm test`/`modules:sync`, vì runtime TEST đang watch/HMR.
- **Giới hạn:**
  - Không chứng minh được "zero-change" ở cấp DB bằng snapshot trước/sau.
  - Bằng chứng là bản chất các truy vấn (read-only transaction) và guard trong script.

---

## 9. Evidence appendix

**Source (commit `439cba5`):**
- `CLAUDE.md:L14–L21`
- `AUTH-CONTEXT/00-START-HERE.md:L3, L22–L24`
- `database/prisma/schema.prisma:L18–L21, L162–L170`
- `database/prisma/README.md:L3–L10, L58–L70`
- `backend/prisma.config.ts:L7–L8`
- `backend/package.json:L27–L41`
- `database/sql/TALO-MOS-IAM-Security-PostgreSQL-v0.3.sql:L12–L23, L35–L45, L121–L130, L243–L279`
- `backend/src/modules/foundation/foundation.preflight.ts:L12–L40, L381–L409`
- `backend/src/modules/foundation/foundation.installer.service.ts:L494, L783`
- `backend/src/modules/foundation/foundation.repository.ts:L64–L70, L92`
- `backend/src/config/env.ts:L48–L52, L126–L153`
- `modules/SYSTEM_CONTROLLER_CENTER/backend/data-inspector.sql.ts:L9, L21–L25, L47`
- `documents/development/TALO-MOS-V4_Foundation_Database_Baseline_v1.0_FOR_CLAUDE.md:L1–L9, L30–L48, L212–L232, L315–L421`
- `documents/development/TALO_MOS_V4_AI_Governance_MD_v0_1/.../DAT-05.md:L9–L57` (DRAFT)
- `documents/development/FMI-02-03-FOUNDATION-INSTALLER/07_SECURITY_AND_GATES.md:L7, L13, L41`
- `documents/development/FOUNDATION-REV-01-INTEGRATION/02_NON_NEGOTIABLE_GUARDS.md:L6, L23, L44`
- `.../10_DATA_AND_SECURITY.md:L13–L20`

**Ngoài repo:**
- `TALO-MOS-V4_exports/F2-DB-GATE4-PREP-01/GATE4-FOUNDATION-DEPLOY-CANDIDATE.sql:L1–L40` (sha256 `d6263a18…dcff15`)
- `.../GATE4-PREFLIGHT-AND-BACKUP-RUNBOOK.md:L9–L132`
- `TALO-MOS-V4_exports/FBE-01B-DB/FBE01B-MANIFEST.md:L20, L27`
- `FBE01B-RUNBOOK.md:L20–L46`

**SQL (TEST `talo_mos_v4_test`, role `talo_app`, 2026-10-29T03:57Z, read-only):**

| Query | Nội dung | Kết quả rút gọn |
|---|---|---|
| Q01 | context | db `talo_mos_v4_test`, `talo_app`, PG `18.6 (Debian 18.6-1.pgdg13+2)`, search_path `"$user", public`, `transaction_read_only=on` |
| Q02 | schema + owner + ACL | `audit_api`(admin), `foundation`(talo_foundation_owner), `foundation_read_api`(admin), `iam`(admin), `public`(pg_database_owner) |
| Q03 | bảng | 25 (14 foundation, 11 iam) |
| Q04 | cột | 207 dòng. Không có `row_version`/`created_by`/`updated_by`/`id`/`code` |
| Q05 | ràng buộc | 263 dòng. 0 FK từ schema khác vào `iam` |
| Q06 | index | 56. Foundation chỉ có PK/UQ |
| Q07 | extension | `plpgsql 1.0` |
| Q08 | ACL bảng | xem §3 F12 |
| Q09 | quyền schema của `talo_app` | USAGE: audit_api/foundation/foundation_read_api/iam = true, public = false; CREATE = false toàn bộ |
| Q10 | role (không có mật khẩu) | 11 role |
| Q11 | role membership | 0 |
| Q12 | quyền DB | `talo_app` CREATE=false, TEMP=false |
| Q13 | default ACL | 0 |
| Q14 | regex bảng Customer/Master | **0** |
| Q15 | function | 10 (audit_api ×3, foundation_read_api ×2, iam ×5; tất cả SECURITY DEFINER) |
| Q16 | trigger | 0 |
| Q17 | enum/domain | 0 |
| Q18 | sequence | 0 |
| Q19 | settings | TimeZone `Etc/UTC`, encoding UTF8 |
| Q20 | quyền cột | xem §3 F12, chi tiết trong JSON |
| Q21 | EXECUTE function | xem JSON |

Output đầy đủ (chỉ metadata, không có dòng dữ liệu, không có secret): `evidence/Q01-Q19_catalog_metadata.json`, `evidence/Q20-Q21_column_function_privileges.json`.

**Chưa xác minh:**
- DB `talo_mos_v4_dev` và PROD (không truy cập).
- Dự án TALO-MOS-V2/V3 (ngoài phạm vi).
- Nội dung đầy đủ các file DOCX (`TALO-MOS-V4_Foundation_Database_Baseline_v1.0.docx`, `TaloMOS.docx`). Chỉ đọc bản MD.
- Chính sách lưu file.
- Owner Master Data.
- Ảnh UI Foundation mà gói CM nhắc đến (không có trong gói).

---

## 10. Kết luận

**`READY_FOR_REVIEW`**

- Đã đối chiếu đủ 27/27 bảng với TEST.
- 4 mục BLOCKER cần chủ dự án quyết định trước khi lập gói SQL: D-CM-01, D-CM-02, D-CM-03, D-CM-07.
- Báo cáo **không** kết luận `APPROVED_FOR_SQL`. Không tạo SQL, không sửa thiết kế.
