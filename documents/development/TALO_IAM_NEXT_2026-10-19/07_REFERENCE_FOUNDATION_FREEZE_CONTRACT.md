# TALO-MOS-V4 — FOUNDATION FREEZE CONTRACT (BẮT BUỘC)

**Revision:** 19/10/2026 — IAM/FND handoff safeguard  
**Mục đích:** Foundation đã chạy được theo xác nhận người dùng. Phát triển IAM Management **không được làm thay đổi hành vi, cấu trúc, nghiệp vụ, quy tắc tích hợp Module hoặc UI flow đang dùng của Foundation**.

## F0. Quy tắc ưu tiên cao nhất

**FREEZE Foundation hiện tại. ADD IAM Management riêng, dùng lại Foundation như một hệ thống đã có.**

- Người dùng đã đánh giá Foundation hoạt động ổn; không thực hiện refactor hay "cải tiến" Foundation nhân tiện triển khai IAM.
- Source snapshot GitHub là bằng chứng về thiết kế, **không phải xác nhận chạy PASS trên DB đang dùng**. Ghi baseline read-only và chạy regression trước/sau khi tích hợp.
- Nếu bất cứ yêu cầu IAM nào **bắt buộc** sửa behavior của Foundation, dừng hạng mục đó, mô tả file/diff/rủi ro và xin phê duyệt cụ thể trước khi chỉnh.
- Một thay đổi không liên quan không được coi là bắt buộc chỉ vì nó thuận tiện cho implementer.

## F1. Phạm vi phải giữ bất biến

| Bề mặt | Không được thay đổi |
|---|---|
| Foundation Registry / Versions | Register, create version, lưu MIC, submit, approve/reject, activate/retire, enable/disable, status transitions, error contracts, audit/transaction behavior |
| MIC / module installation | MIC-01..10, MIC-07/K05 mapping, hash/integrity; Module Host protocol và copy-folder module independence; không hardcode SYSTEM_TEST |
| Foundation data & compatibility | B01..B14 schema, compatibility checks, approval gates, existing migrations và persisted data |
| Navigation | `GET /api/foundation/navigation` là menu cá nhân theo account; MIC-04 route, visibility, tree, `ACTIVE + ENABLED + IAM ALLOW` và Direct DENY ưu tiên; `POST/PATCH` B09 hiện hữu |
| Authorization | Một evaluator `evaluateAccess`, AccessGuard, fail-closed, no admin bypass, assurance, role/direct precedence, account eligibility, audit DENIED |
| Auth | Login, Session, first-change, logout, cookie, Auth API contract và provisioning CLI hiện có |
| AppShell | Foundation/IAM sidebar và Trang chủ hiện hữu; module screen mở qua menu của Foundation; không thêm SYSTEM_TEST hardcode vào sidebar |
| Database | IAM v0.3 và Foundation B01..B14: không sửa schema, không reset/recreate, không xóa dữ liệu, không đổi trạng thái `SYSTEM_TEST 1.0.3` |

## F2. Vùng được phép triển khai IAM (additive)

1. Thêm Backend IAM Management riêng, API/UI Account List & Detail, Role, Permission Catalog, Role/Direct Assignments, revoke và effective permission dựa vào evaluator hiện có. Chỉ mount thêm router, không sửa hành vi router Auth/Foundation.
2. Frontend: thay placeholder tại `/iam/accounts`, `/iam/roles` bằng màn quản trị thật; giữ menu/tên route/tab Foundation như đang có. Không tái cấu trúc AppShell.
3. Tích hợp Module Management: dùng dữ liệu hiện có từ Foundation B01/B03/B05/B06/B09 và quyền IAM để chọn Module/Function, cấp quyền theo binding K05 và quản trị menu. **Ưu tiên đặt endpoint đọc danh mục Function/B09 trong adapter IAM Management riêng** để không cần chạm `backend/src/modules/foundation/`.
4. Nếu thực sự cần bổ sung endpoint chỉ đọc vào Foundation hoặc cải thiện Function selector trong `NavigationScreen.tsx`, nó phải **thuần additive**, không đổi route/response/logic hiện hữu và không bỏ thao tác hiện tại; trình chủ dự án duyệt diff phạm vi trước khi sửa. Không thay `GET /foundation/navigation` thành list-all-admin hoặc nới lọc IAM.
5. Không auto grant role/permission, auto create B09, auto ENABLE khi Activate. Đó là các thao tác quản trị riêng theo hành vi hiện hành.
6. Quyền DB/seed bootstrap mới cần đề xuất giới hạn, kiểm thử, rollback và **chấp thuận trước khi thực thi**; không sử dụng superuser trong runtime, không sửa quyền rộng để API chạy được.

## F3. Baseline và regression gate (chặn merge nếu lệch)

**Trước khi code:** xác nhận commit/DB target; chụp baseline qua API/read-only, không ghi DB nghiệp vụ: login/session, Module list + version statuses, MIC `1.0.3`/hash nếu có, state ENABLED, B09 (nếu có), menu cá nhân theo current account. Ghi rõ các điểm chưa kiểm chứng.

**Sau khi code:** ít nhất các tiêu chí sau phải không đổi:

1. Login, session, first-change, logout không regression.
2. Các API Registry/Versions/MIC/Lifecycle/ENABLE/DISABLE giữ contract, permission, transitions, audit/rollback; Foundation unit/HTTP tests không hồi quy.
3. Foundation `GET /api/foundation/navigation` vẫn chỉ trả menu có quyền của account; không grant → ẩn, Direct DENY → ẩn và chặn API, module DISABLED/không ACTIVE → ẩn; không lộ module cho account khác.
4. Ứng dụng vẫn load package `SYSTEM_TEST` qua Module Host generic; không đổi `module.json`, Host protocol, MIC `1.0.3` hoặc bắt người dùng tạo thêm version.
5. IAM assignment từ UI tác động **chỉ** đến hiệu lực IAM, không thay record/version/lifecycle Foundation ngoài thao tác B09 được yêu cầu độc lập.
6. No DATABASE destructive commands; mọi DB integration write test dùng test database riêng có guard/cleanup và được phê duyệt.
7. Build/typecheck và regression của Backend + Frontend PASS; ghi lại skipped/not-tested trung thực. Chỉ nghiệm thu IAM end-to-end sau khi luồng UI cấp quyền → menu SYSTEM_TEST → revoke/deny được thử thực tế.

**Nếu regression xảy ra:** rollback thay đổi IAM integration; giữ Foundation đã hoạt động, không tự ý "sửa thêm Foundation" cho hết lỗi.

## F4. Thứ tự ưu tiên và quyền quyết định

- P0: bổ sung IAM Management có API/UI thật; xác minh grants/seed/bootstrap; kiểm tra bằng test DB; kết nối với Foundation hiện hữu.
- P1 trong chính phạm vi IAM integration: Function/B09 read-only selector nếu cần để dùng UI không nhập UUID; thực hiện theo ranh giới F2.
- Không triển khai các hạng mục ngoài P0/P1 này, không suy rộng sang xây lại Foundation/IAM database.
- **Nếu các tài liệu handoff khác có câu chữ dễ hiểu là được refactor Foundation, tài liệu F0–F4 này được ưu tiên áp dụng.**

## F5. Tiêu chí chấp nhận của chủ dự án

**IAM hoàn thiện nhưng Foundation phải vẫn như cũ.** Người dùng vào phần IAM và cấp quyền theo account/role; các Function đã khai báo bởi MIC và module đã ACTIVE/ENABLED có thể được chọn để quản lý quyền/menu; mở module bằng AppShell hiện có; khi revoke hoặc Direct DENY, menu và API bị chặn đúng. Mọi API, flow và dữ liệu Foundation sẵn có vẫn hoạt động như trước.
