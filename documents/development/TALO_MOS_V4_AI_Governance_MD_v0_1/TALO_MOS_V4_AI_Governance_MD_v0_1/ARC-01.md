# TALO-MOS-V4

## TIÊU CHUẨN KIẾN TRÚC FOUNDATION — MODULE — DATABASE

Mã tài liệu: ARC-01

Phiên bản: 0.1

Trạng thái: DRAFT — CHỜ PHÊ DUYỆT

Ngày soạn: 15/10/2026

Phạm vi: Khung quy tắc phát triển phần mềm; không cấp quyền thực thi thay đổi code/database

Phân loại: các quy tắc được gắn nhãn ĐỀ XUẤT trong bộ tài liệu chưa trở thành quy định bắt buộc cho đến khi chủ hệ thống phê duyệt. IAM v0.3 và ranh giới CLAUDE.md đang có được kế thừa, không ghi đè.

## 1. Mô hình ba miền trách nhiệm

- Foundation / Control Plane: quản trị môi trường vận hành, đăng ký Module, danh mục chức năng, IAM, AppShell, dịch vụ chung và governance.

- Module / Business Plane: triển khai nghiệp vụ, workflow đặc thù, validation, dữ liệu thuộc quyền sở hữu.

- Database / Data Plane: lưu trữ, bảo vệ, ràng buộc toàn vẹn và giao dịch; độc lập về trách nhiệm nhưng không nhất thiết là cơ sở dữ liệu tách riêng.

## 2. Ranh giới bắt buộc

- ARC-01 | Foundation không chứa logic nghiệp vụ chuyên ngành chỉ vì module cần dùng chung giao diện.

- ARC-02 | Module không tự thay đổi bảng IAM, chính sách xác thực hoặc quyền của Module khác.

- ARC-03 | Foundation không phải proxy bắt buộc cho mọi truy vấn SQL.

- ARC-04 | Quyền người dùng, quyền service và SQL GRANT là các tầng riêng.

- ARC-05 | Tích hợp xuyên miền phải đi qua hợp đồng thống nhất; mặc định không có quyền.

## 3. Ví dụ triển khai

- Kinh doanh sở hữu nghiệp vụ Đơn hàng. Kế toán muốn ghi nhận thông tin đối chiếu cần một API hoặc Data Contract được chủ sở hữu chấp thuận.

- Foundation kiểm tra quyền cập nhật theo IAM; Module kiểm tra đơn có trạng thái phù hợp; database đảm bảo ràng buộc và transaction.

- Đối với các mẫu CRM và sản phẩm trong tài liệu nguồn, trạng thái và điều kiện xóa là chính sách nghiệp vụ của Module, không phải quy định DELETE chung.

## 4. Điểm chưa chốt

- Thiết kế triển khai registry vật lý, DB schemas của các Module và cơ chế tích hợp đồng bộ/bất đồng bộ sẽ được thiết kế riêng.

- Organization Management là nguồn dữ liệu cơ cấu tổ chức được đề xuất, không tự suy ra có đa công ty hoặc giao diện chọn chi nhánh.

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
