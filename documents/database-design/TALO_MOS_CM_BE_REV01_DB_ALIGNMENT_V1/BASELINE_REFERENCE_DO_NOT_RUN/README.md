# Bản gốc dùng tham chiếu — KHÔNG CHẠY

Ba file SQL này được trích nguyên từ ZIP `CM_DB_REV01_SQL_CANDIDATE_20261029-130635_R2.zip`, vốn là **bản ứng viên R2**, không phải bản dump thực tế từ TEST đã triển khai.

Không chạy lại `03_TABLES_DDL.sql`, `04_INDEXES.sql`, `06_GRANTS_PROPOSAL.sql` trên TEST. Chúng chỉ phục vụ kiểm tra diff và tên object. Phải đọc snapshot schema TEST trước khi migration.
