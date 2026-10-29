# TALO-MOS / CRM V1 — Revision 01 / SQL Authoring Handoff
**Ngày:** 2026-10-29 · **Mã hồ sơ:** CM-REV01-DDL-CANDIDATE · **Trạng thái:** SQL AUTHORING ONLY

**Phạm vi duy nhất:** 7 bảng hiện hữu trong *thiết kế* (chưa chạy lên DB) + 4 bảng tra cứu địa lý, tổng **11 bảng / 114 cột**. Không phải gói SQL thực thi.

## Thứ tự đọc ưu tiên
1. `00_EXECUTION_BOUNDARY.md` — quyền hạn, khóa phạm vi.
2. `01_REVISION_DELTA.md` — thay đổi so với 7/76 và lịch sử gói SQL nháp.
3. `02_TABLES_AND_ERD.md` — ý nghĩa bảng, quan hệ.
4. `03_DATA_DICTIONARY_REV01.json` + `03_COLUMN_INVENTORY_114.csv` — **nguồn kỹ thuật chính xác** của DDL.
5. `04_CONSTRAINTS_AND_VALIDATION.md` — unique, FK, CHECK, sequence, luật nghiệp vụ.
6. `05_OFFICIAL_SOURCES_AND_SEED_GATE.md` + các CSV ứng viên — dữ liệu từ nguồn, không bịa ward.
7. `06_FOUNDATION_IAM_AND_GRANTS.md` — quyền, schema, owner, SCC inspector.
8. `07_TEST_PLAN.md`, `08_SQL_PACKAGE_CONTRACT.md`, `09_PROMPT_CLAUDE_SQL_CANDIDATE.md`.

### Xung đột phiên bản
- Bộ 27 bảng RC2 không phải phạm vi triển khai.
- Gói 7 bảng/76 cột v1.0 bị Revision 01 **thay thế**, không được thi hành nguyên trạng.
- Gói Claude `CM_DB_V1_SQL_DRAFT_20261029-115639` là **input để chỉnh sửa**, không phải baseline đã chạy. Nếu không tìm thấy thì viết lại từ dictionary mới.
- Người dùng yêu cầu tăng tốc, **không bỏ** gate chỉ cho phép chạy SQL sau khi phê duyệt riêng.

### Xuất kết quả
Claude tạo một gói ZIP ở `D:\Documents\ClaudeProject\TALO-MOS-V4_exports` (ngoài repo) và trả `READY_FOR_EXECUTION_REVIEW`, không kết nối DB ghi, không DDL/DML/GRANT, không commit/deploy.
