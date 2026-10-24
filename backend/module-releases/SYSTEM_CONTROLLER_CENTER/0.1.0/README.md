# SYSTEM_CONTROLLER_CENTER 0.1.0 — System Controller Center

**Module mới độc lập** dành cho người quản trị kỹ thuật `TALO_SYSTEM_ADMIN`. Đây là **ứng viên để Foundation quét và chạy Preflight**, không phải phần mềm đã được kích hoạt hay nghiệm thu trên PostgreSQL TEST.

## Phạm vi

1. **Sức khỏe & Kiểm thử**: chẩn đoán Foundation/IAM/PostgreSQL/Module Host, đọc và xuất báo cáo TXT/JSON; xem artifact regression Host đã cung cấp. Nút chạy chỉ thực thi các phép chẩn đoán read-only, **không chạy `npm test` hoặc shell** (Host chưa có runner capability). `NOT_RUN` không được coi PASS.
2. **Dữ liệu hệ thống**: xem metadata và trang dữ liệu của mọi schema mà PostgreSQL runtime role có SELECT và RLS cho phép; SQL chỉ SELECT trong transaction READ ONLY 5 giây, không hỗ trợ chỉnh sửa, SQL tùy ý hay GRANT. Dữ liệu tài khoản bị chặn ở backend (IAM user/credential/session/membership/assignment và bảng account cùng loại). Phần còn lại không có masking theo tên cột/JSON. Trang được phân trang; nếu một ô >2 triệu ký tự thì từ chối thay vì trả kết quả cắt cụt. Không khẳng định đọc được các bảng khi DB role thiếu SELECT.
3. **Foundation & Module**: toàn bộ phiên bản B01/B02 đã đăng ký, danh mục Function/Action B03–B06 theo từng version, phiên bản trạng thái, chỉ đọc; xuất báo cáo qua các trang.
4. **Ma trận phân quyền**: danh sách account ID/username tối thiểu và role ACTIVE; xem nguồn cấp quyền role/direct ALLOW/DENY theo từng account và permission. Đây là **ma trận nguồn quyền**, chưa phải phép tính quyền hiệu lực có assurance/context của phiên người dùng. Có thể xuất TXT toàn bộ quyền của tài khoản được chọn.
5. **System Logs**: đọc audit Foundation và IAM đã lưu, không dựng các request/log chưa tồn tại.

## Role-only: rào kỹ thuật không được bỏ

Mọi route đều qua Session → `TALO_SYSTEM_ADMIN` (membership chưa thu hồi + role ACTIVE + account ACTIVE) → IAM K05 của chức năng → Module lifecycle ACTIVE/ENABLED. Một role Manager hoặc direct permission ALLOW không thể tự vượt rào backend `TALO_SYSTEM_ADMIN`. **Role này được hard-code trong `backend/administrator-gate.ts`**. Không tự cấp role hay permission trong gói. Administrator cần được gán quyền IAM cho những Function tương ứng bằng IAM Management theo đúng chính sách chủ dự án.

## Cách sử dụng qua Foundation

1. Chỉ **chép thư mục `SYSTEM_CONTROLLER_CENTER`** vào `D:\\Documents\\ClaudeProject\\TALO-MOS-V4\\modules\\SYSTEM_CONTROLLER_CENTER`. Không copy sang `installed-modules` hay `module-releases`.
2. Vào Foundation → Quản lý Module → **Quét Module** → chọn `SYSTEM_CONTROLLER_CENTER 0.1.0` → **Kiểm tra & Chạy thử**. Sửa mọi FAIL trước khi tiến hành; MIC10 ban đầu `NOT_TESTED` là đúng, FMI-02/03 mới sinh evidence PASS.
3. Foundation: xem plan, cài đặt và kích hoạt theo gate. Không cần tự paste MIC hay thay đổi schema. **FMI-03 có thể yêu cầu restart thủ công** nếu supervisor chưa cấu hình.
4. IAM: tạo/gán danh mục quyền cho role `TALO_SYSTEM_ADMIN` theo cơ chế IAM Management hợp lệ. **Đừng cấp cho Manager**. Không tự gán role trong module.
5. Navigation: chủ dự án tự mở Navigation Builder và đặt các Function vào vùng Develop. MIC đã khai báo route/tab, nhưng vị trí menu do chủ dự án quyết định.
6. Khi module mới hoạt động đã được nghiệm thu đầy đủ, chủ dự án có thể **DISABLE** `SYSTEM_TEST` và `DATA_INSPECTOR` bằng Foundation. Không xóa module/phiên bản cũ và không thay đổi release lock bằng tay. Bản mới không đè đường dẫn hay mã module cũ.

## Hạn chế và điểm cần xác minh khi Preflight

- Tài liệu đối chiếu theo commit GitHub `ea91c292` ngày 23/10/2026; local REV-01/Closure đã commit nhưng chưa có trên GitHub theo lần đọc gần nhất, vì vậy các contract có thể đã thay đổi. Scanner và Preflight trên máy là kết luận có thẩm quyền.
- Chưa chạy được typecheck Node/React trên repository thật, PostgreSQL TEST, IAM, hoặc browser E2E từ môi trường đóng gói này. Không gọi package PASS/READY/ACTIVE trước khi Foundation xác nhận.
- Module không cấp thêm quyền SELECT cơ sở dữ liệu hoặc vô hiệu hóa RLS; các bảng không đọc được phải hiển thị rõ không khả dụng.
- Chế độ Admin cố định hiện chọn **role_code `TALO_SYSTEM_ADMIN`** có trong IAM. Nếu hệ thống local thực tế dùng mã role khác, yêu cầu chủ dự án xác nhận trước khi phát hành; không âm thầm chuyển sang kiểm tra username `admin`.
- Thông tin account tối thiểu (`accountId`, `username`, role codes) vẫn xuất hiện trong ma trận vì cần nhận diện tài khoản. Nội dung nhạy cảm của tài khoản không được đưa vào Data Explorer.
- Phần mô tả "cấp dưới" trong yêu cầu ban đầu chưa hoàn chỉnh. Phiên bản này chỉ khóa chắc Administrator/Manager: **Administrator được phép nếu IAM cho phép; mọi role khác bị từ chối**, kể cả Manager.

## Hợp đồng

`module.json` tuân thủ `TALO-MODULE-PACKAGE-1`, `HOST_PROTOCOL: TALO-MODULE-HOST-1`.
`mic/module.mic.json` tuân thủ MIC-1.0 gồm MIC01–MIC10; 7 Function, 7 K05 action, 11 API, 6 screen tab.

**Không có endpoint CRUD, không có lệnh DB ghi, không chỉnh IAM hoặc Foundation schema.**
