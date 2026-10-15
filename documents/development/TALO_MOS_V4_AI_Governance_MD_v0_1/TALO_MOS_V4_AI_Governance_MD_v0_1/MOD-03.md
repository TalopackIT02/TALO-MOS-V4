# TALO-MOS-V4

## HỢP ĐỒNG MODULE CAPABILITY VÀ QUẢN LÝ VÒNG ĐỜI

Mã tài liệu: MOD-03

Phiên bản: 0.1

Trạng thái: DRAFT — CHỜ PHÊ DUYỆT

Ngày soạn: 15/10/2026

Phạm vi: Khung quy tắc phát triển phần mềm; không cấp quyền thực thi thay đổi code/database

Phân loại: các quy tắc được gắn nhãn ĐỀ XUẤT trong bộ tài liệu chưa trở thành quy định bắt buộc cho đến khi chủ hệ thống phê duyệt. IAM v0.3 và ranh giới CLAUDE.md đang có được kế thừa, không ghi đè.

## 1. Mô hình chuẩn

- Ba tầng catalog: MODULE → FUNCTION → ACTION; không tự đồng nhất Menu, Route, Screen với Permission.

- Module công bố danh sách chức năng và hành động hỗ trợ; Foundation đăng ký và xác minh compatibility; IAM thực hiện cấp quyền cho Role/Account.

- Workflow và Data Contract là khai báo mở rộng, không phải tầng cấp quyền thứ tư.

## 2. Manifest v1 — trường bắt buộc đề xuất

- contract_version, module_key, module_name, module_version.

- functions[].function_key, name, route_key, actions[].action_key.

- Tùy chọn: workflow_key, rule_keys, data_contract_refs, deprecated_in, replaces.

- Định danh bất biến; đổi tên hiển thị không được làm mất quyền. Danh sách module phải được kiểm tra xung đột khóa và phiên bản.

## 3. Quy tắc tích hợp

- MOD-01 | Module chỉ đăng ký khả năng, không tự cấp quyền hay mở khóa truy cập.

- MOD-02 | Capability chưa được định nghĩa thì không được hiện nút cấp quyền.

- MOD-03 | Action mới mặc định chưa cấp cho tài khoản nào.

- MOD-04 | Module upgrade phải trình bản so sánh chức năng/Action thêm, đổi, bỏ và migration plan nếu có.

- MOD-05 | Module disable/uninstall không tự xóa dữ liệu, audit hoặc quyền lịch sử.

- MOD-06 | Mỗi manifest cần validation và approval trước khi active.

## 4. Ví dụ module Kinh doanh

- SALES.ORDER có thể đăng ký VIEW, CREATE, UPDATE, DELETE, SUBMIT, APPROVE.

- SALES.PRODUCT có thể đăng ký VIEW, CREATE, UPDATE, HIDE.

- Các ví dụ chỉ để xác minh cấu trúc hợp đồng; không phải quyền đã được cấp hoặc chức năng đã triển khai.

## 5. Kiểm thử hợp đồng

- Kiểm tra module_key trùng, function_key trùng, action không hợp lệ, route không tồn tại, contract_version không tương thích.

- Kiểm tra update có đổi key, xóa capability đang có grants, thăng quyền ngầm, disable module nhưng session còn hiệu lực.

- Đầu ra chuẩn: manifest validated, diff phiên bản, tác động IAM, dữ liệu và kế hoạch rollback.

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
