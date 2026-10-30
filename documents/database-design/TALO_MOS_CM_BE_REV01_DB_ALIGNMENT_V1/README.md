# TALO-MOS — CRM Backend REV01 / Database Alignment V1

**Ngày:** 29/10/2026. **Trạng thái:** `SQL_MIGRATION_CANDIDATE / LIVE_SCHEMA_RECONCILIATION_REQUIRED`.

Đây là hồ sơ đối chiếu **CM-BE-SPEC-REV01** với SQL ứng viên REV01 R2. Theo báo cáo chủ dự án, R2 đã cài trên `talo_mos_v4_test` (11 bảng, 114 cột, dữ liệu CRM trống lúc nghiệm thu). Tôi **không** kết nối được TEST và chưa có dump schema sau khi cài. Vì vậy SQL migration chỉ là **ứng viên có guard**, chưa được PostgreSQL parse/chạy.

## Phạm vi
- Giữ nguyên 11 bảng và dữ liệu địa giới 34 tỉnh, 3.321 xã, 6 vùng, 34 mapping.
- Thêm **4 bảng** phục vụ kiểm soát thay đổi pháp lý, hai luồng bàn giao và lưu lịch sử chuyển việc.
- Bổ sung **3 cột** vào 3 bảng hiện hữu: `record_status_code`, `assignment_role_code`, `supersedes_document_id`.
- Thay CHECK hồ sơ chính thức; thay index duy nhất Sale hiện hành; bổ sung ràng buộc quan hệ phiên bản và các GRANT cột.
- **Không** tạo thêm Master Data, công nợ, kho, đơn hàng, bảng quyền IAM, bảng audit hệ thống, chức năng thông báo định kỳ.

## Các file
- `SOURCE_CM_BE_SPEC_REV01.md`: nguyên văn hồ sơ Backend người dùng gửi.
- `01_BASELINE_AND_GAPS.md`: đối chiếu nguồn và chỗ xung đột.
- `02_TARGET_MODEL_AND_RULES.md`: Data Dictionary phần mở rộng, các transaction bắt buộc.
- `03_BR_API_MIC_MATRIX.md`: mapping 20 Business Rules, API/MIC yêu cầu đối chiếu runtime.
- `04_CURRENT_SCHEMA_EXPORT.md`: hướng dẫn xuất schema thực tế TEST, chỉ cấu trúc, không xuất dữ liệu.
- `05_TEST_AND_ACCEPTANCE.md`: kiểm thử bắt buộc và Gate.
- `06_DECISIONS_AND_RISKS.md`: phần bắt buộc owner/Claude xác nhận.
- `07_EXECUTION_RUNBOOK.md`: trình tự clone → review → TEST (không được tự nhảy bước).
- `08_PROMPT_CLAUDE_CODE.md`: prompt thực hiện trọn gói khảo sát, điều chỉnh, dry-run; chờ GO TEST.
- `09_PROMPT_TEST_EXECUTION_AFTER_GO.md`: mẫu prompt Gate thực thi TEST chỉ dùng sau phê duyệt.
- `SQL_CANDIDATE/01_CM_BE_REV01_MIGRATION_TEST_ONLY.sql`: migration ứng viên; **không tự chạy**.
- `SQL_CANDIDATE/02_VERIFY_READONLY.sql`: verification đọc metadata sau migration.
- `BASELINE_REFERENCE_DO_NOT_RUN/`: chỉ để diff, KHÔNG CHẠY trên TEST đã có bảng.

**Nguyên tắc quyết định:** SQL ứng viên này không thay thế bản R2 đã cài; chỉ làm migration từ R2. Claude phải so live schema trước. Không chạy trên DEV/PROD, không sửa Foundation/IAM/Prisma/SCC, không tự dựng MIC sai contract.
