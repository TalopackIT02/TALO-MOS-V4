# TASK F2-DB-GATE2 — FOUNDATION POSTGRESQL DDL REVIEW ONLY

## 0. Chỉ thị thực thi
Bạn là Claude Code thực hiện GATE 2 (SOẠN VÀ KIỂM TRA DDL, KHÔNG THỰC THI) theo Foundation Database Design Baseline v1.0 đã phê duyệt. Đây KHÔNG phải yêu cầu tạo PostgreSQL schema hoặc làm API F2. Hãy tự thực hiện phần kiểm tra/soạn bản nháp trong giới hạn dưới đây, rồi dừng chờ phê duyệt Gate 3.

## 1. Đọc nguồn theo thứ tự
Repo root: `D:\Documents\ClaudeProject\TALO-MOS-V4`
1. File `TALO-MOS-V4_Foundation_Database_Baseline_v1.0_FOR_CLAUDE.md` và file DOCX cùng tên sau khi người dùng đặt vào `documents/development/` (nếu không tìm thấy, dừng và báo thiếu tài liệu; không tái tạo theo trí nhớ).
2. Toàn bộ `documents/development/TALO_MOS_V4_AI_Governance_MD_v0_1/` — nhất là GOV-00, ARC-01, MOD-03, IAM-04, DAT-05 và DEV-07. Bộ Governance v0.1 là DRAFT; không dùng để tự ghi đè baseline vừa được duyệt.
3. `CLAUDE.md`, IAM v0.3 Decision Record, `database/sql/` baseline và `database/prisma/schema.prisma`.
4. Các thư mục SQL/migrations hiện có và báo cáo DB-INSPECT-01 nếu có.

Nguồn khóa thiết kế Foundation là file Baseline v1.0 đã phê duyệt. Nếu file/bảng/cột giữa nguồn có khác biệt, lập Conflict Report; không sửa theo suy đoán.

## 2. SCOPE đã được phê duyệt
- 14 bảng ở schema `foundation`, **đúng 125 trường**. Đúng tên, kiểu, mandatory, default, PK/FK/UNIQUE/CHECK và mô hình quan hệ trong Baseline.
- B01 `fnd_modules` giữ 9 trường; B02 `fnd_module_versions` giữ 12 trường.
- `fnd_data_access_rules.version_action_id` tham chiếu `fnd_version_actions` (không dùng action_id).
- `fnd_audit_logs.module_id` cho phép NULL theo K06.
- Giữ 30 quyết định, K01–K12, chuẩn MIC-01…10, FND-01…09, đặc tả Audit và ranh giới IAM.
- Tuyệt đối không sửa IAM v0.3.

## 3. Nhiệm vụ thực hiện ngay trong Gate 2
A. Inventory read-only: kiểm tra repo và (nếu có kết nối đã được cấp mà không phải đọc secrets) metadata database chỉ đọc; ghi rõ evidence và Git HEAD. Không cần kết nối DB nếu phải lấy credentials mới. Không đọc dữ liệu cá nhân hoặc secrets.
B. Lập bảng mapping `Baseline Table/Field → PostgreSQL DDL`: tên, kiểu, NULL, default, khóa, uniqueness, checks, link, và thứ tự tạo theo FK.
C. Soạn bản **DDL DRAFT REVIEW-ONLY** trong một file mới ngoài thư mục `documents/` được phép theo quy ước repo; chỉ ghi text SQL, KHÔNG chạy. Ghi `DO NOT EXECUTE — REQUIRES OWNER APPROVAL` ở đầu. Nếu quy định repo cấm tạo file ngoài phạm vi, chỉ trả bản nháp trong báo cáo và đánh dấu nơi cần ghi file.
D. Lập Constraint Coverage Matrix: chỉ rõ mỗi quy tắc được bảo đảm bằng PK/FK/UQ/CHECK đã duyệt, hay cần kiểm tra backend/DB privileges, hay còn BLOCKED. Không chế ra trigger, procedure, index mới, enum, bảng thứ 15, SQL GRANT, policy RLS để lấp lỗ hổng.
E. Lập Gap & Conflict Report: đánh dấu chỗ thiếu định nghĩa bắt buộc (MIC JSON canonicalization, permission approve, scope audit, lifecycle rollback, physical enforcement), hướng lựa chọn tối thiểu và mức ảnh hưởng. Không chọn hộ chủ dự án.
F. Tự kiểm tra bằng phân tích tĩnh/đếm trường (không cần chạy SQL): đúng 14 bảng / 125 cột; không đụng schema IAM; không lệnh có nguy cơ xóa/sửa dữ liệu; report những điểm chưa hoàn toàn có thể viết DDL từ baseline.

## 4. CẤM
- Không thực thi bất kỳ câu SQL có khả năng ghi, kể cả `CREATE SCHEMA`, `CREATE TABLE`, `ALTER`, `DROP`, `TRUNCATE`, `INSERT`, `UPDATE`, `DELETE`, `GRANT`, `REVOKE`, thay đổi metadata, thử migration hay transaction ghi.
- Không `prisma migrate`, `prisma db push`, `prisma migrate reset`, `seed`, Docker reset, sync SQL trên dev/test.
- Không sửa IAM SQL/Prisma/Auth, `.env`, credentials, frontend/backend, `documents/`, package/dependencies.
- Không thêm bảng/cột/view/trigger/function/enum/index/constraint ngoài thiết kế được duyệt. Các unique/check cần thiết nhưng không đủ đặc tả: ghi GAP, KHÔNG tự chọn giá trị.
- Không commit/push/merge/deploy.
- Không tự coi một ràng buộc nghiệp vụ là đã bảo đảm bởi DB chỉ vì có cột trạng thái.

## 5. Đầu ra bắt buộc
1. `GATE2-REVIEW-SUMMARY`: Git HEAD, nguồn đã đọc, phạm vi đã kiểm, khác biệt code/DB/document.
2. `FOUNDATION-DDL-DRAFT`: bản nháp SQL chưa chạy, nếu có thể viết không vượt quyền.
3. `DATA-DICTIONARY-COVERAGE`: 14 bảng, 125 trường; PK/FK/UQ/CHECK/NULL/default.
4. `CONSTRAINT-IMPLEMENTATION-MATRIX`: DATABASE / BACKEND / PRIVILEGE / BLOCKED.
5. `GAP-AND-CONFLICT-REPORT`: điểm thiếu và câu hỏi chính xác cần chủ dự án chốt.
6. `EXECUTION-ATTESTATION`: khẳng định đã hoặc chưa sửa file, đã hoặc chưa chạm DB; phân biệt DDL DRAFT với DB ACTUAL. Tất cả test chưa chạy ghi NOT_TESTED, không tự báo PASS.

## 6. Điều kiện dừng
Hoàn thành Gate 2 thì **DỪNG**. Gate 3 phải có nhiệm vụ và phê duyệt MỚI của chủ dự án, chỉ rõ SQL, database đích (dev/test), schema owner, role/grants, test và rollback. Không được tự chạy SQL dù bản nháp DDL tạo được thành công.
