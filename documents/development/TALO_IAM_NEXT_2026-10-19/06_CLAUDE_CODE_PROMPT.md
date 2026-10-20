# 06 — PROMPT THỰC THI CHO CLAUDE CODE

> Copy toàn bộ khối bên dưới vào Claude Code ở thư mục gốc dự án. Đây là yêu cầu **đọc, ghi nhận rồi triển khai code P0 ngay trong cùng phiên**. Không tự kích hoạt các quyền thay đổi Database, push/merge/deploy.

---

Bạn tiếp nhận task **TALO-MOS-V4 — hoàn thiện IAM Management và tích hợp Foundation Navigation**, ưu tiên đưa hệ thống vào sử dụng thật, không mở rộng ngoài phạm vi.

**Thư mục dự án trên Windows:** `D:\Documents\ClaudeProject\TALO-MOS-V4`

**Bước 1 — ĐỌC VÀ GHI NHẬN HIỆN TRẠNG, BẮT BUỘC trước khi sửa:**

1. Đọc `CLAUDE.md`, `AUTH-CONTEXT/00-START-HERE.md`, IAM v0.3 Decision Record, `database/prisma/README.md`, các file Auth/Foundation/IAM/Navigation liên quan. Đọc bộ tài liệu mới tại `documents/development/TALO_IAM_NEXT_2026-10-19/` **theo thứ tự 00→07**; đặc biệt tuân thủ `07_REFERENCE_FOUNDATION_FREEZE_CONTRACT.md`. Đọc bộ AI Governance Markdown hiện có chỉ như **tài liệu DRAFT tham chiếu**, không tự nâng thành quyết định đã duyệt.
2. Chạy các thao tác **chỉ đọc**: `git status -sb`, `git remote -v`, `git log -1`, xác nhận branch và những sửa đổi cục bộ. `git fetch` remote khi có thể, nhưng không tự checkout/reset làm mất thay đổi của người dùng. Đối chiếu `main` và PR GitHub [#1](https://github.com/TalopackIT02/TALO-MOS-V4/pull/1), nhánh `feat/iam-management-foundation-20261019` (baseline tham chiếu `main=fafc4d5`, PR HEAD `f906c2a`; **phải xác minh HEAD mới nhất khi chạy**).
3. Ghi báo cáo khảo sát đầu phiên: **ĐÃ CÓ / ĐANG WIP / CÒN THIẾU / KHÔNG ĐƯỢC SỬA / CẦN CHỦ DỰ ÁN DUYỆT**. Phân biệt **mã nguồn tồn tại** với **đã build/test/runtime PASS**. Nếu đang ở `main`, hãy tích hợp tiếp từ nhánh PR IAM hợp lệ sau khi xác nhận worktree an toàn; **không viết lại các file đã có trong PR #1**.
4. Xác định đúng database mục tiêu, quyền role runtime và trạng thái SYSTEM_TEST bằng cách **đọc/kiểm tra an toàn** khi môi trường cho phép. Không ghi lại mật khẩu/tokens/secrets. Không làm thay đổi DB trong giai đoạn khảo sát.

**Bước 2 — TIẾP TỤC TRIỂN KHAI NGAY, không dừng sau phần tóm tắt:**

- Làm đúng P0 trong `02_IMPLEMENTATION_REQUIREMENTS.md`: review và sửa các file IAM của PR #1; giữ `evaluateAccess`, Auth session và Foundation lifecycle/MIC/B09 như cũ; không thêm evaluator hay bypass riêng.
- Hoàn thiện Backend IAM admin: Accounts/list/detail/search/page; Roles list/create/update/active; Permission catalog/filter/create từ MIC-07/K05; role→permission, account→role, direct ALLOW/DENY, revoke; effective permission hiển thị rõ assumptions; strict validation, duplicate/unique error, IAM audit và atomic transaction; đủ checks 401/403/no-grant/DENY.
- Hoàn thiện 2 màn hình hiện có `/iam/accounts` và `/iam/roles`: API thật, thao tác gán/thu hồi, chọn account/role/permission, loading/error/requestId, catalog và tạo permission hợp lệ, dữ liệu reload/F5 vẫn tồn tại. **Không làm màn hình tạo account/reset mật khẩu** vì provisioning CLI hiện hữu đáp ứng P0.
- Tái sử dụng IAM read-only adapter B09/Function từ PR #1 để chọn Module/Function bằng tên; tạo B09 bằng `POST /api/foundation/navigation/items` hiện hữu; xem/sửa B09 dùng dữ liệu DB/API thật; liên kết menu đã có với `SYSTEM_TEST` mà không nhập UUID thủ công. Không hardcode menu hoặc tự động tạo khi ACTIVATE. Nếu phải sửa `frontend/src/pages/foundation/NavigationScreen.tsx`, hãy tách đề xuất và xin duyệt diff trước; tiếp tục giải pháp IAM UI riêng nếu đủ.
- Kiểm thử và sửa lỗi đến khi backend/frontend build và unit/HTTP tests PASS trong môi trường được phép; kiểm tra regression Foundation/Auth. Viết tests missing 401/403, DENY overrides, grant/revoke, duplicate, audit rollback, navigation read-only, UI API. **Phải chạy tests thật và báo chính xác PASS/FAIL/SKIPPED/NOT_TESTED**.

**Bước 3 — PHÊ DUYỆT DATABASE (KHÔNG TỰ THỰC THI):**

- Kiểm tra read-only privileges của runtime DB role (`talo_app` nếu đúng), account admin bootstrap, existing `iam_permissions`, Role/Direct grants và SYSTEM_TEST 1.0.3 ACTIVE/ENABLED/B09.
- Nếu cần GRANT/REVOKE/seed/bootstrap/DB write hoặc sửa protected scope, **dừng riêng thao tác đó** và trình một phương án ngắn gồm target database, actor accountId, từng quyền SQL/permission code/triple, SQL preview, audit/rollback, rủi ro và negative verification. **Chờ tôi phê duyệt rõ ràng trước khi chạy**. Không sử dụng postgres/owner/superuser trong runtime Backend. Không đổi schema IAM v0.3, Foundation B01–B14, MIC 1.0.3 hay Module Host.
- Không chạy E2E ghi vào DB nghiệp vụ hoặc test fixture phá dữ liệu khi chưa xác định DB test cô lập và được phép sử dụng.

**Gate nghiệm thu chính:** Từ AppShell, admin cấp IAM permission cho account A và tạo B09 Function menus của SYSTEM_TEST qua UI; A thấy và mở đúng Diagnostics/Data Viewer/Test Runner; account B không quyền không thấy/không gọi được API; revoke hoặc Direct DENY khiến A mất menu/API (tính cả điều kiện ACTIVE/ENABLED/MIC hash). Đồng thời Foundation/Auth hiện hữu **không đổi hành vi**: FRZ-01..08.

**Ranh giới tuyệt đối:** Không refactor Foundation đang ổn; không tự đổi MIC/lifecycle, schema/migration, `documents/**`, dependencies, provisioning credentials, AppShell architecture; không sửa Module Host; không switch account/role; không bypass IAM; không thêm tính năng mới; không tự `git push`, merge PR, deploy hoặc thay đổi DB privileges nếu chưa được duyệt. Cho phép tiếp tục sửa cục bộ những file IAM/frontend/test/mount đã nêu, bảo tồn mọi file người dùng đang sửa.

**Báo cáo cuối phiên theo `05_EXECUTION_REPORT_TEMPLATE.md`:** commit/branch/source snapshot; file sửa; API/UI thật đã hoàn thành; test đã chạy và output; `FRZ-01..08`; DB preflight/approval còn chặn; SYSTEM_TEST E2E PASS hay NOT_TESTED; backlog còn lại tối đa 5 việc theo thứ tự. Không tuyên bố DONE khi chưa có evidence runtime.
