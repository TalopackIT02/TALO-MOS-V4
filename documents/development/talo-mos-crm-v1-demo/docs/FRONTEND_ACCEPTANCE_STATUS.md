# Frontend acceptance — kiểm thử trình duyệt chưa hoàn tất

**Trạng thái tổng: 20/20 UI NOT_TESTED IN BROWSER.** Các màn hình đã được lập trình trong `src/app/App.tsx` và CSS trong `src/styles/app.css`, nhưng môi trường build không có node_modules; vì vậy không được suy luận UI PASS chỉ từ mock test.

| ID | Kịch bản | Trạng thái | Ghi chú |
|---|---|---|---|
| UI-01 | Topbar/Sidebar/Workspace theo AppShell | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: Bố cục, màu #087f45, padding/tabs đúng mã nguồn tham chiếu |
| UI-02 | Chọn sidebar compact | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: Workspace reflow, flyout 1 menu, không che nội dung |
| UI-03 | Breadcrumb / title / description / tabs / content | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: Đúng 4 block |
| UI-04 | List search/filter/page/sort | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: Scope trước filter/count, page 20 |
| UI-05 | Mở quickview và chi tiết | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: Ẩn pháp lý không đủ quyền |
| UI-06 | Tạo DRAFT, Verify khi đủ/thiếu fields | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: Hai status độc lập, validation |
| UI-07 | VN province/ward vs foreign | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: Ward phụ thuộc province, confirm đổi địa chỉ |
| UI-08 | Nhập duplicated identifier | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: 409 và không tạo mới |
| UI-09 | Người liên hệ không positionTitle | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: Lưu thành công nếu phone OR Zalo |
| UI-10 | Gán PRIMARY/SUPPORT | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: 1 PRIMARY, nhiều SUPPORT; không duplicate |
| UI-11 | Legal approval hai cấp | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: Không cho apply trước đủ 2 stage |
| UI-12 | Handover A/B | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: Đúng steps và transaction mô phỏng |
| UI-13 | Transfer activities OPEN | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: Chỉ của Sale cũ; lịch sử không đổi |
| UI-14 | Upload và version file | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: File cũ còn; badge expired chính xác |
| UI-15 | Download không có quyền | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: 403/404, không lộ storagePath |
| UI-16 | CSV export thiếu quyền | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: Từ chối; có quyền thì chống formula injection |
| UI-17 | Persona change | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: Không cache hồ sơ ngoài scope |
| UI-18 | Reset demo | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: Dữ liệu về fixtures ban đầu |
| UI-19 | Mobile/tablet/desktop | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: Không tràn ngang form, tabs cuộn/hàng hợp lý |
| UI-20 | Truy cập deep link denied | **NOT_TESTED** | Cần chạy Vite và nghiệm thu bằng trình duyệt với expected: Không render nội dung nhạy cảm |

**Phạm vi source code:** AppShell standalone, sidebar compact, breadcrumb, customer quickview + profile 1/3–2/3, create/verify, contacts, assignments, legal changes, handovers, activity timeline, docs, groups, persona switch, CSV, responsive style. Kiểm thử Node đảm bảo phần lớn quy tắc service, không thay thế browser interaction.

## Bổ sung UI REV02 — 12 tiêu chí mới (đều NOT_TESTED browser)

| Case | Tiêu chí | Trạng thái |
|---|---|---|
| UI-R02-01 | Sidebar chính thức đúng 5 mục, không còn các mục quản trị | NOT_TESTED |
| UI-R02-02 | Dashboard chỉ tổng hợp, có link KPI sang screen tương ứng | NOT_TESTED |
| UI-R02-03 | Customer detail 1/3–2/3 và đúng 6 tab | NOT_TESTED |
| UI-R02-04 | Calendar xem ngày/tuần/tháng, chuyển kỳ, chọn ngày | NOT_TESTED |
| UI-R02-05 | Tạo lịch tại hồ sơ → thấy Calendar tổng và ngược lại | NOT_TESTED |
| UI-R02-06 | Sửa/hủy lịch theo quyền, thông báo nhắc trong ứng dụng | NOT_TESTED |
| UI-R02-07 | Tạo To-do tại hồ sơ → thấy Task List tổng và ngược lại | NOT_TESTED |
| UI-R02-08 | Task status OPEN/DONE/overdue, không tự tạo lịch | NOT_TESTED |
| UI-R02-09 | Báo cáo ngày/nội dung/kết quả/vấn đề/việc tiếp tục | NOT_TESTED |
| UI-R02-10 | Tạo báo cáo từ Calendar/To-do giữ origin, hiển thị ở hồ sơ | NOT_TESTED |
| UI-R02-11 | Bàn giao/legal/group/docs trong ngữ cảnh Khách hàng có kiểm quyền | NOT_TESTED |
| UI-R02-12 | Persona + responsive + lọc theo phạm vi dữ liệu | NOT_TESTED |

**Kết luận UI mới:** 12/12 NOT_TESTED. Không suy luận PASS từ parser hoặc 51/51 Mock tests.
