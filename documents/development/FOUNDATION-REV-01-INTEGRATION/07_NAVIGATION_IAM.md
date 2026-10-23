# 07 — B09 NAVIGATION / IAM CONSISTENCY

## Một cấu trúc cho tất cả

B09 Navigation Builder đang dùng **AREA → MENU → FUNCTION** (3 cấp), có Develop Anchor kỹ thuật và logic preview/save/revision. Installer mới phải dùng cùng `validateDraft()/planDraft()/NavigationService` hoặc API layout service có kiểm soát; **không dựng B09 bằng `createItem()` độc lập tạo nhóm gốc→Function**.

### Cơ chế hiện có và sai lệch

- Builder đọc B09 và xây cây 3 cấp. Dưới vùng `Develop`, có những admin fixed screens không phải B03; không ghi chúng vào B09.
- `foundation.installer.service.ts navigation()` tìm group root theo module và insert function trực tiếp dưới đó: gây legacy item `FUNCTION_UNDER_AREA`.
- Điều kiện `rows.some(function_id=...)` có thể coi liên kết hidden/stale là đã đầy đủ, rồi postcheck thiếu menu.

### Contract Installer ↔ Navigation Builder

- Dựa vào MIC04, xác định function key, route/screenKey, menuLabel, Developer identity. Mỗi function gắn vào MENU thích hợp thuộc AREA được policy cho phép.
- Không suy luận rằng mọi `moduleType=INTERNAL` đều là Developer Function. Dùng danh sách kỹ thuật `DEVELOPER_FUNCTIONS` hiện hành; bổ sung theo quy trình đã duyệt, không hardcode tùy tiện.
- Nếu chưa có AREA policy/target menu được chủ dự án xác định, **plan đề xuất placement**, UI cho người có quyền xem/xác nhận trong Workspace; không tự tạo nhiều nhóm rác ở root.
- Ghi B09 qua một transaction/version revision, validation shared. Không ghi B09 trước khi B02/permission ready theo logic đã kiểm chứng.
- Idempotency check = liên kết đúng module + đúng function + đúng parent chain/visible + đúng policy/route; hidden/relinked/stale không được tính là completed.
- Không xóa/ẩn mục menu đang dùng chỉ vì package đổi MIC04, trừ khi có plan migration rõ và người có quyền duyệt. Không tạo duplicate visible link bất ngờ.
- Hậu kiểm: function link có đường 3 cấp visible, no legacy created, route AppShell resolves, assigned principal được IAM cho thấy đúng; Builder reload và sidebar nhất quán.

## IAM K05

`MIC07` phải tương thích B03/B04 và IAM permission `{moduleCode=KEY, resourceCode=functionKey, operation=actionKey}`. Catalogue khác assignment: Installer tạo permission (nếu được phép) **không tự gán**.

Trước khi enable/postcheck, phân định chính sách:
1. `CATALOG_READY`: danh mục permission tồn tại, assuranceLevel khớp.
2. `POLICY_READY`: có policy cấp quyền được owner phê duyệt cho role/account cần test; không mặc định cấp cho admin chỉ vì tên account.
3. `ACCESS_VERIFIED`: dùng principal hợp lệ và principal bị từ chối, test API responses/menus theo quyền thực.

Nếu chỉ CATALOG_READY thì report không được khẳng định user có thể truy cập module. UI cần hiển thị “Chưa gán quyền — mở IAM để cấu hình”, nếu quyền chưa được duyệt thì có blocker/warning theo policy.

## Quy tắc permission và audit

- Reuse AccessGuard/session/evaluator hiện hành, không bypass notSelf/root rules, không tự cấp quyền.
- Trình Installer có thể cần quyền Registry, Version Approve/Activate, Navigation manage, IAM permissions manage. **Backend kiểm tra toàn bộ**; UI ẩn hoặc disable button chỉ là convenience.
- Audit B08 denied/failure/success theo service hiện tại; không trực tiếp INSERT vào audit thay cho service.
- Không tự SQL GRANT dù thiếu `INSERT` trên `iam.iam_permissions`: giữ `IAM_DB_GRANT_MISSING`, có log an toàn.

## Fixture FBET / Khóa MVC

- Module fixture `FBET_*` phải không chiếm route hệ thống. Khi một module bị DISABLED vẫn giữ route ACTIVE, Scanner/plan phát warning, đồng thời ENABLE endpoint phải kiểm tra route conflict trước khi bật lại.
- Dữ liệu thật vs fixture phân loại bằng ID/audit/fixture ownership, không chỉ tên `FBET_` hoặc menu `Khóa MVC*`.
- Đối với dữ liệu không xác minh được: filter khỏi view thông thường nhưng giữ lịch sử; không xóa DB trong REV-01.
- Test suite phải dùng isolated namespace/unique routes/teardown an toàn, postcheck leftovers = 0 (nếu được phép cleanup fixture).

## UI Builder

Tree stays; edit Area/Menu/Link, Function Inventory mở drawer (không để chiếm nửa màn liên tục); preview popup. Default hiding legacy/hidden/test, nhưng luôn có nút bật xem tất cả. Lưu một lần với revision conflict, unsaved guard, diff, no silent loss.

## Tests

- Installer 3 cấp B09 + Builder đọc ra cùng cây, không tạo legacy.
- Hidden link không làm idempotency false-PASS, function mapping mismatch fail.
- Developer Function ngoài Develop bị từ chối hoặc chuyển bằng thao tác owner rõ ràng.
- IAM allow/deny cả Backend lẫn Sidebar, account chưa được cấp quyền không được thấy màn chức năng.
- FBET ACTIVE disabled → enable route collision blocked; menu thật không biến mất.
