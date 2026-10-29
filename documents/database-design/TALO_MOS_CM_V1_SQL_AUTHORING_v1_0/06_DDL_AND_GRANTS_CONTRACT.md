# 06 — Quy tắc viết SQL nháp: 7 bảng, 76 cột

## 1. Object count cố định

- Chính xác 1 schema nghiệp vụ đề xuất: `cm`.
- Chính xác 7 `CREATE TABLE` nghiệp vụ tên trong `01_SCOPE...`; không `CREATE TABLE` nào khác.
- Không view, trigger, function, procedure, enum, sequence, extension, seed data hoặc Prisma migration.
- Role NOLOGIN **đề xuất**: `talo_cm_owner` (chỉ là script đề xuất, không chạy). Nếu role tồn tại phải báo metadata, không tự thay đổi.
- `talo_app` được phép truy cập theo GRANT tường minh; không `GRANT ALL`, không quyền `CREATE`/`TRUNCATE`/`REFERENCES`/`TRIGGER`/`OWNERSHIP` cho runtime.

## 2. Tiền lệ SQL cần theo

- `uuid PRIMARY KEY DEFAULT gen_random_uuid()` cho PK đơn (PG18 core).
- `ON DELETE RESTRICT` cho toàn bộ 7 FK.
- Partial UNIQUE chính xác hai điều kiện trong `03_CONSTRAINTS...`.
- `created_at`/`assigned_at`/`uploaded_at` theo dictionary, không tự thêm timestamp hay audit.
- `updated_at` do Backend cập nhật ở nơi có cột; không tạo trigger mới.
- `customer_code` do Backend phát hành, không tạo sequence/function/trigger.
- `iam` không bị tham chiếu FK, không chỉnh sửa.
- CHECK giới hạn 4 nhóm quy định, không thêm CHECK khác mà chưa phê duyệt.
- NULL/default/kiểu chính xác theo `02_COLUMN_INVENTORY_76.csv`.
- Không tạo bảng danh mục, các code chỉ có contract trong MD.

## 3. DML/GRANT đề xuất cho role `talo_app` (là đề xuất, chưa cấp)

| Bảng | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| cm_customers | Toàn bảng | Chỉ các cột người dùng nhập & actor (không PK/default) | Trừ PK, customer_code, created_* | Không |
| cm_customer_contacts | Toàn bảng | Chỉ trường nghiệp vụ + created_account_id | Trừ PK, customer_id, created_* | Không |
| cm_customer_groups | Toàn bảng | Chỉ trường nghiệp vụ + created_account_id | Trừ PK, group_code, created_* | Không |
| cm_customer_group_members | Toàn bảng | customer_id, group_id, assigned_account_id | Không | Có điều kiện qua API/IAM |
| cm_customer_assignments | Toàn bảng | customer_id, sale_account_id, assigned_by_account_id, assigned_at | Chỉ ended_at, ended_by_account_id, handover_to_account_id, handover_note, handover_accepted_at, handover_accepted_by_account_id | Không |
| cm_customer_activities | Toàn bảng | Trường nghiệp vụ trừ PK và created_at | Chỉ status, title, description, due_at, assigned_to_account_id, completed_at | Không |
| cm_customer_documents | Toàn bảng | Trường nghiệp vụ trừ PK và uploaded_at | Không | Không |

`INSERT/UPDATE` phải liệt kê **từng cột** đúng từ điển; bảng ghi `Trừ...` chỉ là hướng dẫn rút gọn cho tác giả script. Role DB chung `talo_app` có thể SELECT metadata nhạy cảm; bắt buộc IAM/Backend kiểm soát view, download và che thông tin; quyền SQL không thay IAM.

Không tạo/grant người dùng ứng dụng mới, không gọi API IAM, không cấp quyền trực tiếp cho Sales.

## 4. Chống bịa & giới hạn kiểm tra

- Mọi lựa chọn bị thiếu trong source thực tế phải ghi trong `OPEN_ISSUES.md`; không tự thêm bảng/cột để sửa.
- Tên object hoặc vai trò không tồn tại: cung cấp script đề xuất rõ ràng, không chạy, nêu điều kiện DBA/owner duyệt.
- Không thêm dữ liệu giả hoặc ngân hàng/tỉnh thành tự dựng.
- Nếu source mới đổi hoặc DB drift: cập nhật báo cáo, KHÔNG chạy SQL để thử.
