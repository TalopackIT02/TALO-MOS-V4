# Prompt cho Claude Code (sao chép nguyên khối)

Claude Code, đọc đầy đủ bộ hồ sơ `TALO_MOS_CM_V1_SQL_AUTHORING_v1_0` tại:
`D:\Documents\ClaudeProject\TALO-MOS-V4\documents\database-design`.

**Chủ dự án đã thu hẹp CM V1 thành 7 bảng/76 cột và yêu cầu soạn SQL nháp.** Gói này thay thế phạm vi CM 27 bảng RC2; trạng thái `NOT APPROVED` của RC2 không chặn việc viết **SQL NHÁP** theo thiết kế mới. Không hiểu là cho phép chạy SQL.

Yêu cầu:
1. Đọc README và toàn bộ file 01–07, đặc biệt `02_COLUMN_INVENTORY_76.csv`, `03_CONSTRAINTS_AND_HANDOVER.md`, `05_FOUNDATION_ALIGNMENT.md` và `07_DELIVERABLE_AND_ACCEPTANCE.md`.
2. Đối chiếu `CLAUDE.md`, Foundation baseline, mẫu FBE-01B, IAM account UUID và metadata TEST **chỉ đọc**, báo mọi sai khác. Không đụng DEV/PROD.
3. **Viết** gói SQL proposal gồm schema/owner, DDL đúng **7 bảng, 76 cột**, 7 FK, index/constraint, grants tối thiểu, preflight & verification chỉ đọc, rollback proposal, runbook, manifest SHA-256 và validation report. Không tự thêm bảng/cột hay chức năng; không tạo Master Data, công nợ hoặc seed.
4. Đề xuất schema `cm`, owner NOLOGIN `talo_cm_owner` trong file nháp, ghi rõ đây là đề xuất chưa duyệt để áp dụng. Mọi vướng mắc hạ tầng ghi `OPEN_ISSUES.md`; không tự đổi thiết kế.
5. Xuất toàn bộ ra `D:\Documents\ClaudeProject\TALO-MOS-V4_exports\CM_DB_V1_SQL_DRAFT_<timestamp>` ngoài repository.

**CẤM:** thực thi SQL/DDL/DML/GRANT/CREATE ROLE, chạy migration hoặc Prisma, sửa DB/Backend/Frontend/Foundation/IAM/MIC, sửa repo, commit/push/merge/deploy/restart. Không được chạy SQL thử để sửa lỗi.

Kết thúc bằng `READY_FOR_SQL_REVIEW` hoặc `PARTIAL_DRAFT_NEEDS_OWNER_DECISION`, kèm đường dẫn báo cáo và sha256. **Dừng chờ chủ dự án và ChatGPT rà soát, không chạy SQL.**
