# PROMPT CLAUDE CODE — CRITICAL, NO EXECUTION

Claude Code, đọc thư mục:
`D:\Documents\ClaudeProject\TALO-MOS-V4\documents\database-design\TALO_MOS_CM_V1_REV01_SQL_HANDOFF`

Nhiệm vụ: **SỬA/VIẾT NGAY** gói SQL Candidate Customer Management **REVISION 01** từ bộ hồ sơ này. Đây là phạm vi được chủ dự án chốt hướng xây dựng: **11 bảng / 114 cột** (7 bảng nghiệp vụ + 4 bảng địa lý), thêm `cm.customer_code_seq`, KHÔNG dùng nguyên gói draft 7/76 và KHÔNG quay về 27 bảng RC2.

1. Đọc `README.md`, `00..08`, dictionary JSON + CSV; tìm gói SQL nháp cũ tại `D:\Documents\ClaudeProject\TALO-MOS-V4_exports\CM_DB_V1_SQL_DRAFT_20261029-115639`, **chỉ đọc**, tái sử dụng phần đúng rồi sửa theo REV01.
2. Đối chiếu metadata TEST hiện hành ở chế độ chỉ đọc nếu có quyền; không truy vấn thông tin cá nhân, không thay đổi DB. Chốt SQL PK/FK/UNIQUE/CHECK/GRANT; xử lý OI-01 tạo PERSON/HOUSEHOLD, OI-03 SCC PII bằng cảnh báo rủi ro TEST, OI-04 role/schema bằng script proposal riêng. Không phát sinh thêm bảng/cột.
3. Sử dụng nguồn Nhà nước được liệt kê trong `05_OFFICIAL_SOURCES_AND_SEED_GATE.md`, kiểm tra văn bản cập nhật; tạo seed có căn cứ cho tỉnh/xã và vùng. Khi chưa lấy được đủ dữ liệu cấp xã, đánh dấu `SEED_BLOCKED`; **không bịa ward**, nhưng vẫn hoàn thành DDL Candidate.
4. Cung cấp đầy đủ các file trong `08_SQL_PACKAGE_CONTRACT.md`, kiểm tra tĩnh, manifest SHA-256, rollback có guard. Xuất ZIP ngoài repo tại `TALO-MOS-V4_exports`.
5. **KHÔNG CHẠY SQL** dưới bất kỳ hình thức nào, kể cả thử DDL trên TEST, vì `GO_SQL_EXECUTION = NO`; không sửa Foundation/IAM/SCC/Prisma/Backend/Frontend, không commit/merge/deploy.

Kết quả: `READY_FOR_EXECUTION_REVIEW` (hoặc `READY_FOR_DDL_REVIEW / SEED_BLOCKED` với nguồn ward thiếu), kèm bảng sai khác và các điểm thực sự cần chủ dự án duyệt ở gate **EXECUTION**. Không dừng để hỏi lại những điều đã quy định rõ trong tài liệu. Hoàn tất thì DỪNG.
