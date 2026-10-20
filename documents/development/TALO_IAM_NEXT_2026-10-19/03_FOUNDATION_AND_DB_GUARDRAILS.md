# 03 — FOUNDATION FREEZE, RANH GIỚI FILE VÀ PHÊ DUYỆT DATABASE

## A. Quy tắc không được thay

Giữ **nguyên** Foundation đang chạy (và cùng hành vi khi IAM PR chưa tích hợp): Auth login/session/first-change/logout/provisioning; Foundation Registry/Versions/MIC 1.0.3/lifecycle; B01–B14/schema; navigation API/menu filtering; `evaluateAccess`/AccessGuard; module host và AppShell. `07_REFERENCE_FOUNDATION_FREEZE_CONTRACT.md` là căn cứ chi tiết.

- **Không hardcode `SYSTEM_TEST`**, không bypass IAM hoặc auto-ALLOW.
- **Không tự đổi `modules/SYSTEM_TEST/module.json`**, packageVersion 1.0.0 không phải là Foundation MIC version 1.0.3.
- **Không chạy** `prisma migrate`, `prisma db push`, `prisma migrate reset`, SQL DDL, reset volumes, seed, `GRANT/REVOKE` khi chưa duyệt.
- Không sử dụng database owner/postgres/superuser làm connection runtime Backend. Tài khoản provisioner hiện riêng (`talo_provisioner`); không chuyển provisioning sang `talo_app` để tiện làm IAM UI.
- Không thay `GET /api/foundation/navigation` thành admin catalog, không thêm module hardcoded vào sidebar.
- Bất cứ vấn đề nào phải sửa `backend/src/modules/foundation/**`, `database/prisma/schema.prisma`, `database/sql/**`, `modules/SYSTEM_TEST/**` phải **trình diff + phương án test để duyệt riêng trước**. Không âm thầm sửa để tests qua.

## B. Ranh giới chỉnh sửa mặc định của yêu cầu này

**Được phát triển cục bộ nếu không làm ngoài scope:**

- `backend/src/modules/iam-admin/**`, `backend/test/**` cho các IAM tests.
- `backend/src/server.ts` **chỉ** cho mount module IAM đã có; không đổi Auth/Foundation mounting.
- `frontend/src/services/iam/**`, `frontend/src/pages/iam/**`.
- `frontend/src/pages/shell/ScreenBody.tsx`, metadata tên/mô tả tại `frontend/src/routes/shellScreens.ts` **chỉ để tích hợp 2 màn IAM**; không thay topology route/sidebar.
- Test frontend/test E2E trong `tests/**` nếu đã có cấu trúc phù hợp.

**Chỉ đọc, không ghi đè:** `documents/**` và bộ tài liệu này sau khi copy; governance/SQL baseline/Prisma/Auth/ModuleHost/Foundation. `database/scripts/iam-admin/01-readonly-preflight.sql` trong PR là nguồn đọc; nếu phát hiện lỗi thì **báo đề xuất** và chỉ sửa khi chủ dự án cho phép sửa file ngoài các vùng mặc định.

**Git:** làm trên nhánh IAM; không tự merge vào main, force-push/rebase mất lịch sử, deploy, hoặc push remote khi chưa có phê duyệt. Local changes người dùng phải được giữ nguyên.

## C. Những quyết định DB còn mở — phải tách khỏi công việc code

| Quyết định | Đề xuất để chủ dự án xét | Trạng thái |
|---|---|---|
| IAM-admin permission namespace | 4 triples: `iam.accounts.read` = IAM/ACCOUNTS/READ; `iam.roles.manage` = IAM/ROLES/MANAGE; `iam.permissions.manage` = IAM/PERMISSIONS/MANAGE; `iam.assignments.manage` = IAM/ASSIGNMENTS/MANAGE | **PROPOSED, chưa phê duyệt bootstrap** |
| Quản trị B09 | Tái dùng `foundation.navigation.manage` = FOUNDATION/NAVIGATION/MANAGE | Đã có trong Foundation contract; kiểm tra DB grant thật |
| SQL rights | `talo_app` được SELECT/INSERT/UPDATE/DELETE đúng từng bảng cần cho API; không cấp DDL/owner/schema-wide | **BLOCKED cho đến khi có preflight và owner duyệt GRANT** |
| Admin ban đầu | One-time bootstrap chỉ cho accountId xác nhận, grant/role chính xác, có IAM audit/rollback | **BLOCKED đến khi owner chốt accountId và phê duyệt** |
| DB target | Database local/test thực tế, runtime role, backup/harness, read-only preflight | **NOT_VERIFIED** |

## D. Quy trình DB bắt buộc

1. Xác nhận đích kết nối, role runtime bằng chỉ đọc; tuyệt đối không in mật khẩu hay toàn `DATABASE_URL` vào output.
2. Kiểm tra quyền thực tế qua catalogs/read-only (`has_*_privilege`) và trạng thái IAM, SYSTEM_TEST. Không suy ra quyền từ file SQL trong repo. **Lưu ý:** câu aggregate nhiều JOIN có thể nhân đôi count; kiểm chứng số liệu gán quyền riêng để không quyết định sai.
3. Soạn **một đề xuất** gồm: bảng/cột/operation cụ thể, vai trò được cấp, lí do, target DB, SQL preview, rollback, trước/sau test; một đề xuất bootstrap accountId riêng, audit và khôi phục. Không viết `GRANT ALL` hoặc chuyển Backend sang admin.
4. Trình chủ dự án phê duyệt. **Không chạy bước 5 khi chưa có xác nhận cụ thể.**
5. Sau phê duyệt: thực thi trên đúng môi trường/DB, lưu evidence, test negative privilege và mọi flow E2E. Không chạy test ghi dữ liệu trên DB nghiệp vụ nếu chưa được chấp thuận.

## E. Phê duyệt cần trình dạng ngắn

> **Yêu cầu quyết định IAM DB**  
> Đích DB: …; Runtime role: …; Target admin account ID: …  
> Permission codes/triples: …  
> Quyền SQL thêm trên bảng/cột: …  
> Kiểm tra trước thực thi: …; Rollback: …  
> Đề nghị **DUYỆT / KHÔNG DUYỆT** riêng cho `GRANT` và bootstrap.

Không lấy một câu “tiếp tục IAM” làm đồng ý với thay đổi Database.
