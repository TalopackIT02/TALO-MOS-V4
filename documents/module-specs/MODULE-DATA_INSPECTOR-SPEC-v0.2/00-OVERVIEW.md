# 00 — Tổng quan và phạm vi cố định

> TALO-MOS-V4 | DATA_INSPECTOR | Hồ sơ v0.2 DRAFT | Package/MIC dự kiến 0.1.0 | 22/10/2026 | Repo `main` `fafc4d5f5e0215d40dc9ee7308d23973d1a7b19d`
> USER REVISED SCOPE (22/10/2026). Chỉ thiết kế; không cấp IAM/SQL privileges, không sửa Foundation/Host, không deploy. Bằng chứng runtime: NOT_TESTED.

## Yêu cầu đã được chủ dự án xác nhận

`DATA_INSPECTOR` là trình xem **toàn bộ các bảng PostgreSQL trong database mà backend hiện kết nối**, dành riêng cho tài khoản có **username chính xác là `admin`**. Không có CRUD, hành động quản lý DB, SQL editor, export/import, sửa schema, restore/backup, switch account hoặc cấp quyền.

Giao diện đơn giản: danh mục tất cả bảng (schema.table) ở cột trái, xem cấu trúc và các dòng của bảng được chọn ở cột phải. Phân trang chỉ để hiển thị bảng lớn. Module chỉ **đọc bằng Host `readOnly`**; không được mở rộng SQL SELECT so với DB role hiện hữu.

## Phạm vi quyền

1. **Điều kiện hard-coded trong backend module**: sau Host session/IAM, lấy `username` tương ứng với `actor.userAccountId` từ chính DB `iam.iam_user_accounts` qua `readOnly`. Chỉ nhận chính xác `admin`; không tin tên/role/userId từ frontend, cookie tự chế hay request header. Không tra được hoặc không đủ quyền => DENY/FAIL CLOSED.
2. **IAM tiếp tục bắt buộc**: `CATALOG.READ` và `ROWS.READ`, tài khoản ACTIVE, không bị direct DENY, module ENABLED và đúng 1 version ACTIVE. `admin` không phải IAM bypass.
3. **Hiển thị menu chỉ admin**: menu Foundation hiện chỉ lọc bởi IAM permission và lifecycle, *không lọc username*. Do đó chưa thể bảo đảm ẩn tuyệt đối với mọi tài khoản khác nếu permission được cấp nhầm. Không sửa Foundation trong gói này. Cần thủ tục IAM riêng cấp hai quyền **duy nhất** cho `admin`, không cấp qua role chung; kiểm thử menu. Đây là **BLOCKER G7** cho yêu cầu chỉ admin thấy menu, vì IAM policy/provision chưa được thực hiện.
4. **Toàn bộ bảng**: liệt kê mọi base/partitioned table thực tế từ `pg_catalog` trên **tất cả schema** của database hiện kết nối, kể cả IAM, Foundation, pg_catalog, pg_toast nếu metadata trả về. Không dùng allowlist schema làm hẹp catalog. Các bảng không có quyền SQL SELECT vẫn xuất hiện kèm `NOT_READABLE`; tuyệt đối không tự GRANT/SET ROLE/bypass RLS để đọc.
5. **Toàn bộ cột/dòng**: chỉ có thể thực tế hiển thị các giá trị mà role SQL hiện hữu cho phép SELECT; không được tuyên bố “xem tất cả giá trị” nếu role không có quyền, RLS lọc hoặc truy vấn vượt 5 giây. Bảng nhạy cảm (password hashes, token hashes) là nguy cơ hiện diện; không tự thay chính sách mask khi chưa được phê duyệt.

## Đặc tả kỹ thuật tóm lược

| Hạng mục | Thiết kế |
|---|---|
| Module Key | `DATA_INSPECTOR` |
| Function/Action | `CATALOG.READ`; `ROWS.READ` |
| UI | `data.inspector`, route `/data-inspector`, một tab Host, hai vùng dữ liệu |
| API | 3 `GET`: tables / columns / rows |
| Database | Không tạo table/index/view; không migration; không SQL GRANT |
| MIC-1.0 | 10 phần, MIC07 K05 1:1, MIC10 `NOT_TESTED` |
| Status | `SPEC_CONDITIONAL`; hardcode username có thiết kế khả thi, **G7 menu + SELECT toàn bộ: UNVERIFIED/BLOCKED** |

**Những điều không được tự suy ra**: `admin` đang tồn tại/ACTIVE; `talo_app` đọc được `iam.iam_user_accounts`; IAM grants đã cấp; mọi bảng đều SELECT được; menu chỉ admin đã được thiết lập; package đã cài hoặc được activate.
