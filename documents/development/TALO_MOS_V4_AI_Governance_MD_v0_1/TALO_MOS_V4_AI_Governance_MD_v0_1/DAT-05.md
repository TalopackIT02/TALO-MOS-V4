# TALO-MOS-V4

## TIÊU CHUẨN DATABASE GOVERNANCE VÀ DATA CONTRACT

Mã tài liệu: DAT-05

Phiên bản: 0.1

Trạng thái: DRAFT — CHỜ PHÊ DUYỆT

Ngày soạn: 15/10/2026

Phạm vi: Khung quy tắc phát triển phần mềm; không cấp quyền thực thi thay đổi code/database

Phân loại: các quy tắc được gắn nhãn ĐỀ XUẤT trong bộ tài liệu chưa trở thành quy định bắt buộc cho đến khi chủ hệ thống phê duyệt. IAM v0.3 và ranh giới CLAUDE.md đang có được kế thừa, không ghi đè.

## 1. Vai trò dữ liệu

- Database là hạ tầng lưu trữ chung; Foundation quản trị đăng ký/kiểm soát truy cập; chủ sở hữu dữ liệu của từng Module chịu trách nhiệm schema nghiệp vụ.

- Một DB PostgreSQL dùng chung giai đoạn đầu là định hướng đề xuất, không bắt buộc mọi Module dùng một schema.

- IAM v0.3 và Prisma mapping hiện tại là baseline không được tự động migration.

## 2. Phân định quyền

- Quyền UI/Role của User không chuyển thành SQL GRANT của DB User.

- Service runtime và provisioning dùng quyền kỹ thuật có giới hạn; không mở quyền cross-schema mặc định.

- Module không cập nhật trực tiếp bảng Module khác, trừ khi có hợp đồng ghi rõ bảng/cột/phạm vi và cơ chế thực thi được duyệt.

## 3. Data Contract tối thiểu

- data_owner, resource_key, schema_version, consumer_modules, access_mode (read/write), interface (API/event/view), data_schema.

- Định nghĩa validation, khóa định danh, quy tắc nhất quán, xử lý lỗi, versioning, thời hạn lưu và audit policy.

- Không tự mặc định dữ liệu sao chép được phép đồng bộ hai chiều.

## 4. Thay đổi schema và migration

- DAT-01 | Thay đổi cần migration plan, impact analysis, backup/rollback và phép duyệt riêng.

- DAT-02 | Không chạy db push/migrate/seed trên môi trường thực khi chưa duyệt.

- DAT-03 | Thay phiên bản module không tự đổi cấu trúc DB hoặc xóa dữ liệu.

- DAT-04 | Giao dịch quan trọng phải bảo toàn atomicity và constraints.

- DAT-05 | Dữ liệu nhạy cảm không được ghi vào audit theo kiểu plaintext.

## 5. Audit truy vết dữ liệu

- Ghi nhận actor, action, module, resource, target ID, timestamp, result, request/correlation ID.

- Giá trị trước/sau chỉ lưu khi mục đích audit yêu cầu, có chính sách che dữ liệu và retention; không ghi passwords/token.

- Không cam kết mọi bảng đều có thể tự động tái tạo chi tiết nội dung thay đổi nếu chưa thiết kế audit hoặc CDC tương ứng.

## 6. Ca sử dụng liên Module

- Kế toán cần cập nhật trạng thái liên quan Đơn hàng: khuyến nghị API của Sales hoặc bounded write contract đã phê duyệt.

- Nếu Sales thay schema, phải duy trì compatibility hoặc chuyển đổi version Data Contract có kế hoạch rõ ràng.

## Nguồn tham chiếu và giới hạn

- TaloMOS.docx: Tài liệu ý tưởng do chủ hệ thống cung cấp, 19 trang; mục A.1–A.2, quy ước UI 4 Block, CRM và Sản phẩm.

- GitHub / CLAUDE.md: https://github.com/TalopackIT02/TALO-MOS-V4/blob/main/CLAUDE.md

- GitHub / IAM Decision Record v0.3: https://github.com/TalopackIT02/TALO-MOS-V4/blob/main/documents/database-design/IAM%26Sercurity/TALO-MOS-IAM-v0.3-Decision-Record.md

- GitHub / IAM Prisma mapping: https://github.com/TalopackIT02/TALO-MOS-V4/blob/main/database/prisma/schema.prisma

- GitHub / AUTH Context: https://github.com/TalopackIT02/TALO-MOS-V4/blob/main/AUTH-CONTEXT/00-START-HERE.md

Chưa xác minh trạng thái database local/production hoặc kiểm thử lại. Mọi khác biệt cần kiểm tra trên môi trường đích bằng thao tác chỉ đọc trước khi áp dụng.

## Phê duyệt tài liệu

| Người phê duyệt | ____________________________ |

| --- | --- |

| Ngày phê duyệt | ____________________________ |

| Quyết định | ☐ Phê duyệt  ☐ Yêu cầu sửa  ☐ Chưa phê duyệt |
