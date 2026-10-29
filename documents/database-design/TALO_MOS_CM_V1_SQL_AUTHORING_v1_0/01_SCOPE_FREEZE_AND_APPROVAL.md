# 01 — Khóa phạm vi & phê duyệt tác giả SQL

## Scope V1 được chủ dự án thu hẹp

| # | Bảng | Tên Việt | Số cột | Phạm vi |
|---:|---|---|---:|---|
| 1 | `cm_customers` | Hồ sơ khách hàng | 18 | Định danh, pháp lý cơ bản, địa chỉ, khu vực, trạng thái |
| 2 | `cm_customer_contacts` | Người liên hệ | 12 | Nhiều người liên hệ, chính/phụ, phone/Zalo |
| 3 | `cm_customer_groups` | Danh mục nhóm khách hàng | 8 | Nhóm khách hàng phân cấp |
| 4 | `cm_customer_group_members` | Phân nhóm khách hàng | 4 | Gán nhiều nhóm, cho phép gỡ/gán lại |
| 5 | `cm_customer_assignments` | Phân công & bàn giao Sale | 11 | Lượt phân công, Sale hiện tại, người bàn giao/nhận |
| 6 | `cm_customer_activities` | Hoạt động và công việc Sale | 12 | Nhật ký, lịch hẹn, việc tồn |
| 7 | `cm_customer_documents` | Tài liệu khách hàng | 11 | Metadata tệp pháp lý, đính kèm; không lưu file nhị phân |
| | **Tổng** | | **76** | **Đúng 7 bảng** |

## Không làm trong gói này

- Không tạo 20 bảng bị loại khỏi 27-table RC2.
- Không tạo danh mục địa giới, ngân hàng, đơn vị tiền tệ, bảng riêng khách hàng-pháp lý, ngân hàng, điều kiện thanh toán.
- Không tạo `orders`, `products`, `warehouse`, `receivables`, `payables`, `payments`, `balances`, `customers_ledger` hoặc số dư công nợ trong CM.
- Không làm Backend, Frontend, MIC, Prisma model, trigger audit, procedure, view nghiệp vụ, function sinh mã khách hàng.
- Không seed khách hàng hoặc dữ liệu giả; mã được chuẩn hóa ở tầng Backend sau này.

## Phạm vi thẩm quyền

- **GO_SQL_AUTHORING_ONLY = YES**: yêu cầu hiện tại của chủ dự án là tạo gói SQL nháp theo chính xác tài liệu này.
- **GO_SQL_EXECUTION = NO**: không một câu lệnh SQL thay đổi trạng thái nào được chạy.
- **GO_DEPLOY = NO**; **GO_GIT_CHANGE = NO**.
- Thiết kế schema tên `cm`, owner NOLOGIN đề xuất `talo_cm_owner`. Chỉ được viết file đề xuất, chưa có quyền tạo schema/role.
- Nếu mã nguồn thực tế làm không thể viết chính xác nháp với giả định trên, **ghi rõ** `IMPLEMENTATION_BLOCKER`; vẫn cung cấp phần nháp an toàn có thể xác định, không tự điều chỉnh cấu trúc.

## Hủy hiệu lực phạm vi tài liệu cũ

- Các gói CM 27 bảng v0.1, RC1, RC2 vẫn là tham chiếu lịch sử; không phải baseline triển khai V1.
- Các approval `NOT APPROVED` trong RC2 **không chặn công việc soạn nháp 7 bảng**, song vẫn có ý nghĩa là chưa được phép áp dụng DDL của RC2.
- Việc thay thế phạm vi này **không mở quyền sửa Foundation/IAM**.
