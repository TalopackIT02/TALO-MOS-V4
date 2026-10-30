# PROMPT CLAUDE CODE — DATABASE ALIGNMENT CM BACKEND REV01

Truy cập `D:\Documents\ClaudeProject\TALO-MOS-V4\documents\database-design` và đọc toàn bộ thư mục `TALO_MOS_CM_BE_REV01_DB_ALIGNMENT_V1`, đặc biệt SOURCE, gap matrix, candidate SQL, runbook. Cùng đọc gói SQL REV01 R2 đã cài, báo cáo TEST execution, CLAUDE.md và Foundation/IAM/MIC code thực tế.

**Mục tiêu:** hoàn thiện migration Database **từ** 11 bảng/114 cột CRM V1 đã cài sang thiết kế phù hợp Backend `CM-BE-SPEC-REV01`, không tạo lại nền và không làm lệch hệ thống.

**Thực hiện một lượt có kết quả:**
1. Truy vấn metadata `talo_mos_v4_test` theo READ ONLY và xuất schema-only + report (không xuất dữ liệu CRM/PII). Xác minh chính xác tên/cột/index/GRANT R2 và role `talo_cm_owner`.
2. So sánh live DB với ứng viên migration, bảng delta rõ ràng. Chỉ sửa SQL khi có bằng chứng, không thêm nghiệp vụ khác.
3. Kiểm tra Foundation MIC-06, quyền IAM thực tế, Audit/Event và storage. Kết quả là **hợp đồng** cho Backend; không sửa Foundation/IAM/Prisma/SCC.
4. Hoàn thiện SQL (preflight, DDL migration, grants, postcheck, rollback an toàn), test trên clone cách ly và test negative theo `05_TEST_AND_ACCEPTANCE.md`.
5. Báo cáo API→function→table/grants→data scope, phần phải MIC khai báo; các điểm chưa thể đáp ứng ghi BLOCKED, không tự chế contract.
6. Xuất ZIP + báo cáo + manifest SHA-256 vào `TALO-MOS-V4_exports`. Kết thúc `READY_FOR_CM_BE_DB_TEST_APPROVAL` hoặc `SCHEMA_DRIFT_STOP` có bằng chứng.

**CẤM:** Không chạy SQL trên TEST khi chưa có lệnh GO riêng, không đụng DEV/PROD, không commit/push/deploy, không tự sửa bảng IAM/Foundation, không tự xây Backend/Frontend/MIC ở lượt này, không tạo bảng ngoài phạm vi ứng viên nếu chưa xin duyệt. Chỉ dữ liệu giả lập trên TEST; bảo vệ PII do SCC chưa mask.

**Trọng tâm tiến độ:** Hoàn thành gói migration trong một lượt. Không quay lại thiết kế 27 bảng, không viết lại seed 3.321 xã, không lặp preflight vô hạn.
