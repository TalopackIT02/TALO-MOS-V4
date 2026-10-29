# 07 — Đầu ra Claude Code và điều kiện nghiệm thu bản SQL nháp

Đặt mọi file đầu ra bên ngoài repo trong `D:\Documents\ClaudeProject\TALO-MOS-V4_exports\CM_DB_V1_SQL_DRAFT_<timestamp>\`.

## File bắt buộc (tên gợi ý)

- `README.md`, `SOURCE_AND_ASSUMPTIONS.md`, `OPEN_ISSUES.md` — chốt baseline, repo SHA/branch, đề xuất còn cần ký.
- `01_preflight_readonly.sql` — truy vấn catalog/guard TEST; **không SQL thay đổi**.
- `02_owner_schema_PROPOSED.sql` — đề xuất tạo `talo_cm_owner` NOLOGIN và schema `cm` (nếu thiếu), chờ DBA/owner duyệt.
- `03_cm_v1_7_tables_DDL_PROPOSED.sql` — DDL đầy đủ đúng 7 bảng, 76 cột, 7 FK.
- `04_cm_v1_indexes_PROPOSED.sql` — partial UNIQUE và index đúng hợp đồng.
- `05_cm_v1_grants_PROPOSED.sql` — GRANT tối thiểu từng bảng/cột, không `GRANT ALL`.
- `06_verify_readonly.sql` — kiểm tra metadata sau khi được cấp phép chạy trong Gate riêng (bản thân hiện tại chưa chạy).
- `90_rollback_PROPOSED.sql` — chỉ là phương án rollback cần duyệt; không mặc định DROP dữ liệu; giải thích rủi ro và điều kiện backup.
- `RUNBOOK_NO_EXECUTION.md`, `MANIFEST_SHA256.txt`, `VALIDATION_REPORT.md` — thao tác đề xuất và bằng chứng tĩnh.

## Tiêu chí nghiệm thu bản nháp

1. Exactly **7 `CREATE TABLE` / 76 cột**, đúng tên/kiểu/NULL/default/khóa trong inventory.
2. 7 FK `ON DELETE RESTRICT`; 2 partial unique; 4 nhóm CHECK; PK/UNIQUE/Index được nêu rõ.
3. Không tạo danh mục/Master Data/seed/Prisma/API/MIC.
4. `cm_customer_assignments` có thể quản lý lịch sử, chỉ một người phụ trách hiện hành, chuyển giao theo transaction ở Backend sau này.
5. `cm_customer_documents` chỉ metadata, không lưu binary, không ghi đè file cũ.
6. SQL schema-qualified, guard tránh thực thi sai DB, quyền runtime hạn chế.
7. Không chạy SQL, không truy cập DEV/PROD; log kiểm tra không chứa secret hoặc dữ liệu người dùng.
8. Sẵn sàng review trước **Gate SQL EXECUTION** riêng, có backup pg_dump -Fc và rollback có phê duyệt.
9. Không sửa file repo/branch/commit, không deploy hay restart.

Kết quả Claude báo `READY_FOR_SQL_REVIEW` nếu đủ nháp và static validation, hoặc `PARTIAL_DRAFT_NEEDS_OWNER_DECISION` với thiếu sót cụ thể. **Không dùng `BLOCKED_FOR_SQL_AUTHORING` chỉ vì bản RC2 27 bảng chưa được ký**: phạm vi đã được chủ dự án thay thế.
