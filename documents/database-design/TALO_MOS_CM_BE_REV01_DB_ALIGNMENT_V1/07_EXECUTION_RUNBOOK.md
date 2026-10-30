# Runbook — không tự triển khai

1. **Đọc baseline:** `SOURCE_CM_BE_SPEC_REV01.md`, R2 SQL và execution report trên máy. So metadata TEST live bằng `04_CURRENT_SCHEMA_EXPORT.md`.
2. **Khoá diff:** 11 tables / 114 cols / 25 indexes theo TEST. Nếu khác: `SCHEMA_DRIFT_STOP`; không sửa bằng phỏng đoán.
3. **Đối chiếu Foundation/MIC/IAM:** tìm audit API, function key, data access MIC-06, ownership, grant column. Ghi rõ phần chưa hỗ trợ.
4. **Sửa SQL Candidate tối thiểu:** chỉ sửa sự khác biệt đã chứng minh; liệt kê delta từng dòng. Không `CREATE ... IF NOT EXISTS` để che drift.
5. **Clone + static:** lấy clone cách ly từ TEST, không mạng; tạo **container PostgreSQL clone cách ly**, đặt tên DATABASE BÊN TRONG CLONE là `talo_mos_v4_test` để giữ nguyên guard của ứng viên; chỉ chạy trong clone khi đã xác minh CONTAINER ID và network isolation. Giữ log, negative tests và thử rollback trên clone riêng. KHÔNG sửa guard của ứng viên bằng sed.
6. **Package:** migration, grants, verification, `preflight`, safe rollback/backout, runbook, 50 test mapping, manifest SHA256. Kiểm tra file trong ZIP với manifest.
7. **STOP Gate:** giao chủ dự án + ChatGPT báo cáo `READY_FOR_CM_BE_DB_TEST_APPROVAL`. Không chạy trên TEST khi chưa có GO riêng. Nếu được GO: backup `pg_dump` có checksum, khóa SHA SQL, chạy qua `admin` đúng TEST, hậu kiểm với `talo_app`, fingerprint IAM/Foundation, cung cấp logs. Nếu lỗi dừng, không rollback mù.

**Quan trọng:** SQL được viết như một *transaction candidate*. PostgreSQL đang chạy và có nhiều dịch vụ; DDL giữ lock ngắn, tránh cập nhật Foundation. Bước chạy thật cần xác nhận người dùng không có thao tác ghi CRM đang mở. Gói không chứa script DROP dữ liệu tự động. Backup TEST và rollback theo hiện trạng dữ liệu là bắt buộc tại Gate.
