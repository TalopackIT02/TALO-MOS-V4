# TALO-MOS — CUSTOMER MANAGEMENT V1 — SQL AUTHORING PACKAGE

**Package:** `TALO_MOS_CM_V1_SQL_AUTHORING_v1_0`  
**Date:** 2026-10-29  
**Status:** `GO_SQL_AUTHORING_ONLY` / `NO_GO_SQL_EXECUTION`  
**Bounded scope:** **7 bảng / 76 cột** tại schema đề xuất `cm`; KHÔNG lập Master Data mới.

## Mục tiêu thực tế

- Biết khách hàng là ai, pháp lý cơ bản, số MST và cách liên hệ.
- Ghi nhật ký Sale, theo dõi việc chưa xong và tiếp nhận bàn giao khi Sale nghỉ.
- Cung cấp khóa `customer_id` cho Sales Order / Accounting tích hợp về sau.
- KHÔNG lưu nợ phải thu/phải trả, tiền trả, giá trị giao hàng trong Customer V1. Câu hỏi **"Ai nợ — nợ bao nhiêu"** được trả lời sau khi xây Kế toán dựa trên dữ liệu phát sinh có căn cứ.

## Thứ tự đọc

1. `01_SCOPE_FREEZE_AND_APPROVAL.md` — ranh giới và quyền **viết SQL nháp**, không chạy.
2. `02_DATA_DICTIONARY_7_TABLES.md` / `02_COLUMN_INVENTORY_76.csv` / `02_SCHEMA_SPEC.json` — hợp đồng **chính xác 76 cột**.
3. `03_CONSTRAINTS_AND_HANDOVER.md` — FK, partial unique, CHECK, vòng đời, bàn giao.
4. `04_CODE_CONTRACT.md` — giá trị mã vận hành, không seed bảng danh mục.
5. `05_FOUNDATION_ALIGNMENT.md` — bằng chứng tiền kiểm, lối triển khai FBE-01B.
6. `06_DDL_AND_GRANTS_CONTRACT.md` — nội dung SQL phải viết, quyền dự kiến.
7. `07_DELIVERABLE_AND_ACCEPTANCE.md` — thư mục đầu ra, kiểm tra, NO-RUN.
8. `08_PROMPT_CLAUDE_CODE.md` — prompt chạy với Claude Code.

## Phân biệt cấp quyền

- **Được phép:** Claude chỉ viết các **file SQL nháp và tài liệu đối chiếu**, đặt ngoài repo, rà soát mã nguồn/metadata theo chế độ chỉ đọc.
- **Chưa được phép:** chạy bất kỳ SQL làm thay đổi DB, GRANT, `CREATE ROLE`, DML/seed, migration, sửa repo/Prisma/Frontend/Backend/MIC, deploy.
- Những quyết định cũ về **27 bảng RC2** đã bị **thay thế về phạm vi** bởi quyết định dùng 7 bảng Customer V1. Không dùng `10_APPROVAL_FORM.md` của RC2 để BLOCK việc viết SQL nháp theo gói mới.
- Không đồng nghĩa với việc tất cả lựa chọn hạ tầng đã được cấp quyền triển khai. Schema `cm` và owner `talo_cm_owner` là **đề xuất chuẩn bị trong SQL nháp**, cần chủ dự án duyệt riêng trước khi chạy.

**Đích tham chiếu:** `talo_mos_v4_test` (đọc metadata TEST; chưa đụng DEV/PROD).
