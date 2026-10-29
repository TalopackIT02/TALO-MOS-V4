# 08 — Gói SQL phải phát hành (AUTHORING, NO EXECUTION)

Đặt output ở `D:\Documents\ClaudeProject\TALO-MOS-V4_exports\CM_DB_REV01_SQL_CANDIDATE_<timestamp>\`:

1. `MANIFEST_SHA256.txt` và `INVENTORY.md` — đủ số file/tên/hash.
2. `01_PREFLIGHT_READONLY.sql` — xác minh đúng TEST, schema, owner, account UUID, không trùng bảng/sequence, readiness & permissions, kiểm tra drift.
3. `02_ROLE_SCHEMA_PROPOSAL.sql` — tạo `cm` và `talo_cm_owner`, bước admin có chặn DB/cluster và **không trộn** với business DDL; không thực thi.
4. `03_TABLES_DDL.sql` — đúng 11 bảng/114 cột, PK/FK/CHECK/UNIQUE và sequence không cycle, câu lệnh có guard/test/catch.
5. `04_INDEXES.sql` — index tối thiểu, 2 partial unique baseline, partial unique legal identifier, mapping index + composite ward FK. Không index dư.
6. `05_SEED_PROPOSAL.sql` — chỉ dữ liệu đã verified, đầy đủ tỉnh/xã/6 vùng/map; nếu thiếu ward verified thì tách `SEED_BLOCKED` rõ và KHÔNG tạo fake ward.
7. `06_GRANTS_PROPOSAL.sql` — hạn chế theo cột; PII warning; reader-only catalog role; sequence USAGE.
8. `07_VERIFY_READONLY.sql` — kiểm chứng schema, 11 tables, 114 columns, FK, UQ, sequence 6 digits, seed counts/checksums, grants, dữ liệu không trùng; không truy xuất dữ liệu khách thật.
9. `90_ROLLBACK_GUARDED.sql` — từ chối rollback nếu có dữ liệu, không CASCADE, không DROP đối tượng ngoài danh sách; guard database TEST và backup condition.
10. `RUNBOOK.md`, `OPEN_ISSUES.md`, `VALIDATION_REPORT.md`, `SOURCES.md` và bằng chứng static validation.

Phải kèm `DELTA_FROM_7_TABLE_DRAFT.md` liệt kê các thay đổi SQL với gói Claude `CM_DB_V1_SQL_DRAFT_20261029-115639` nếu gói ấy có trên máy.

**Gate hoàn tất:** `READY_FOR_EXECUTION_REVIEW` chỉ có nghĩa SQL file đã được soạn và kiểm tĩnh, KHÔNG có nghĩa đã cài. Nếu chưa xác minh đủ dữ liệu ward, `READY_FOR_DDL_REVIEW / SEED_BLOCKED` và công bố rõ.

Không tạo báo cáo vòng lặp thay cho SQL có thể viết được: nơi nào đủ dữ liệu thì viết SQL Candidate ngay. Tuyệt đối không tự chạy trên TEST/DEV/PROD.
