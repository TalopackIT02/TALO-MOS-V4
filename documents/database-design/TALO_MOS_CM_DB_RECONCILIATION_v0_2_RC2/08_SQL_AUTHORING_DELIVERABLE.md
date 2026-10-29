# Đầu ra cần có ở SQL AUTHORING GATE

**Điều kiện:** Có `10_APPROVAL_FORM.md` đã được chủ dự án đánh dấu APPROVED cho toàn bộ mục tác động DDL/owner/grants/seed; nếu chưa có thì Claude phải trả `BLOCKED_FOR_SQL_AUTHORING`, không viết SQL.

Sau khi GO, Claude chỉ tạo các file nháp tại export ngoài repo (tên chuẩn theo mẫu FBE-01B đã đối chiếu):

- `README.md` / `RUNBOOK.md`: branch/commit, version, target TEST, trình tự đề xuất (không chạy).
- Preflight guard và metadata-only query: đúng database, owner, schema, phiên bản và dependencies.
- SQL schema/role proposals (chỉ owner-approved): tách Master và Customer; số bảng đúng 27.
- SQL DDL 27 bảng: mọi column, type, nullability, PK, FK, unique, check, index khớp bảng dictionary **đã phê duyệt**.
- `GRANTS_PROPOSED.sql`: schema usage/SELECT đáp ứng MIC-06 và DML theo permission matrix được duyệt, không blanket grants.
- `SEED_PROPOSED.sql`: chỉ những mã đã phê duyệt, không mock customer, không danh sách ngân hàng/địa giới tự bịa.
- Verification scripts metadata read-only và rollback proposal nêu rõ rủi ro mất dữ liệu.
- Manifest SHA-256, CHECKLIST, source→DDL diff, issue log, static validation.

Không tạo migration có khả năng auto-run, không chạy DDL/DML/GRANT, không sửa repo hoặc DB, không tạo MIC, không tự tạo schema/role ngoài quyết định.
