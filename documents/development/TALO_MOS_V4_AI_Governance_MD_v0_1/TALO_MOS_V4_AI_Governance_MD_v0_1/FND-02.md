# TALO-MOS-V4

## TIÊU CHUẨN FOUNDATION, APPSHELL VÀ UI/UX

Mã tài liệu: FND-02

Phiên bản: 0.1

Trạng thái: DRAFT — CHỜ PHÊ DUYỆT

Ngày soạn: 15/10/2026

Phạm vi: Khung quy tắc phát triển phần mềm; không cấp quyền thực thi thay đổi code/database

Phân loại: các quy tắc được gắn nhãn ĐỀ XUẤT trong bộ tài liệu chưa trở thành quy định bắt buộc cho đến khi chủ hệ thống phê duyệt. IAM v0.3 và ranh giới CLAUDE.md đang có được kế thừa, không ghi đè.

## 1. Các năng lực nền tảng

- AppShell: Topbar, Sidebar, Workspace, ngữ cảnh đăng nhập.

- Navigation & Routing: điều hướng phân hệ/màn hình dựa trên module đã đăng ký và quyền hiệu lực.

- Registry, IAM, Shared Services, System Configuration và Integration Layer phải tách trách nhiệm.

## 2. Chuẩn giao diện màn hình

- UI-01 | Block 1: Breadcrumb chỉ vị trí điều hướng.

- UI-02 | Block 2: tên màn hình và mô tả.

- UI-03 | Block 3: các chức năng trong màn hình đang mở.

- UI-04 | Block 4: nội dung tương ứng chức năng được chọn.

- UI-05 | Sidebar dùng để điều hướng Module/Màn hình, không đồng nhất với Block 3.

- UI-06 | Sidebar mở rộng/thu gọn phải tái phân phối chiều rộng Workspace; flyout thu gọn chỉ hiện một menu khi hover.

## 3. Quy tắc hành vi chung

- Màn hình và thao tác chỉ được hiển thị phù hợp với quyền hiệu lực, nhưng backend vẫn phải xác nhận quyền cho mọi request.

- Không tự tạo menu chọn chi nhánh hoặc chọn công ty; tên công ty có thể chỉ là thông tin hiển thị.

- Dashboard là một màn hình nghiệp vụ độc lập, không phải điều kiện để AppShell hoạt động.

## 4. Vòng đời giao diện

- Trước xây nhiều Module phải chốt mẫu AppShell/4 Block và thiết lập mẫu màn hình nghiệp vụ.

- Demo HTML sử dụng dữ liệu mô phỏng phải ghi rõ và không được xem là API/backend đã hoàn thành.

- Thay đổi UI dùng chung phải kiểm tra ảnh hưởng đến responsive, điều hướng, truy cập bằng bàn phím và module đã tích hợp.

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
