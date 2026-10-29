# 10 BẢNG DANH MỤC CUSTOMER — v0.2-RC2 (ứng viên giữ nguyên từ RC1)

> **CHƯA DUYỆT.** 10 bảng NEW trên TEST theo báo cáo gốc và metadata TEST. Giữ nguyên `code` PK như v0.1, **ngoại lệ có chủ ý** so với khuynh hướng PK `<entity>_id`. Chỉ đổi sang PK UUID khi toàn văn báo cáo/DDL pattern và chủ dự án đồng ý; không tự thêm cột UUID.

## Mẫu cột sử dụng ở cả 10 bảng

| Cột | Kiểu PostgreSQL | NULL | Khóa / Quy định |
|---|---|---|---|
| code | varchar(30) | Không | PK — **cần phê duyệt ngoại lệ naming** |
| name | varchar(150) | Không | Tên hiển thị |
| description | text | Có | Mô tả |
| sort_order | integer | Không | DEFAULT 0 |
| is_active | boolean | Không | DEFAULT TRUE |
| created_at | timestamptz | Không | DEFAULT CURRENT_TIMESTAMP |
| retired_at | timestamptz | Có | Retention policy chưa chốt |

## Danh mục và mục tiêu

| Bảng | Mục đích | Seed / ví dụ (không tự phát sinh thêm) |
|---|---|---|
| cm_ref_customer_status | Trạng thái khách hàng | PROSPECT, NEW, ACTIVE, PAUSED, CLOSED |
| cm_ref_entity_types | Loại khách hàng | COMPANY, PERSON |
| cm_ref_contact_roles | Vai trò người liên hệ | Liên hệ chính, Thu mua, Kế toán, Khác |
| cm_ref_address_types | Loại địa chỉ | Giao hàng, Nhận chứng từ, Khác |
| cm_ref_payment_methods | Phương thức thanh toán | BANK_TRANSFER, CASH, OTHER |
| cm_ref_activity_types | Loại hoạt động | Liên hệ, Khảo sát, Thu thập thông số, Tư vấn, Báo giá, Đàm phán, Hợp đồng, Thiết kế, Đơn hàng, Chăm sóc |
| cm_ref_activity_statuses | Trạng thái hoạt động | PLANNED, IN_PROGRESS, DONE, CANCELLED |
| cm_ref_document_types | Loại giấy tờ | Đăng ký kinh doanh, Hợp đồng, Hồ sơ thuế, Khác |
| cm_customer_sources | Nguồn khách hàng | Giới thiệu, Website, Tự tìm kiếm... |
| cm_customer_industries | Ngành nghề/phân loại | Ngành nghề do doanh nghiệp quản lý; tránh trùng Master Data nếu có |

Danh mục dùng mã nghiệp vụ ổn định. Các mã seed chưa được xác định trong v0.1 không được tự đặt thêm. Chưa có SQL `INSERT` trong gói này.
