# MẪU PROMPT — CHỈ SỬ DỤNG SAU KHI OWNER DUYỆT GÓI SQL ĐÃ DRY-RUN

Claude Code, tôi cấp **GO thực thi migration CM Backend REV01 trên `talo_mos_v4_test` בלבד**, với đúng package/hash đã duyệt: [điền đường dẫn ZIP và SHA-256 thực tế].

1. Đối chiếu live TEST với preflight/manifest đã khóa; thấy drift thì DỪNG.
2. Backup `pg_dump` đúng TEST, xác minh đọc được, ghi SHA-256; không đưa dump vào repo.
3. Thực thi theo runbook gói đã duyệt, admin/role đúng, kiểm nghiệm theo từng bước.
4. Read-only verification sau thi công, kiểm grants qua `talo_app`, audit fingerprint Foundation/IAM trước và sau, giữ seed/mã khách và không sửa dữ liệu CRM ngoài phạm vi migration.
5. Xuất báo cáo, SQL log, backup checksum, manifest; khi FAIL, DỪNG, không tự rollback mù.

**Không áp dụng prompt này trước khi có phê duyệt chính thức của chủ dự án và SHA ứng viên cuối.** Không DEV, PROD, commit, deploy, sửa Foundation/IAM/Backend/Frontend.
