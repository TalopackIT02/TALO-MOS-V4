# 12 — Quyết định OWNER và các blockers

> TALO-MOS-V4 | DATA_INSPECTOR | Hồ sơ v0.2 DRAFT | Package/MIC dự kiến 0.1.0 | 22/10/2026 | Repo `main` `fafc4d5f5e0215d40dc9ee7308d23973d1a7b19d`
> USER REVISED SCOPE (22/10/2026). Chỉ thiết kế; không cấp IAM/SQL privileges, không sửa Foundation/Host, không deploy. Bằng chứng runtime: NOT_TESTED.

## Các điều đã được chủ dự án quyết định (22/10/2026)

| ID | Nội dung | Trạng thái |
|---|---|---|
| DEC-01 | Chỉ tài khoản có **username `admin`** có quyền sử dụng module, gắn cứng | **CONFIRMED_FROM_USER** |
| DEC-02 | Module xem toàn bộ bảng của PostgreSQL DB kết nối, tất cả schema | **CONFIRMED_FROM_USER** |
| DEC-03 | Chỉ xem; không có thao tác thay đổi DB, không tự cấp quyền | **CONFIRMED_FROM_USER** |
| DEC-04 | Không sửa IAM–Foundation để triển khai module này | **CONFIRMED_FROM_USER** (từ chỉ đạo trước) |
| DEC-05 | Giao diện tối giản danh mục và dữ liệu bảng | DERIVED/PROPOSED |

Các quyết định này **chốt nghiệp vụ**, không đồng nghĩa approve IAM grant, DB SQL GRANT hoặc code deployment.

## Vấn đề còn cần kiểm chứng/phê duyệt

| ID | Vấn đề | Trạng thái / ảnh hưởng |
|---|---|---|
| BL-01 | Menu Foundation B09 lọc theo IAM, không theo username. Muốn chỉ admin thấy cần IAM direct permission provisioning riêng; nếu cấp nhầm cho người khác menu có thể lộ. | **BLOCKER G7 strict menu-only**. Không tự sửa Foundation; Owner chọn chấp nhận IAM-only menu policy hoặc duyệt thay đổi riêng |
| BL-02 | Hai IAM permissionCode proposed chưa xác minh tồn tại / được grant độc quyền admin. | **BLOCKER activation**. Không auto-create/grant |
| BL-03 | Host SQL role thực tế có SELECT đối với `iam.iam_user_accounts` để thực thi hardcoded admin gate hay không? | **VERIFICATION_REQUIRED**. Thiếu thì fail closed, không tự GRANT |
| BL-04 | SQL role có thể không SELECT tất cả bảng và RLS có thể che dòng. “Show tất cả bảng” đáp ứng metadata nếu catalog đọc được, **không bảo đảm toàn bộ giá trị**. | **TECHNICAL LIMITATION**. Owner không được hiểu là đã mở full read |
| BL-05 | Data sensitivity: `iam_credentials`, `iam_sessions`, bảng bí mật; mở full table view có thể lộ hash/PII. | **OWNER RISK REVIEW REQUIRED** trước production; không tự mask/loại trừ trong spec khi người dùng yêu cầu all tables |
| BL-06 | View/foreign/materialized table có cần được xem như table? `pg_class.relkind` r/p mới là base/partitioned table. | **OPEN SCOPE DECISION**, mặc định chỉ base/partitioned theo ngữ nghĩa PostgreSQL |
| BL-07 | B01/B02 history, `INITIAL_REGISTRATION` hợp lệ, route collision, menu B09 row, SQL privilege, target test DB | **UNVERIFIED** |
| BL-08 | Chỉ mục/khóa sắp xếp, tốc độ table lớn, row count exact hay estimated | **PROPOSED**, cần TEST trước xác nhận |
| BL-09 | Read-success durable audit và log retention chưa có universal Host API | **OPEN**. Không insert vào bảng IAM/Foundation |

## Đánh giá kỹ thuật

`SPEC_CONDITIONAL`: BRS admin-only/all-schema/read-only đã rõ, MIC và manifest có thể chuẩn hóa tĩnh. **G5 coding, G6 TEST, G7 activation chưa được ủy quyền**. Có thể thiết kế backend admin hardcode bên trong module mà không chỉnh IAM–Foundation; yêu cầu menu strict cần IAM provision riêng và chính sách về permission misgrant. `STATIC_PASS` chỉ sau checker có log; chưa có bằng chứng runtime.

**Owner review còn cần:** xác nhận cách xử lý khi cấp nhầm IAM READ cho user khác (menu lộ nhưng API deny), mức cho phép hiển thị bảng chứa thông tin nhạy cảm, và liệu “tất cả bảng” có bao gồm views/materialized/foreign hay chỉ base/partitioned.
