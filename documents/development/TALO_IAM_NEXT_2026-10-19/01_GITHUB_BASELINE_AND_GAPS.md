# 01 — GITHUB BASELINE & GAP REVIEW

**Xác minh live từ GitHub ngày 19/10/2026, thời điểm soạn; Claude Code phải `git fetch` và xác minh lại khi chạy.**

| Đối tượng | Trạng thái được xác minh |
|---|---|
| Repo | `TalopackIT02/TALO-MOS-V4`, default branch `main` |
| `main` HEAD | `fafc4d5f5e0215d40dc9ee7308d23973d1a7b19d` |
| Nhánh triển khai | `feat/iam-management-foundation-20261019` |
| Nhánh IAM HEAD | `f906c2a5dd220521814875ec63cad14a1d1e5786` |
| Pull Request | [PR #1](https://github.com/TalopackIT02/TALO-MOS-V4/pull/1), **OPEN / DRAFT / chưa merge** |
| So với `main` | Nhánh WIP trước `main` 11 commits, thay đổi **8 files** (6 thêm mới, 2 cập nhật); kiểm tra lại bằng `git diff --stat main...HEAD` |
| DB thật | **NOT_VERIFIED** (không có kết nối từ phiên tạo handoff) |
| Build/test PR | **NOT_TESTED** (chưa chạy CI/local tại phiên tạo handoff) |

## Đã có trong `main` — kế thừa, không làm lại

- `backend/src/modules/auth/`: login, session, first-change, logout và provisioning CLI.
- `backend/src/modules/foundation/`: Registry, Versions, MIC, lifecycle, B09 Navigation.
- `foundation.permissions.ts`: `evaluateAccess()` là evaluator duy nhất; direct DENY thắng role/direct ALLOW; không có admin bypass.
- `foundation.access.ts`, `foundation.http.ts`: AccessGuard, audit và session wrapper.
- `frontend/src/pages/foundation/ModuleScreen.tsx`, `NavigationScreen.tsx`: giao diện Foundation đã vận hành theo quyết định của chủ dự án.
- `GET /api/foundation/navigation`: menu cá nhân, dựa trên ACTIVE + ENABLED + MIC + B09 + effective IAM.
- `modules/SYSTEM_TEST`: module độc lập; **packageVersion `1.0.0` không đồng nghĩa Foundation MIC version `1.0.3`**.
- `database/prisma/schema.prisma` và IAM v0.3 SQL: schema có Accounts, Roles, Permissions, User Roles, Direct Grants, IAM audit.

## Có trong PR #1 — nguồn WIP cần kế thừa, kiểm thử và sửa

| File | Hiện trạng source | Tiếp tục |
|---|---|---|
| `backend/src/modules/iam-admin/iam.admin.repository.ts` | Đã viết SQL read/list và một số write/audit/permission check | Review SQL, constraints, 409/422, duplicate, atomicity, permission filter, DB least privilege |
| `backend/src/modules/iam-admin/iam.admin.routes.ts` | Đã có endpoints admin guarded | Test HTTP 401/403/validation; chính xác hóa response/errors, authorization từng thao tác |
| `backend/src/server.ts` | Đã mount IAM router | Giữ nguyên Auth/Foundation mounts; test khởi động |
| `frontend/src/services/iam/iamApi.ts` | Có API client dùng cookie cùng origin | Parse/validate response, phân trang, error requestId/feedback |
| `frontend/src/pages/iam/IamManagementScreens.tsx` | Có Accounts/Role screens cơ bản | Hoàn thiện UI, permission creation, quản trị B09, thông báo/lỗi và UX |
| `frontend/src/pages/shell/ScreenBody.tsx` | Đã thay placeholder bằng IAM screens | Không phá AppShell; cập nhật mô tả còn lỗi thời ở route metadata nếu đúng scope |
| `backend/test/unit/iam-admin/iam-admin.test.ts` | Có 4 bài test gate căn bản | Bổ sung service/HTTP/db integration; chạy thực |
| `database/scripts/iam-admin/01-readonly-preflight.sql` | SQL preflight read-only đã được thêm | Đọc/chạy đúng test DB/role, kiểm tra câu đếm không nhân bản bởi join |

## GAP cụ thể phải xử lý, không suy diễn đã PASS

1. PR #1 **chưa được build/typecheck/test**, chưa xác minh ràng buộc SQL với PostgreSQL thật. Bắt đầu bằng kiểm tra build, sửa lỗi thực tế, không báo PASS sớm.
2. Backend thiếu đầy đủ test 401/403, grants/revokes, duplicates, error mapping, rollback, hiệu lực Direct DENY, DB privilege failures.
3. Frontend hiện mới có UI thô; **chưa có form tạo permission** dù API mới có; tìm kiếm/filter/catalog, phân trang, xử lý response/lỗi, các thao tác sửa B09 và chọn nhóm/menu cần rà soát. Không xây lại NavigationScreen hiện tại.
4. `frontend/src/routes/shellScreens.ts` vẫn có mô tả “Chưa triển khai” của IAM, không phản ánh PR WIP; chỉ cập nhật metadata nếu cần, không đổi cấu trúc AppShell.
5. Các API read IAM và Foundation adapter có nhiều lớp quyền quản trị; không cho UI gọi dư API của scope khác rồi báo 403 sai khi user chỉ có một quyền phù hợp.
6. Chưa có bằng chứng `SYSTEM_TEST` Foundation version `1.0.3` ACTIVE, Module ENABLED, MIC hash, B03/B05, B09, permission definitions và grants trong DB hiện chạy.
7. Chưa có quyết định đã duyệt về **permission IAM-admin namespace**, least-privilege `talo_app` grants và one-time admin bootstrap. Chưa được phép tự chạy.
8. Thiết kế hiệu lực của account đích trong UI phải tách khỏi **assurance level của session admin đang xem**; hiện mã WIP truyền assurance của admin vào kiểm tra account đích — không được mô tả sai là trạng thái chắc chắn của session account đích.
9. Các cạnh tranh đồng thời/DB unique constraints như active role/direct duplicate và permission K05 ambiguities phải trả lỗi có kiểm soát, không rò lỗi DB hoặc trả 500 chung cho lỗi nghiệp vụ dự kiến.

## Điểm không thuộc scope

Account creation/reset password qua giao diện **không nằm trong P0**; hiện đã có provisioning CLI theo Auth. Không mở rộng làm màn hình này chỉ vì backlog cũ từng liệt kê “chưa làm”. Không thêm MIC 1.0.4, không thay Module Host, không sửa Dev Control Center.
