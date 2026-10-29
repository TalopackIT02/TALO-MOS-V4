# 09 — Nguồn & quyết định

## Sự kiện được người dùng xác nhận trong phiên

- TALO-MOS Foundation + IAM hiện hoạt động; Customer được xây Database trước rồi Backend/Frontend/MIC sau.
- Mục tiêu ban đầu xuyên suốt: **"Ai nợ – nợ bao nhiêu"** ở chuỗi Sales → Kho → Kế toán. Customer V1 chỉ giữ định danh/pháp lý/công việc Sale, bàn giao khi nghỉ.
- Chủ dự án chấp nhận **7 bảng Customer V1**, và yêu cầu gói để Claude soạn SQL Data.
- 7 bảng/76 cột ở bảng tổng quan trước chỉ là số dự kiến. Gói này **lần đầu khóa chính xác danh sách 76 cột**; là đặc tả đề xuất để viết SQL nháp, **chưa có phê duyệt chạy SQL**.
- Thiết kế `cm_customer_documents` theo trao đổi đã chốt: metadata, file nằm ngoài DB, bản mới không ghi đè file cũ.

## Bằng chứng khảo sát Claude Code đã cung cấp

- `CM_DB_PREFLIGHT_20261029-105936.zip`: PostgreSQL TEST 18.6, Foundation không chạy DDL, `talo_app` không CREATE, PK `<entity>_id`, role actor `uuid`, không FK sang IAM, không có Master Data.
- `CM_DB_SQL_AUTHORING_GATE_20261029-112110.zip`: gói 27 bảng RC2 bị block vì 15 quyết định đang PENDING. Đây là trạng thái của **thiết kế cũ**, không phải lệnh cấm soạn nháp cho phạm vi 7 bảng mới.

## Quyết định kỹ thuật trong gói mới

- `cm` schema + `talo_cm_owner`: **đề xuất cho script**, không khẳng định đã tạo hoặc phê duyệt để triển khai.
- Không Master Data/lookup; cột mã text chuẩn hóa ở backend, thiết kế mở rộng được.
- Không FK sang `iam` và không sửa IAM/Prisma.
- Chính sách SQL/hạ tầng của hệ thống phải kiểm chứng lại theo thời điểm Claude soạn nháp.
