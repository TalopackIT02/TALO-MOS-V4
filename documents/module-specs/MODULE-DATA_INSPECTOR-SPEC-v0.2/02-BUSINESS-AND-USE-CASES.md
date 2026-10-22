# 02 — Nghiệp vụ và use case

> TALO-MOS-V4 | DATA_INSPECTOR | Hồ sơ v0.2 DRAFT | Package/MIC dự kiến 0.1.0 | 22/10/2026 | Repo `main` `fafc4d5f5e0215d40dc9ee7308d23973d1a7b19d`
> USER REVISED SCOPE (22/10/2026). Chỉ thiết kế; không cấp IAM/SQL privileges, không sửa Foundation/Host, không deploy. Bằng chứng runtime: NOT_TESTED.

## Actor, mục tiêu

**Actor duy nhất được phép**: session thuộc IAM account có username DB đúng chuỗi `admin`, IAM effective grant cho Function.Action tương ứng, account ACTIVE, module ENABLED + đúng 1 ACTIVE version. Không sử dụng tên `admin` nhận từ frontend. Các account khác kể cả được gán role cao hơn đều không truy cập.

## Use cases

| UC | Luồng bình thường | Ngoại lệ |
|---|---|---|
| UC-01 | `admin` vào module, nhận danh sách **tất cả** bảng được catalog của PostgreSQL trả về | Chưa có IAM grant/active: menu không hiện hoặc API 403/503 |
| UC-02 | Lọc nhanh theo tên schema/tên bảng | Không tìm được: empty state |
| UC-03 | Chọn bảng, xem tên cột, data type, nullable, PK nếu biết | Bảng drop/rename khi đang xem: CATALOG_CHANGED |
| UC-04 | Xem 50 dòng/trang, chuyển trang | Timeout/RLS/không SELECT: thông báo chính xác, không nâng quyền |
| UC-05 | Account khác thử deep link hoặc API | 403, không trả metadata/rows |
| UC-06 | `admin` bị disable/revoke grant, module disable | Từ chối request tiếp theo |

## Bất biến nghiệp vụ

- `eligible = valid_session ∧ db_username_exactly_admin ∧ valid_IAM_permission ∧ lifecycle_enabled_and_one_active`.
- Việc username bằng `admin` **không làm thay đổi** logic IAM direct DENY ưu tiên, account status hay minimum assurance.
- List là tất cả quan hệ loại bảng của *database đang kết nối*, không đồng nghĩa tất cả database trên PostgreSQL server/cluster.
- Không bao gồm chức năng UPDATE/DELETE/INSERT, DDL, chạy SQL bất kỳ, export, role management, backup/restore.
- Danh sách metadata không suy ra quyền xem giá trị. Với bảng `NOT_READABLE`, không trả dữ liệu. Với RLS, chỉ trả rows mà SQL role thực tế nhìn thấy, không “bypass”.
- Người dùng yêu cầu quan sát, không quy định che mật khẩu/token/hash; vì vậy **không tự thêm mask policy gây sai mô tả xem toàn bộ**. Trước nghiệm thu cần minh thị đánh giá nguy cơ xem hash/tokens, xem Decision Log.

## Acceptance criteria (đặc tả; chưa test)

- Dưới DB thật, catalog liệt kê đầy đủ bảng phù hợp relkind trong tất cả schema (kể cả hệ thống) và có thông tin read capability của từng bảng.
- `admin` xem được dữ liệu đã có quyền SELECT, chuyển trang mà không tự động ghi bất kỳ dữ liệu nào.
- Người dùng khác không thấy menu sau **quy trình cấp quyền IAM giới hạn**, và luôn bị 403 ngay cả khi gọi API trực tiếp.
- Không có endpoint thay đổi DB và toàn bộ SQL truy vấn nằm trong transaction read-only.
