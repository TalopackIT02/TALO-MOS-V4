# TALO-MOS-V4

## TIÊU CHUẨN ĐỊNH DANH, XÁC THỰC VÀ PHÂN QUYỀN

Mã tài liệu: IAM-04

Phiên bản: 0.1

Trạng thái: DRAFT — CHỜ PHÊ DUYỆT

Ngày soạn: 15/10/2026

Phạm vi: Khung quy tắc phát triển phần mềm; không cấp quyền thực thi thay đổi code/database

Phân loại: các quy tắc được gắn nhãn ĐỀ XUẤT trong bộ tài liệu chưa trở thành quy định bắt buộc cho đến khi chủ hệ thống phê duyệt. IAM v0.3 và ranh giới CLAUDE.md đang có được kế thừa, không ghi đè.

## 1. Baseline đã được quyết định

- IAM v0.3: mỗi Membership tối đa một Account hiện hành; giữ lịch sử Account disabled.

- Một Account nhận nhiều Role; Role là gói quyền, không có Switch Role hoặc Switch Account.

- Effective Grants = (permissions từ các Role hiệu lực ∪ Direct ALLOW) − Direct DENY; có kiểm tra trạng thái tài khoản, thời gian và assurance.

## 2. Tích hợp Capability

- Permission phải định vị chính xác module_code, resource_code/function_key, operation/action_key.

- Foundation nhận khai báo Capability; IAM lưu grants; Module không tự cập nhật cấp quyền.

- Ma trận quyền chia theo Module, dòng là chức năng, cột là Action có hỗ trợ; phân biệt Role grants, Direct ALLOW, Direct DENY và quyền hiệu lực.

## 3. Authentication hiện có và giới hạn

- Login, first-change, GET session, logout đã có mã nguồn; màn hình Welcome hiện chưa phải AppShell.

- 5 lần sai khóa 15 phút; activation 15 phút; authenticated session tối đa 10 giờ, idle 60 phút; các giá trị này không mặc định cho Admin chỉnh trên UI.

- Password recovery tự phục vụ, MFA, email assurance Level 2 và account-management UI không thuộc phạm vi AUTH-API v1 đã hoàn thiện.

## 4. Quy tắc an toàn

- IAM-01 | Mọi endpoint nghiệp vụ xác thực và kiểm tra quyền ở backend.

- IAM-02 | Quyền APPROVE không đủ để duyệt mọi bản ghi hoặc mọi bước.

- IAM-03 | Thu hồi role/permission và disable Account phải được xử lý nhất quán với session, audit và effective permissions.

- IAM-04 | Không tự cấp quyền AccountManager tương đương Admin.

- IAM-05 | Các yêu cầu chỉnh IAM schema v0.3 cần đề xuất và phê duyệt độc lập.

## 5. Các điểm còn mở

- Thiết kế màn hình quản trị Account/Role/Permission, quản lý nhiều bước duyệt, reissue/revoke cấp quản trị và MFA cần đặc tả riêng.

- Không tuyên bố các cơ chế Security Policy động đã tồn tại chỉ vì backend đang có constants.

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
