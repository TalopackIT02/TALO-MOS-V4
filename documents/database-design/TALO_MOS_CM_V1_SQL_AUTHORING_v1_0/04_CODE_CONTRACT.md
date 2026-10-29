# 04 — Quy ước mã cho các trường phân loại (không có bảng catalog)

Các cột `_code` vẫn là `varchar(30)`. **Không tạo bảng danh mục, enum PostgreSQL hay CHECK cứng danh sách mã** trong V1. Backend sau này kiểm tra mã và hiển thị nhãn.

| Bảng.cột | Mã dự kiến dùng | Ghi chú |
|---|---|---|
| `cm_customers.customer_type_code` | `COMPANY`, `PERSON` | Mặc định COMPANY |
| `cm_customers.customer_status_code` | `PROSPECT`, `NEW`, `ACTIVE`, `PAUSED`, `CLOSED` | Mặc định PROSPECT; trạng thái NEW/ACTIVE chuyển theo Sales Order sau này |
| `cm_customer_activities.activity_type_code` | `NOTE`, `CALL`, `MEETING`, `TASK`, `FOLLOW_UP`, `HANDOVER` | Mã công việc Sale cơ bản |
| `cm_customer_activities.activity_status_code` | `OPEN`, `DONE`, `CANCELLED` | Mặc định OPEN; việc còn tồn là OPEN |
| `cm_customer_documents.document_type_code` | `LEGAL`, `CONTRACT`, `AUTHORIZATION`, `OTHER` | Mã loại tài liệu |

**V1 không tự cập nhật trạng thái khách hàng khi có đơn hàng**, bởi Sales Order chưa được xây. Không có logic phát sinh công nợ ở đây.

Các mã là hợp đồng ứng dụng để phục vụ soạn SQL, không phải yêu cầu tạo bảng hay seed. Tên code có thể mở rộng trong Backend theo phiên bản, nhưng không đổi database trừ khi có phê duyệt riêng.
