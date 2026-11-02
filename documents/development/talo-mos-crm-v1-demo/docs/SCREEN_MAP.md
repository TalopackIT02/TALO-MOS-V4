# TALO-MOS — CRM V1 REV02 Screen Map (29/10/2026)

## Sidebar: CHỈ 5 mục, chính thức

| Sidebar | Route | Mục tiêu |
|---|---|---|
| Tổng quan công việc | `/demo/crm` | KPI hoạt động, lịch hẹn, To-do, gần đây, cảnh báo |
| Khách hàng | `/demo/crm/customers` | Danh sách, hồ sơ, liên hệ, tài liệu, nhóm và quản trị theo quyền |
| Lịch hẹn | `/demo/crm/schedule` | Calendar ngày/tuần/tháng, hẹn khách, nhắc trong ứng dụng |
| Công việc | `/demo/crm/tasks` | To-do, trạng thái, quá hạn và hoàn thành |
| Báo cáo | `/demo/crm/reports` | Work Report: nội dung, kết quả, ghi chú, kế hoạch tiếp theo |

Không có Sidebar cho Bàn giao, Phê duyệt pháp lý, Nhóm ngành, Tài liệu hết hạn hoặc Demo IAM. Tên module `Kinh doanh` có thể là nhãn nhóm, **không phải mục thứ sáu**.

## Routes nằm trong ngữ cảnh Khách hàng / khu vực demo (không vào Sidebar)

| Route | Cách mở | Bảo vệ |
|---|---|---|
| `/demo/crm/customers/new` | Tạo khách trong danh sách | `customer.create` |
| `/demo/crm/customers/:id` | Chọn khách trong danh sách hoặc từ Schedule/Task/Report | Scope `customer.read` |
| `/demo/crm/customers/:id/edit` | Hồ sơ → Chỉnh sửa | `customer.update`, pháp lý phải đi qua yêu cầu |
| `/demo/crm/groups` | Thanh chức năng Khách hàng | Quyền tạo/sửa `group.manage`, gán `group.assign` |
| `/demo/crm/handovers` + `/:id` | Quản trị bàn giao trong ngữ cảnh Khách hàng | Chỉ hiện nút quản trị khi có quyền; API kiểm quyền/scope |
| `/demo/crm/legal-approvals` | Quản trị Khách hàng / người duyệt | `legal.change.approve.management/accounting` |
| `/demo/crm/documents/expiring` | Công cụ Khách hàng | `document.read` |
| `/demo/crm/demo-access` | Nút kiểm tra quyền trong dải DEMO | Fixture IAM, không IAM thật |
| `/demo/crm/activities` | Deep-link REV01 tương thích | Alias sang Task List, không có Sidebar |

## Hồ sơ khách — bố cục 1/3 – 2/3

- Cột trái 1/3: mã, tên, trạng thái DRAFT/VERIFIED, tên pháp lý, mã định danh (masked theo quyền), người đại diện, địa chỉ và Sale chính.
- Cột phải 2/3: **6 tab**, theo thứ tự `Tổng quan`, `Thông tin liên hệ`, `Lịch hẹn`, `Công việc`, `Hoạt động & Kết quả`, `Tài liệu`.
- `Lịch hẹn` và `Công việc` tại hồ sơ dùng **cùng MockCrmApi + cùng mảng activity** với Calendar/To-do tổng. Không tạo store thứ hai.
- Tab `Hoạt động & Kết quả` hiển thị các báo cáo NOTE và timeline hoạt động liên quan khách.
- Nhóm ngành nằm trong chức năng Khách hàng; sửa pháp lý và bàn giao qua các điều khiển có điều kiện quyền, **không trở thành tab hồ sơ mặc định**.

## Quy tắc 4 Block

1. Breadcrumb (`Kinh doanh > CRM > ngữ cảnh`).
2. Tiêu đề, mô tả và actions của màn hình.
3. Thanh chức năng theo ngữ cảnh (không trộn nhóm sidebar cũ).
4. Nội dung màn hình / hồ sơ khách.

## Quy tắc nghiệp vụ phân biệt

- Schedule = `activity_type_code=MEETING`, dùng `occurred_at` làm giờ hẹn. Một lịch có thể bị hủy trong mock (CANCELLED).
- To-do = `activity_type_code=TASK` hoặc `FOLLOW_UP`, hạn trong `due_at`, trạng thái `OPEN/DONE`. To-do không xuất hiện trên Calendar nếu không phải MEETING.
- Work Report = `activity_type_code=NOTE`, trạng thái DONE, nội dung có marker demo. Phân loại này là **demo projection**, chưa phải hợp đồng báo cáo Backend chính thức.
- Hoạt động gốc khi báo cáo từ Calendar/To-do được ghi dưới dạng id văn bản trong `description`; phải thiết kế FK/API khi tích hợp thật.

## Trạng thái

Source REV02 đã sửa theo handoff. Mock/unit tests có thể chạy không cần frontend dependencies. **Nghiệm thu UI qua trình duyệt: NOT_TESTED.**
