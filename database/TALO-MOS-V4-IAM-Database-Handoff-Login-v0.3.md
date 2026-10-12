# TALO-MOS-V4 — IAM Database Handoff for Login

**Ngày bàn giao:** 2026-10-12  
**Nguồn:** GitHub `TalopackIT02/TALO-MOS-V4` nhánh `main`, SQL IAM v0.3, Decision Record v0.3 và bằng chứng PowerShell do User cung cấp.  
**Trạng thái:** Database baseline đã được triển khai và kiểm tra theo bằng chứng User gửi; đây không phải báo cáo chạy test trực tiếp của Claude Code.  
**Mục tiêu tiếp nhận:** Chuẩn bị kế hoạch rồi, sau khi User duyệt, xây **màn hình Login hoạt động** bằng React + Node.js/ExpressJS + Prisma trên database IAM hiện có. Không AppShell, không dashboard, không UI quản lý Account/Role/Permission.

## 1. Nguồn sự thật và thứ tự ưu tiên

1. SQL **đã áp dụng thực tế**: `database/sql/TALO-MOS-IAM-Security-PostgreSQL-v0.3.sql` (đối chiếu với PostgreSQL thực tế). Đây là DDL baseline; **không tự sửa**, không chạy lại DDL.
2. `documents/database-design/IAM&Sercurity/TALO-MOS-IAM-v0.3-Decision-Record.md` và các quyết định mới hơn của User trong phiên: bỏ Switch Account/Role, giữ nhiều Role như pack quyền, Direct DENY ưu tiên, lifecycle và email assurance.
3. `documents/database-design/IAM&Sercurity/TALO-MOS-IAM-Security-Specification-v0.2.md` chỉ dùng cho nghiệp vụ không bị v0.3 thay thế; phần Role Switching của v0.2 là lỗi thời.
4. `CLAUDE.md` tại root: yêu cầu phê duyệt trước khi sửa protected files, cài dependency, migration, seed, hoặc triển khai.
5. Bất kỳ khác biệt giữa nội dung GitHub, local và DB đều phải báo User, không âm thầm đồng bộ.

## 2. Bằng chứng đã xác minh và giới hạn

### 2.1 Xác minh từ GitHub `main`
- Repo đã có `docker-compose.yml` dùng `postgres:18`, service `postgres`, named volume `postgres_data`, bind local `127.0.0.1:${POSTGRES_PORT:-5432}:5432`.
- `database/sql/TALO-MOS-IAM-Security-PostgreSQL-v0.3.sql` đã có trên GitHub. File có 11 bảng, 16 FK khai báo, 18 index riêng, 12 CHECK; không có `active_role_id`. COMMENT `account_status` và `outcome` đã thống nhất với CHECK.
- `database/prisma/` có `migrations/` và `seed/`; chưa thấy `schema.prisma` trên GitHub.
- `backend/package.json` còn placeholder, không có runtime scripts/dependencies; README nói frontend/backend chưa scaffold.
- `documents/database-design/IAM&Sercurity/` vẫn chứa SQL v0.2, SQL v0.3, spec v0.2, Decision Record v0.3, ảnh và ghi chú.
- `.env.example` trên GitHub dùng ví dụ `POSTGRES_USER=talo_dev`, `POSTGRES_PORT=5432`, `DATABASE_URL=...talo_dev...localhost:5432`; **không khớp cấu hình local User đã xác nhận**. Không lấy giá trị này làm kết nối đang vận hành.
- README và Decision Record hiện còn tuyên bố Compose placeholder / DDL chưa chạy: đây là tài liệu trạng thái cũ, không phản ánh log thực thi User mới gửi. Không tự sửa tài liệu trong `documents/`.

### 2.2 Bằng chứng PowerShell do User cung cấp (chưa được Claude kiểm tra độc lập)
- PostgreSQL `18.6` trong Docker container `talo-mos-v4-postgres`, status `Up (healthy)`.
- Database `talo_mos_v4_dev`, user `admin`, host `127.0.0.1`, host port `5433`, container port `5432`.
- SQL local đã chạy thành công `COMMIT`, tạo 11 tables, 16 FK; `active_role_id` không tồn tại.
- SHA256 SQL local trước lúc DDL: `3D1D27AE66E28AEA673B1883929491F5126442EA60EEACE84BAA5FF6C82EF080`.
- Đã kiểm thử CHECK membership status, FK account-membership, unique username (case-insensitive), unique current account/membership, cập nhật DISABLED, credential defaults và session creation; dữ liệu test đều được hoàn tác theo kết quả User gửi.
- User xác nhận 11 bảng đều có `COUNT(*) = 0` sau test; không có Membership, Account hay Credential để đăng nhập thực tế.
- Chưa có bằng chứng end-to-end Login, password hashing, email verify, session revocation, audit atomicity, Prisma drift test hoặc migration history.

## 3. Cấu trúc IAM v0.3 — 11 bảng

| Bảng | Vai trò |
|---|---|
| `iam.iam_memberships` | Định danh nhân sự tồn tại trước Account |
| `iam.iam_user_accounts` | Account gắn Membership |
| `iam.iam_credentials` | Password hash, must-change-password, đếm lần sai/khóa tạm |
| `iam.iam_account_verifications` | Xác minh email và bằng chứng cấp 2 |
| `iam.iam_roles` | Gói Permission |
| `iam.iam_permissions` | Quyền nguyên tử và assurance tối thiểu |
| `iam.iam_role_permissions` | Role ↔ Permission |
| `iam.iam_user_roles` | Gán Role cho Account |
| `iam.iam_user_permissions` | Direct ALLOW/DENY |
| `iam.iam_sessions` | Phiên đăng nhập, session token hash, expiry/revocation |
| `iam.iam_audit_logs` | Audit action/outcome/actor/session |

**Không có** `active_role_id` trong sessions/audit; không có Switch Account hoặc Switch Role.  
**Account ↔ Membership:** một Account tham chiếu một Membership; unique partial index `membership_id WHERE disabled_at IS NULL` đảm bảo tối đa một Account hiện hành/Membership, cho phép Account đã disable trong lịch sử.  
**Quyền:** `(permissions từ tất cả Role còn hiệu lực ∪ direct ALLOW) − direct DENY`; role không phải working context. Chỉ grant không đủ cấp quyền: còn trạng thái Account/Membership, mức assurance, hiệu lực thời gian và authorization backend.

## 4. Quy tắc tối thiểu cho Login

- IT tạo Account gắn với Membership đã có, `username` khởi tạo từ mã nhân viên; Account ban đầu `PROVISIONED`, mật khẩu tạm chỉ lưu **hash Argon2id** do ứng dụng tạo, `must_change_password=true`.
- Lần đăng nhập đầu phải đổi mật khẩu trước khi sử dụng nghiệp vụ. Sau đổi mật khẩu thành công và đủ điều kiện, Account có thể `ACTIVE`, assurance nội bộ Level 1.
- Sau Level 1 và email hiện hành đã xác minh hợp lệ thì Level 2; đổi email chưa xác minh hay thu hồi bằng chứng phải hạ Level 1. Email verified **không phải MFA**.
- `PROVISIONED`: chỉ cho phép luồng kích hoạt; `LOCKED` hoặc `DISABLED`: không được truy cập nghiệp vụ.
- Khi `DISABLED`: `account_status='DISABLED'`, `disabled_at` có timestamp, thu hồi các session còn hiệu lực và ghi Audit; thực hiện nhất quán (transaction) ở service. `ACTIVE`/`LOCKED`/`PROVISIONED` tương ứng `disabled_at IS NULL` theo quyết định User.
- Session lưu **hash token**, không plaintext; `expires_at > created_at`, token có thời hạn, có khả năng thu hồi; không dựa vào `assurance_level_snapshot` như nguồn quyền vĩnh viễn.
- Audit không chứa password, raw session token hoặc dữ liệu nhạy cảm không cần thiết.
- DB constraint không tự bảo vệ đầy đủ các workflow này; Claude cần implement và test ở service sau khi có approved plan.

## 5. Môi trường kết nối Development

| Thành phần | Giá trị đã được User xác nhận |
|---|---|
| Database | `talo_mos_v4_dev` |
| PostgreSQL | `18.6` Docker |
| Compose service | `postgres` |
| Host (app chạy trực tiếp trên Windows) | `127.0.0.1` |
| Host port | `5433` |
| PostgreSQL container port | `5432` |
| PostgreSQL bootstrap user | `admin` |
| Password | Chỉ lấy từ `.env` local, không đưa vào prompt, repo hoặc báo cáo |

Khi Backend chạy trên host Windows, connection URL phải dùng host port `5433`. Nếu Backend chạy trong cùng Compose network, sử dụng hostname `postgres` và internal port `5432` theo cấu hình được phê duyệt. Không tự lựa chọn cấu hình triển khai mới nếu thiếu approval. Kiểm tra `.env` local mà không in secret ra log.

## 6. Công việc yêu cầu Claude Code — PHASE PLAN trước

1. Đọc `CLAUDE.md`, file SQL v0.3, Decision Record và bản đặc tả v0.2; đối chiếu schema thực tế read-only, không sử dụng README cũ làm bằng chứng trạng thái DB.
2. Kiểm tra hiện trạng `frontend/`, `backend/`, `database/prisma/`, `tests/`, scripts và dependencies. Xác định language/runtime versions còn chưa chốt, không tự phát minh.
3. Lập **Draft Plan** cho màn hình Login: Prisma introspection/mapping read-only, backend authentication/change-first-password/session/audit, frontend login tối thiểu và integration tests. Chỉ giai đoạn Login; email verification Level 2 có thể cần làm rõ có nằm trong MVP Login hay không, không tự mở rộng.
4. Nêu rõ cách tạo dữ liệu Development test hợp lệ (Membership, Account, Credential Argon2id) mà không hardcode plaintext/seed không được duyệt. Hiện DB đang trống.
5. Trình User: file dự kiến sửa, dependencies và versions, API contract, state transitions, cách xử lý lỗi, test plan, rollback, các quyết định còn thiếu.
6. **Chờ User phê duyệt Draft Plan và file scope trước khi code/installer/seed/migration.** Sau approval mới triển khai; tuyệt đối không Prisma `db push`, migrate tự động hoặc sửa DDL baseline.

## 7. Out-of-scope & bắt buộc hỏi User

**Không làm:** AppShell, dashboard, user/account management UI, role/permission management UI, branch/organization scope, production deployment, SQL migration, tự thêm bảng/cột/index, tự cấp quyền hệ thống, nhập dữ liệu thật, thay đổi tài liệu gốc trong `documents/`.

**Phải xin quyết định nếu cần:** JS hay TS, phiên bản Prisma và cấu hình multi-schema, thiết kế API chưa có, cách khởi tạo Account test, mức độ triển khai email verification trong Login MVP, thay đổi protected folder `database/prisma/schema.prisma`, cài dependencies, mọi sửa DDL/migration, dữ liệu/secret/production.

## 8. Tiêu chí nghiệm thu cho bước Login (dự kiến, cần User duyệt)

- Prisma model phản ánh đúng 11 bảng và schema `iam`; kiểm tra drift không làm biến đổi DDL.
- Backend Login xác minh hash an toàn, xử lý sai mật khẩu và trạng thái `PROVISIONED/ACTIVE/LOCKED/DISABLED` đúng chính sách; thay mật khẩu lần đầu; Session cấp/revoke đúng quy tắc; Audit có kết quả phù hợp.
- Frontend hiển thị và tương tác màn hình Login, lỗi xác thực và bắt buộc đổi mật khẩu; không vào AppShell.
- Có tài khoản Development test được tạo theo phương pháp User duyệt; tests thực sự chạy; kết quả ghi PASSED/FAILED/NOT_TESTED đúng bằng chứng.
- Handoff nêu file đổi, cấu hình, cách chạy, test log, vấn đề còn lại; không báo `COMPLETED` nếu thiếu kết quả.

## 9. Trạng thái bàn giao

**Database DDL:** triển khai thành công theo log và xác minh User. **Phần Backend/Frontend:** chưa được triển khai theo GitHub tại thời điểm kiểm tra. **Quyền code:** chưa cấp tự động qua tài liệu này; Claude phải lập Plan và chờ phê duyệt riêng.
