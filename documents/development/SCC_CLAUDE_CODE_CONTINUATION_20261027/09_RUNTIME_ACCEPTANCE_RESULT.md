# RUNTIME ACCEPTANCE RESULT — SYSTEM_CONTROLLER_CENTER 0.1.1

```
GATE:      SCC RUNTIME ACCEPTANCE
STATUS:    PARTIAL
           API / dữ liệu / IAM: PASS
           Giao diện có ảnh chụp: NOT_TESTED
           Nhu cầu SELECT: còn mục OPEN
TARGET:    TEST talo_mos_v4_test; SCC 0.1.1 e47e0084… ACTIVE / ENABLED; journal 8f22fc3b… INSTALLED_ACTIVE
APPROVAL:  chủ dự án, "RUNTIME ACCEPTANCE GATE APPROVAL", 28/10/2026
EVIDENCE:  D:\Documents\ClaudeProject\TALO-MOS-V4_exports\SCC_RUNTIME_ACCEPTANCE_20261028-135306\  (evidence-sha256.txt)
```

Claude Code không thay đổi gì trên TEST: schema, quyền, dữ liệu, lifecycle, source và runtime đều giữ nguyên.
- Fingerprint (B01/B02 module khác, B09, IAM permission / role-permission) giống hệt trước gate.
- ACL giống hệt; smoke 16/16.
- Log TEST trong suốt gate: 0 lỗi `42501`, 0 error, 0 phản hồi 5xx.
- Tài khoản test và Direct DENY **chỉ được tạo trên bản sao cô lập** (container tạm, đã hủy).

## 0. Phương pháp và mức bằng chứng

| Lớp | Cách thực hiện | Kết quả |
|---|---|---|
| **A. TEST, phiên Admin thật** | Chủ dự án tự xem SCC trên trình duyệt (13:53–13:58); đối chiếu log backend | Data Inspection (danh mục + cột `fnd_audit_logs`), Foundation & Module và Audit Logs (6 lần) đều trả **200**, không có 42501 / 5xx |
| **B. TEST, Playwright với phiên Admin** | Mở cửa sổ Chromium chờ chủ dự án đăng nhập để chụp 6 màn hình và chạy bộ API | **NOT_TESTED**: lần 1 cửa sổ bị đóng trước khi đăng nhập; lần 2 hết 20 phút không có đăng nhập. Không có ảnh chụp |
| **C. Bản sao cô lập, HTTP thật** | Dump TEST lúc 13:5x → container `postgres:18` tạm (ACL giữ nguyên). Router **SCC 0.1.1 đang chạy** (`installed-modules`, hash `e47e0084…`) được mount qua **Host capabilities thật**: lifecycle, `AccessGuard` / `evaluateAccess`, cổng Administrator `ROLE_SQL`, `SqlFoundationRepository`, kết nối bằng **`talo_app`**. Chỉ bước tra phiên được thay bằng stub (token cố định → tài khoản) | **254 lời gọi**; mọi số liệu được đối chiếu với DB của bản sao |
| **D. Bản sao cô lập, IAM** | Dữ liệu tạm: Manager có đủ 7 quyền SCC; Admin có Direct DENY `audit_log.read`; Admin bị thu hồi vai trò; tài khoản PENDING; SCC bị tắt | 5 tài khoản × 8 API × (bật / tắt) |

Lớp C/D dùng đúng code, đúng SQL và đúng quyền PostgreSQL như TEST. Lớp này không kiểm: đăng nhập thật / cookie, proxy Vite, và việc React hiển thị dữ liệu. Phần đó cần lớp B.

## 1. Trạng thái sáu chức năng

| # | Chức năng | API (lớp C) | Dữ liệu khớp DB | IAM (lớp D) | Giao diện TEST | Kết luận |
|---|---|---|---|---|---|---|
| 1 | System Health | `/health` 200 (enabled, 1 ACTIVE); `/checks/run` 200 (AUTHENTICATION / SESSION / IAM / POSTGRESQL… PASS; audit summary AVAILABLE) | Có | Có | Chưa xem | **PARTIAL** (API PASS, UI NOT_TESTED) |
| 2 | Test Results | `/results` 200: trả lượt quick check vừa chạy | Có | Có | Chưa xem | **PARTIAL** |
| 3 | Data Inspection | `/data/tables` 200 (93 bảng, `catalogComplete`); `/columns` 93/93 trả 200; `/rows` trả dữ liệu thật cho 13 bảng nghiệp vụ, có phân trang, sắp theo PK | Có (PK đầu trang `fnd_modules` = `004c5380…` khớp DB) | Có | Đã xem danh mục và cột (200) | **PARTIAL**: API PASS; còn **OPEN SELECT** (§3); chưa có ảnh UI cho bảng dữ liệu |
| 4 | Foundation & Module | `/architecture/modules` 29 trang = **2860** dòng; SCC 0.1.1 ACTIVE + 0.1.0 RETIRED đúng manifest hash; `/functions`: SCC 7 chức năng / 14 dòng | Có (2860 = modules LEFT JOIN versions; 14 = version_functions của SCC) | Có | Đã xem (200) | **PASS** (API) / UI chỉ có log, không có ảnh |
| 5 | IAM Access Matrix | `/access/accounts` 200; `/access/matrix` cho 5 tài khoản (34 quyền mỗi tài khoản) | Có (34 = `iam_permissions`) | Admin: `viaAdministrator` 34/34. Admin bị DENY: `directDeny=true` ở `audit_log.read`. Manager: `viaRole=true`, `viaAdministrator=false`. Admin bị thu hồi / PENDING: 0/34 | Chưa xem | **PARTIAL** |
| 6 | System Audit Logs | `/audit/logs`: `complete=true`, FOUNDATION + IAM `AVAILABLE` ở mọi truy vấn hợp lệ | **Có**: 24 giờ 17 = 11 FOUNDATION + 6 IAM; lọc actor 14 = 9 + 5; `action=MODULE_VERSION.ACTIVATE` 1; nguồn FOUNDATION 11 / IAM 6 | Có (DENY → 403) | Đã xem 6 lần (200) | **PASS** (API + dữ liệu) / UI chỉ có log, không có ảnh |

Chi tiết Audit Logs (lớp C):
- **Phân trang:** 31 ngày, trang 1–3 × 50 = 150 sự kiện, **150 ID không trùng**, `hasNext` đúng, sắp giảm dần theo thời gian.
- **Bộ lọc:** outcome `ISSUES` chỉ có DENIED/FAILURE; `SUCCESS`, `FAILURE`, `DENIED` đều đúng nhóm; `source` trả `NOT_REQUESTED` cho nguồn không chọn.
- **Chi tiết sự kiện:** gồm `eventId`, `source`, `occurredAt`, `actorUsername`, `actionCode`, `targetType`, `outcome`, `reason`, `correlationId`.
  - Ví dụ: `SYSTEM_CONTROLLER_CENTER.AUDIT_LOG.READ` DENIED, reason `DIRECT_DENY`. Sự kiện này do bài kiểm D sinh ra trên bản sao, chứng tỏ lần bị từ chối được ghi và đọc lại được.
  - `metadata` tự do không được trả ra (thiết kế chống lộ bí mật).
- **Kiểm tra đầu vào:** 6/6 ca sai trả **400 `VALIDATION_ERROR`** kèm trường lỗi: cửa sổ > 31 ngày, `from > to`, `outcome` lạ, `action` có ký tự SQL, `page = 11`, tham số lạ.
- **Hiệu năng:** mọi truy vấn < 200 ms (giới hạn 5 s).

Ca âm tính khác (lớp C): tableKey sai → 404 `TABLE_NOT_FOUND`; `pageSize` quá lớn, thiếu `moduleKey`, `accountId` sai định dạng → 400 `VALIDATION_ERROR`.

## 2. IAM (lớp D — bản sao cô lập, router và Host thật)

| Tài khoản (bản sao) | SCC bật | SCC tắt |
|---|---|---|
| Admin `0e7b0190…` | **8/8 trả 200** | 503 |
| Admin + **Direct DENY** `audit_log.read` | `/audit/logs` **403 FORBIDDEN** (log: `DIRECT_DENY`); 7 API khác 200 | `/audit/logs` 403, còn lại 503 |
| **Manager** có đủ 7 quyền SCC qua vai trò | **8/8 trả 403 `ADMIN_ROLE_REQUIRED`** | 403 |
| Admin bị thu hồi vai trò | 8/8 trả 403 `ADMIN_ROLE_REQUIRED` | 403 |
| PENDING_MEMBERSHIP | 8/8 trả 403 `ADMIN_ROLE_REQUIRED` | 403 |
| Phiên không hợp lệ | 8/8 trả 403 (phiên chưa xác thực) | 403 |

Kết luận IAM: **PASS**.
- Direct DENY thắng quyền Admin kế thừa.
- Gán quyền module cho Manager không mở được SCC.
- Cổng lifecycle chặn khi module tắt.
- Lần bị DENY được ghi vào audit Foundation.
- Ca không có phiên trả 401 đã được smoke trên TEST bao phủ.

## 3. Kết quả kiểm tra SELECT

### 3.1 Bảng nghiệp vụ (schema `foundation`, `iam`)

| Bảng | Quyền PostgreSQL của `talo_app` | Data Inspection | Đường xem dữ liệu khác trong SCC | Phân loại |
|---|---|---|---|---|
| `fnd_actions`, `fnd_compatibility_changes`, `fnd_compatibility_checks`, `fnd_data_contracts`, `fnd_data_fields`, `fnd_functions`, `fnd_module_versions`, `fnd_modules`, `fnd_navigation_items`, `fnd_version_actions`, `fnd_version_functions` | SELECT | **Xem được dữ liệu thật** (20 dòng/trang, có trang sau) | Foundation & Module | **PASS** |
| `iam_permissions`, `iam_roles` | SELECT | **Xem được** | Access Matrix | **PASS** |
| `fnd_audit_logs` | Không SELECT (chỉ INSERT) | `TABLE_NOT_READABLE` (giới hạn DB) | **Audit Logs qua `audit_api`**: các trường đã chuẩn hóa, metadata không trả ra | **Theo thiết kế, đã có đường xem** |
| `iam_audit_logs` | Không SELECT | `ACCOUNT_DATA_PROTECTED` (chính sách ứng dụng) | **Audit Logs qua `audit_api`** | **Theo thiết kế, đã có đường xem** |
| `fnd_module_events` (B07) | Không SELECT | `TABLE_NOT_READABLE` | **Không có** (B08 trong Audit Logs ghi lại cùng thao tác lifecycle, nhưng không phải bảng B07) | **OPEN** |
| `fnd_data_access_rules` | Không SELECT | `TABLE_NOT_READABLE` | **Không có** | **OPEN** |
| `iam_user_accounts` | SELECT | `ACCOUNT_DATA_PROTECTED` | Access Matrix: tài khoản, trạng thái, vai trò (định danh tối thiểu) | Chính sách ứng dụng; xem được một phần |
| `iam_user_roles`, `iam_role_permissions`, `iam_user_permissions` | SELECT | `ACCOUNT_DATA_PROTECTED` | Access Matrix: nguồn quyền theo tài khoản (role / Admin / Direct ALLOW / DENY) | Chính sách ứng dụng; xem được dạng tổng hợp |
| `iam_memberships` | SELECT | `ACCOUNT_DATA_PROTECTED` | **Không có** | **OPEN** (cần quyết định chính sách) |
| `iam_sessions` | SELECT | `ACCOUNT_DATA_PROTECTED` | **Không có** | **OPEN** (cần quyết định chính sách) |
| `iam_credentials` | SELECT | `ACCOUNT_DATA_PROTECTED` | Không, và **không nên có** (mật khẩu đã băm) | Theo thiết kế bảo mật |
| `iam_account_verifications` | Không SELECT | `ACCOUNT_DATA_PROTECTED` | Không | Theo thiết kế bảo mật |

Phân biệt các mã lỗi gặp được:
- `TABLE_NOT_READABLE` = PostgreSQL không cấp SELECT. Service phát hiện trước khi truy vấn, nên **không phát sinh 42501**.
- `ACCOUNT_DATA_PROTECTED` = chính sách của SCC (`data-inspector.masking.ts`) chặn dữ liệu tài khoản ở mọi schema, kể cả khi DB cho phép.
- `FORBIDDEN` = IAM DENY.
- `ADMIN_ROLE_REQUIRED` = không có TALO_SYSTEM_ADMIN.
- `VALIDATION_ERROR` = tham số API sai.
- **Không** có lỗi PostgreSQL `42501` ở bất kỳ lời gọi nào, trên cả TEST lẫn bản sao.

### 3.2 Bảng hệ thống

Danh mục Data Inspection cũng liệt kê `pg_catalog` (59 xem được, 5 `TABLE_NOT_READABLE`) và `information_schema` (3 / 1). Đây là catalog chuẩn của PostgreSQL, vai trò nào cũng đọc được, không chứa dữ liệu nghiệp vụ. Chúng làm danh sách bị nhiễu (§5).

### 3.3 Kết luận SELECT

- **Audit Logs: PASS** ở mức API và dữ liệu. Administrator đọc được audit FOUNDATION và IAM thật qua `audit_api`, không cần SELECT trực tiếp.
- **Data Inspection: PASS một phần.** 13 bảng nghiệp vụ xem được. **Nhu cầu SELECT chưa hoàn tất**, còn **OPEN**:
  - `fnd_module_events` (B07);
  - `fnd_data_access_rules`;
  - `iam_memberships` và `iam_sessions`, nếu yêu cầu quản trị cần xem.

  Tôi không cấp quyền nào để ép PASS.

## 4. Danh sách bảng xem được và bị giới hạn

Đã nêu đầy đủ ở §3.1. Danh mục chi tiết 93 bảng kèm `readStatus` nằm trong `clone-battery/clone-data-tables.json`; kết quả từng lời gọi nằm trong `clone-battery/clone-api-calls.json`.

## 5. Lỗi và tồn tại

| # | Mức | Mô tả | Bằng chứng |
|---|---|---|---|
| R-1 | **Chặn nghiệm thu UI** | Chưa có ảnh chụp và kiểm tra hiển thị React cho 6 màn hình bằng phiên Admin trên TEST. Health / Tests / Access Matrix chưa được xem trên TEST | `progress*.log` (2 lần chờ, không đăng nhập) |
| R-2 | OPEN SELECT | `fnd_module_events`, `fnd_data_access_rules` không có đường xem | §3.1 |
| R-3 | OPEN chính sách | `iam_memberships`, `iam_sessions` bị chặn bởi chính sách ứng dụng; chưa có quyết định có cần xem hay không, và xem ở mức nào | §3.1 |
| R-4 | Thấp | Khi SCC bị tắt, `/data/tables` và `/audit/logs` trả `503 SERVICE_BUSY` thay vì `MODULE_UNAVAILABLE`. Vẫn bị chặn đúng, nhưng thông báo gây hiểu nhầm | `iam-isolated-results.json` (`moduleDisabled`) |
| R-5 | Thấp | Danh mục Data Inspection gồm 70 bảng `pg_catalog` / `information_schema` | §3.2 |
| R-6 | Thông tin | Lớp C/D dùng stub cho bước tra phiên. Ca không phiên → 401 chỉ được kiểm trên TEST qua smoke | §0 |

## 6. Đề xuất khắc phục (mỗi mục là một gate riêng, chưa thực hiện)

1. **Hoàn tất R-1 (không cần sửa gì):** chủ dự án đăng nhập trong cửa sổ Chromium của script `scc-acceptance.mjs` và để script tự chạy khoảng 3 phút. Hoặc chủ dự án tự chụp 6 màn hình, Claude Code đối chiếu với log và DB.
2. **Database Access Gate bổ sung (R-2):** mở rộng mẫu `audit_api` bằng các hàm SECURITY DEFINER chỉ đọc (ví dụ `audit_api.read_module_events` cho B07 và một hàm cho `fnd_data_access_rules`). Áp dụng cùng ràng buộc: `session_user = talo_app`, giới hạn cửa sổ và số dòng, **không** cấp SELECT trực tiếp. Cần chủ dự án duyệt SQL, kèm gói SCC 0.1.2 để hiển thị.
3. **Quyết định chính sách (R-3):** mức xem `iam_memberships` / `iam_sessions` (ví dụ chỉ số đếm / trạng thái / thời điểm, không hiển thị token hay IP). Sau đó thực hiện trong gói SCC mới hoặc một DB gate.
4. **Gate sửa lỗi SCC (R-4, R-5):** thống nhất mã `MODULE_UNAVAILABLE` cho mọi route khi module tắt; lọc danh mục Data Inspection theo schema nghiệp vụ hoặc cho phép ẩn catalog hệ thống. Phát hành bản SCC 0.1.2 qua Installer.

## 7. Kết luận

**RUNTIME ACCEPTANCE: PARTIAL.**

- **PASS:**
  - API của cả 6 chức năng trên code và quyền thật;
  - dữ liệu khớp DB;
  - IAM (Admin kế thừa, Direct DENY, Manager, lifecycle);
  - Audit Logs qua `audit_api`;
  - không có 42501;
  - không ảnh hưởng Foundation, IAM hay module khác.
- **NOT_TESTED:** giao diện có ảnh chụp cho 6 màn hình (R-1).
- **OPEN:** nhu cầu SELECT cho B07, `fnd_data_access_rules` và (tùy chính sách) `iam_memberships` / `iam_sessions`.

**SCC chưa được kết luận hoàn thành.** Lỗi SELECT gốc (`42501` khi đọc audit) đã được khắc phục ở mức API và dữ liệu. Tuy vậy, chưa có bằng chứng giao diện, và vẫn còn bảng thuộc phạm vi quản trị chưa có đường xem được phê duyệt.
