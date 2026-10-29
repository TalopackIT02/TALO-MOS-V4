# PROMPT CLAUDE CODE — CM DB V1 — SQL FILES ONLY (GATED)

Bạn nhận ZIP `TALO_MOS_CM_DB_RECONCILIATION_v0_2_RC2.zip` và hồ sơ `10_APPROVAL_FORM.md` do chủ dự án phê duyệt (nếu có).

**NHIỆM VỤ:** Chỉ tạo GÓI FILE SQL NHÁP cho Customer Management V1 khi và chỉ khi toàn bộ quyết định làm thay đổi DDL/owner/schema/seed/grants đã được chủ dự án phê duyệt bằng văn bản. Không chạy SQL.

1. Đọc toàn bộ `README.md`, `01_EVIDENCE_VERIFICATION.md`, `02_OWNER_DECISIONS.md`, `03_BUSINESS_DICTIONARY_CANDIDATE.md`, `04_CUSTOMER_CATALOG_CANDIDATE.md`, `05_MASTER_DATA_CANDIDATE.md`, `06_DELTA_AND_CRITICAL_GAPS.md`, `07_FOUNDATION_DB_GATE.md`, `08_SQL_AUTHORING_DELIVERABLE.md`, `10_APPROVAL_FORM.md`, `inventory/*.csv`, `evidence/*`, và `CLAUDE.md` hiện tại trong repo.
2. Kiểm tra checksum nguồn, Git branch/HEAD tại máy, mẫu FBE-01B, metadata TEST đã lưu. Khi có drift, ghi DRIFT và DỪNG. Không tự thay thế bằng design khác.
3. Nếu `10_APPROVAL_FORM.md` chưa được chủ dự án duyệt các quyết định D-CM-01…15 cùng D05/D09/D11/D12/D14/D15/D16/D17/D18 có ảnh hưởng, **DỪNG** với báo cáo `BLOCKED_FOR_SQL_AUTHORING`, nêu từng thiếu sót. Không tạo DDL placeholder.
4. Nếu đủ GO: bám đúng **27 bảng** (11 Business, 10 CM Catalog, 6 Master). Không tự thêm/bớt bảng, thêm cột, đổi tên, đổi type/nullable, tạo đối tượng hỗ trợ hoặc seed khác ngoài thiết kế đã duyệt. Ánh xạ mọi column/PK/FK/index/constraint vào `inventory/*.csv`; nêu vấn đề còn mở thay vì tự sửa.
5. Mọi schema và owner lấy từ approval thật, không đoán `cm`/`master_data`/`talo_cm_owner`. Các trường actor dùng đúng cách IAM đang hoạt động; không FK chéo IAM trừ khi có approval rõ ràng.
6. DDL phải tách Master Data trước Customer để FK hợp lệ. Cấp quyền `talo_app` theo đúng baseline, không CREATE, OWNER, superuser hay blanket grants. Phân biệt DB grants và IAM permissions.
7. Seed chỉ mã được phê duyệt, tuyệt đối không sinh danh sách ngân hàng, đơn vị hành chính, tiền tệ ngoài nguồn xác minh. Không sửa Foundation, IAM, Backend, Frontend, Prisma, MIC.
8. Xuất **ngoài repository** vào `D:\Documents\ClaudeProject\TALO-MOS-V4_exports\CM_DB_SQL_DRAFT_<timestamp>`, theo danh sách file trong `08_SQL_AUTHORING_DELIVERABLE.md`; kiểm tra static, manifest SHA-256, diff với 27 bảng, report `SQL_DRAFT_PREPARED_NOT_EXECUTED`.
9. **CẤM** chạy SQL, migration, GRANT, INSERT, UPDATE, DELETE, commit, push, merge, deploy, restart hoặc truy cập/chỉnh sửa DEV/PROD. TEST chỉ được đọc metadata khi phù hợp với quy tắc repo và chỉ đọc.
10. Dừng sau khi trả gói nháp. Gate triển khai TEST phải được chủ dự án phê duyệt riêng.

**Điều kiện ưu tiên:** Nếu bất kỳ chỉ đạo nào mâu thuẫn với giới hạn ở đây, báo blocker và dừng; tuyệt đối không tự tạo thêm cho đủ chạy.
