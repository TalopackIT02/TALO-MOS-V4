# 02 — YÊU CẦU PHÁT TRIỂN CỤ THỂ (KHÔNG MỞ RỘNG)

## Đích nghiệp vụ

Người quản trị sử dụng **màn hình thật**: tìm Account → xem role/direct/effective permission → tạo/chọn Role hoặc permission → gán/thu hồi → chọn module, Function → tạo/cập nhật B09 (không tra UUID thủ công) → người được cấp quyền mở `SYSTEM_TEST` trong AppShell; người bị revoke/DENY không thấy và không gọi được API module.

**Không có khái niệm tự tạo menu hoặc tự cấp quyền chỉ vì đã ACTIVATE.**

## P0 — Ưu tiên làm trước, không phụ thuộc phê duyệt GRANT DB

1. **Đọc hiện trạng local**: kiểm tra `git status`, branch, remote `main`, PR #1, local uncommitted changes, environment (không tiết lộ secrets), npm scripts, DB target. Không đổi branch/checkout đè file người dùng.
2. **Review toàn bộ 8 file PR #1** so với `main`, sửa TypeScript/build/lint issues và lỗi logic rõ ràng. Không tạo IAM subsystem khác song song, không copy PR code làm trùng.
3. **Backend IAM Management**: sử dụng `sessionHandler`/`AuthService.describeSession` hiện hữu; dùng `evaluateAccess` và permission facts hiện có, fail-closed. Read account/catalog/assignments/effective; write roles, role permissions, user roles, direct ALLOW/DENY; revoke lưu `revoked_at` theo schema v0.3; IAM audit nằm cùng transaction với write. Mapping error đúng 400/401/403/404/409/422/503 tùy contract được kiểm chứng, không trả chi tiết SQL/secrets.
4. **Permission catalog**: đọc/filter/tra module-resource-operation; tạo permission đúng K05/MIC-07 của ACTIVE manifest, kiểm tra trùng `permission_code` và triple (race-safe), không tạo tự động khi module kích hoạt. Core permission quản trị IAM/Foundation cần bootstrap được duyệt riêng.
5. **UI tại routes có sẵn** `/iam/accounts` và `/iam/roles`: thay placeholder, hiển thị API data thật; hỗ trợ tìm kiếm/trang, chọn account, xem lịch sử gán và hiệu lực, tạo/sửa/kích hoạt role (không âm thầm chỉnh system role), gán/bỏ permission của Role; gán/thu hồi Role của Account; direct ALLOW/DENY + reason/optional expiry; catalog xem và tạo permission hợp lệ. Loading/empty/error/403/409/requestId rõ ràng, F5 không mất data.
6. **Navigation adapter trong module IAM riêng**: GET list B09 và list ACTIVE module Functions từ B03/B05/B06; bảo vệ bằng permission quản trị cụ thể; không thay `GET /api/foundation/navigation` (menu cá nhân). UI cho chọn Module + Function theo tên và tạo mục B09 qua Foundation POST đang có; danh sách phải đọc từ DB, không chỉ state vừa tạo; cho phép sử dụng PATCH hiện hữu với menu đã tồn tại. Nên giữ màn `Foundation → Điều hướng → Quản trị menu` hiện tại nguyên trạng, có thể dẫn người dùng qua đó để sửa B09. Nếu muốn sửa file `NavigationScreen.tsx`, **trình diff và xin duyệt trước**.
7. **Test căn bản ngay khi code**: unit/evaluator/HTTP/no-permission, validate/duplicate/revoke và frontend typecheck/build; test regression Auth/Foundation theo lệnh sẵn có. Không chờ phê duyệt DB để làm các bước trên.

## Các màn hình và khả năng sử dụng bắt buộc

| Màn hình đã có/đang làm | Yêu cầu cho giai đoạn này | Không làm |
|---|---|---|
| `Foundation → Quản lý Module` | Giữ nguyên Registry, version, MIC, approve/activate/enable/disable | Không xây lại hoặc thay workflow |
| `Foundation → Điều hướng → Menu của tôi` | Giữ menu lọc theo IAM đúng account | Không đổi API thành list-all |
| `Foundation → Điều hướng → Quản trị menu` | Giữ POST/PATCH, nhóm cha, menu hiện hữu; thêm UX tiện hơn chỉ khi có duyệt sửa | Không thay behavior Foundation |
| `IAM → Quản lý tài khoản` | Danh sách/tìm, xem chi tiết, role/direct/effective, gán/thu hồi | Không tạo account/reset mật khẩu UI |
| `IAM → Vai trò và quyền` | Tạo/sửa role, quản lý permission của role, catalog và create permission; chọn Function và liên kết B09 bằng API thật | Không thêm switch-role hoặc policy engine |
| `Trang chủ / Chức năng của tôi` | Hiện SYSTEM_TEST cho người có quyền theo Navigation; chọn đúng tab | Không hardcode menu SYSTEM_TEST/sidebar |

**UI**: tuân thủ AppShell/4 Block hiện có; không tự thêm sidebar màn mới nếu màn hiện hữu đủ để đáp ứng; tên route/tab Foundation giữ nguyên.

## P1 — Kiểm tra DB, sau đó mới thi hành phần được owner duyệt

1. Đọc DB preflight với **đúng DB và runtime role** (thường `talo_app`, phải kiểm tra), không dùng superuser trong Backend. Nếu test DB không có, báo NOT_TESTED; không tự tạo mới/xóa data.
2. Xác minh IAM-admin permission definitions/triples, grants và account admin ban đầu. Đề xuất **scoped GRANT + rollback + verification**, one-time bootstrap có actor/target cụ thể. **Không thực thi khi chưa duyệt.**
3. Khi có phê duyệt: áp dụng chỉ trên DB đã xác nhận, audit và xác minh runtime. Chạy test PostgreSQL integration trong **DB test cô lập** (không thao tác DB nghiệp vụ nếu chưa được phép).
4. Chạy E2E trên hệ thống: user admin gán ROLE/Direct → `SYSTEM_TEST` ở AppShell → mở Diagnostics/Data/Runner → revoke hoặc Direct DENY → F5/đăng nhập lại → menu biến mất và module API trả 403. Xác minh hai account khác nhau.

## API nền tảng cần kiểm tra / hoàn thiện (đã có bản WIP)

- `GET /api/iam/admin/accounts[?search,page,pageSize]` và `GET /accounts/:id`; `GET/POST/PATCH /roles`; `GET/POST /permissions`.
- `GET/POST/DELETE /roles/:roleId/permissions[/:permissionId]`; `GET/POST /accounts/:id/roles`; POST revoke role assignment.
- `GET/POST /accounts/:id/permissions`; POST revoke direct assignment; tra cứu effective dựa evaluator.
- Adapter IAM admin: `GET /foundation/navigation/items`, `GET /foundation/modules/:id/functions` dưới namespace IAM.
- Tạo/sửa B09 vẫn thông qua `POST/PATCH /api/foundation/navigation/items` đang có, kiểm soát bởi `foundation.navigation.manage`.

**Lưu ý:** Đây là danh mục contract đang có source trong nhánh PR #1, không phải xác nhận tất cả endpoints chạy PASS. Có thể tinh chỉnh chi tiết response trong phạm vi IAM mới nhưng phải cập nhật tests; tuyệt đối không chỉnh API Foundation/Auth cũ.

## Kiểm soát logic bắt buộc

- Account ACTIVE/chưa disabled, membership và assurance theo evaluator hiện hành; không switching Role.
- Role ALLOW hoặc Direct ALLOW hợp lệ, Direct DENY ưu tiên tuyệt đối; revoke/expired/inactive không hiệu lực.
- Account được xem khác actor đang xem; không coi session assurance của admin là session assurance của target. Hiển thị assumptions nếu là phép tính dự kiến.
- Duplicate active role/direct assignment: xử lý unique index PostgreSQL và trường hợp request chạy đồng thời; thông báo rõ; không thêm DB schema.
- Có audit cho thành công/từ chối như contract, fail-closed khi permission lookup/audit hỏng, tránh lưu thay đổi dở dang.
- Error body không lộ username khác, credential, hash, token, SQL, private config.
- `SYSTEM_TEST` MIC version 1.0.3 trong DB là baseline phải **kiểm tra**, không tự nhập lại hay đổi thành 1.0.4.

## Ngoài phạm vi

Tạo tài khoản trên UI, password reset UI, MFA, SSO, policy/workflow engine, dashboard/report mới, sửa MIC 1.0.3, đổi MODULE HOST/lifecycle, refactor Foundation, đổi schema IAM v0.3, xóa/truncate DB, cài dependency mới, Dev Control Center và modules ngoài SYSTEM_TEST.
