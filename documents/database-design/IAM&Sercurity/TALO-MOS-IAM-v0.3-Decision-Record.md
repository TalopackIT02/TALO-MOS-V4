# TALO-MOS-V4 — IAM & Security v0.3: Decision Record

**Ngày chốt thay đổi nghiệp vụ:** 12/10/2026  
**Cơ sở:** SQL v0.2, đặc tả v0.2 và quyết định của User trong phiên trao đổi.  
**Trạng thái:** Thay đổi về Account/Role đã được User xác nhận; **chưa phê duyệt thực thi DDL/migration**.

## 1. Lý do chốt phiên bản v0.3

- Mỗi Membership có tối đa **một User Account hiện hành**, giữ lịch sử Account đã vô hiệu hóa theo SQL v0.2. Không triển khai Switch Account.
- Một User Account có thể nhận **nhiều Role**. Role chỉ là **gói quyền/chức năng dựng sẵn** để cấp nhanh, không phải ngữ cảnh hoạt động cần lựa chọn.
- Quyền được tổng hợp từ tất cả Role còn hiệu lực, cộng Direct ALLOW, trừ Direct DENY. Việc một Account bị DENY một quyền nằm trong Role là nghiệp vụ được yêu cầu.
- Vì không có Switch Role, lưu `active_role_id` trong Session và Audit là dư thừa, gây hiểu nhầm rằng quyền phụ thuộc Role đang chọn.

## 2. Delta DDL v0.2 → v0.3

| Đối tượng | Thay đổi |
|---|---|
| `iam.iam_sessions` | Bỏ cột `active_role_id`, COMMENT và FK `fk_sessions_active_role_id` |
| `iam.iam_audit_logs` | Bỏ cột `active_role_id`, COMMENT và FK `fk_audit_logs_active_role_id` |
| `iam.iam_roles` | Cập nhật COMMENT: Role là pack quyền, Account có thể có nhiều Role |
| `iam.iam_sessions`, `iam.iam_audit_logs` | Cập nhật COMMENT, xóa tham chiếu `SWITCH_ROLE` và Working Context |
| Ghi chú cuối DDL | Thay kiểm tra active role bằng quy tắc tính quyền tổng hợp |

Không thêm bảng, cột hoặc quan hệ. Các bảng cấp quyền (`iam_roles`, `iam_permissions`, `iam_role_permissions`, `iam_user_roles`, `iam_user_permissions`) và các ràng buộc của chúng không thay đổi.

**Số lượng sau thay đổi (kiểm kê SQL):** 11 bảng; 16 khóa ngoại khai báo qua `ALTER TABLE`; 18 chỉ mục khai báo qua `CREATE INDEX`/`CREATE UNIQUE INDEX`; 12 `CHECK` constraints. Không bao gồm implicit indexes sinh bởi PK.

## 3. Quy tắc phân quyền v0.3

`Effective Grants = (Permissions from all currently valid assigned Roles ∪ Direct ALLOW) − Direct DENY`

Backend vẫn phải xác minh account/membership, trạng thái Role, quyền đã thu hồi/hết hạn, `minimum_assurance_level` và trạng thái email/credentials theo đặc tả v0.2. Role không tạo Working Context.

## 4. Giữ nguyên hoặc chưa quyết định

- Giữ một Account hiện hành trên một Membership bằng partial unique index `WHERE disabled_at IS NULL`; có thể lưu Account lịch sử đã vô hiệu hóa.
- Giữ các bảng Membership, Credentials, Verification, Sessions, Audit, External REF theo v0.2.
- **Chưa thay đổi** các bất nhất COMMENT/constraint vốn có của v0.2 (`LOCKED`/`SUSPENDED`, `FAILURE`/`FAILED`); cần giải quyết riêng trước khi phê duyệt baseline implementation.
- Chưa chốt chính sách email hiệu lực, các cạnh lifecycle Account/status và hợp đồng đồng bộ HR; không tự suy diễn giải pháp.
- Bản đặc tả Markdown v0.2 vẫn chứa phần Role Switching và cần có bản đặc tả v0.3 đồng bộ trước khi implementation, nhưng tài liệu gốc không bị sửa.

## 5. Giới hạn thực thi

File SQL v0.3 là **bản thiết kế DDL đầy đủ để review**, không phải `ALTER TABLE` migration từ database đã có. Chỉ chạy trên database Development trống sau khi User phê duyệt DDL cuối cùng. Chưa chạy SQL trên PostgreSQL 18, chưa tạo schema/tables, chưa triển khai Prisma migration và chưa cập nhật GitHub.
