# Source trace

1. Người dùng gửi gói tiền kiểm gốc `TALO_MOS_CM_DB_PREFLIGHT_v0_1.zip` (ngữ cảnh hội thoại) và báo cáo Claude Code `CM_DB_PREFLIGHT_20261029-105936.zip` (gốc kèm 4 evidence).
2. `evidence/CM_FOUNDATION_PREFLIGHT_REPORT.md`: §§1–10; quyết định §7 là nguồn chính cho các D-CM-01..15.
3. `evidence/Q01-Q19_catalog_metadata.json`: metadata TEST được xuất bởi script read-only.
4. `evidence/Q20-Q21_column_function_privileges.json`: column grants/functions metadata.
5. `evidence/cm_preflight_meta.cjs`, `evidence/colacl.cjs`: script dùng cho metadata; không chạy lại trong cuộc rà soát này.
6. `03/04/05` và `inventory`: giữ từ điển ứng viên của gói `TALO_MOS_CM_DB_REVIEW_v0_2_RC1`, cập nhật trạng thái đã có bằng chứng; các đổi tên PK vẫn chỉ là đề xuất.

Thông tin về mã nguồn Foundation/IAM/FBE-01B trong RC2 được trích qua báo cáo Claude, **chưa kiểm mã nguồn trực tiếp từ repo của người dùng**.
