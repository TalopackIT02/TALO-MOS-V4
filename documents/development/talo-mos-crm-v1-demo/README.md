# TALO-MOS CRM V1 — Web Demo REV02

**Ngày handoff:** 29/10/2026. **Trạng thái:** Web Demo **SOURCE READY / MOCK TEST PASS / RUNTIME NOT VERIFIED**. React + TypeScript + Vite. Standalone, không kết nối CRM TEST/Production hoặc tài khoản Foundation/IAM thật. Không chạy SQL, commit, deploy hoặc MIC registration.

## Chạy trên máy có internet

Yêu cầu Node.js 20.19+ (khuyến nghị Node 22) và npm.

```bash
cd talo-mos-crm-v1-demo
npm install
npm run build
npm run dev
```

Truy cập **http://127.0.0.1:5173/demo/crm**. Chạy tests độc lập với Vite: `npm test`; kiểm cú pháp: `npm run check:syntax`. `npm run preview` sau khi build thành công.

**Quan trọng:** tại môi trường tạo ZIP, không DNS đến npm registry nên `npm install` bị chặn và `npm run build` không thể xác minh; **đừng coi frontend build hay runtime đã PASS**. Đã chạy 51/51 Mock tests PASS. Xem `docs/BUILD_STATUS.md`.

## Điều hướng chính thức (hạn chế 5 Sidebar)

| Sidebar | Nội dung |
|---|---|
| **Tổng quan công việc** | Khách phụ trách, lịch hôm nay/sắp tới, To-do mở/quá hạn/hoàn tất, hoạt động gần đây |
| **Khách hàng** | Danh sách, hồ sơ, liên hệ, nhóm ngành, tài liệu, hoạt động, quản trị có quyền |
| **Lịch hẹn** | Calendar ngày/tuần/tháng, ngày giờ hẹn, địa điểm, nội dung dự kiến, nhắc trong ứng dụng |
| **Công việc** | To-do gắn khách hàng, hạn hoàn thành, OPEN/DONE, quá hạn, lọc |
| **Báo cáo** | Nội dung đã làm, kết quả, vấn đề, tiếp theo, gắn khách và nguồn hoạt động |

Hồ sơ khách: cột pháp lý bên trái **~1/3**, tabs bên phải **~2/3**: Tổng quan, Thông tin liên hệ, Lịch hẹn, Công việc, Hoạt động & Kết quả, Tài liệu. Các chức năng nhạy cảm (phân công/bàn giao, duyệt pháp lý) **không nằm Sidebar**, chỉ xuất hiện ở Khách hàng hoặc ngữ cảnh quản trị và phải qua quyền Mock IAM.

## Hướng dẫn thử demo

1. Dùng Persona selector ở dải `DEMO` (Sale An, Bình, Chi, Quản lý, Kế toán, Admin), không tương đương quyền IAM thật.
2. Vào **Khách hàng** → hồ sơ `000001`. Mở tab **Lịch hẹn** để tạo lịch; chuyển sang Sidebar **Lịch hẹn** thấy cùng dữ liệu. Lịch tạo ở Calendar tổng cũng trở lại hồ sơ khách.
3. Mở tab **Công việc** tạo To-do; chuyển sang Sidebar **Công việc** để lọc, sửa, hoàn thành. To-do không tự xuất hiện thành lịch hẹn.
4. Tại To-do hoặc Calendar bấm **Lập báo cáo** để ghi nhận kết quả có liên kết origin trong mô tả demo; xem tại Sidebar **Báo cáo** và tab **Hoạt động & Kết quả**.
5. Trong danh sách **Khách hàng**, dùng thanh chức năng theo ngữ cảnh để xem **Nhóm**, **Quản trị bàn giao**, **Phê duyệt pháp lý**, **Tài liệu đến hạn** theo quyền. Trong hồ sơ, mở **Quản trị hồ sơ / Yêu cầu đặc biệt** để yêu cầu pháp lý hoặc bàn giao khi được cấp quyền.
6. Dùng mục **Xem quyền demo / Reset** trong thanh DEMO để đổi ngày mô phỏng và reset toàn bộ fixture. Dữ liệu chỉ trong localStorage và bộ nhớ tab.

## Phân biệt nguồn dữ liệu và các gap

- Database theo báo cáo: baseline **11 bảng/114 cột**, migration ứng viên target **15 bảng/173 cột**. Chưa kiểm tra DB TEST live, không coi candidate đã cài.
- Backend contract REV01: **40 endpoint**, giữ nguyên đường dẫn. Các route CRM mới là route giao diện **không phải API mới**.
- Calendar dùng activity `MEETING` + `occurred_at`; To-do dùng `TASK/FOLLOW_UP` + `due_at`; Work Report dùng `NOTE/DONE`. Đây là ánh xạ V1 **demo** trên bảng activity có sẵn.
- Địa điểm/nhắc lịch/chi tiết báo cáo/origin được serialize vào trường `description` có marker; **không phải hợp đồng Backend được duyệt**, không có FK bền vững. Hủy lịch và nhập `occurred_at` được Mock PATCH/POST hỗ trợ **tạm thời**; cần thiết kế/đối soát API thật.
- Nhắc lịch tính trong app theo demo clock tại 10:00 ngày mô phỏng; **không email, push hay background notification**.
- Chưa có tính năng Đơn hàng/Kho/Doanh thu/Công nợ; không tự khởi tạo module nguồn.
- Docs: `docs/GAP_REPORT_REV02.md` liệt kê cụ thể các điểm cần bổ sung trước tích hợp thật.

## Source tree

- `src/app/App.tsx`: AppShell TALO-MOS, 5 Sidebar, khách hàng + quản trị theo quyền.
- `src/workflows/WorkflowScreens.tsx`: Calendar, Task List, Work Report dùng chung adapter và dữ liệu.
- `src/workflows/adapter.ts`: ánh xạ trên activity, helper Mock API và quy ước serialized text demo (KHÔNG DDL).
- `src/mock/{service,seed,handlers}.ts`: 40 routes, mẫu dữ liệu, phân quyền, thay đổi pháp lý, bàn giao, file, audit.
- `src/domain/types.ts` / `src/data/database-dictionary.json`: mô hình khách hàng và dictionary source.
- `src/styles/app.css`: AppShell + styling workflow responsive.
- `tests/mock.test.cjs`: 39 backend Mock tests từ REV01.
- `tests/workflows.test.cjs`: 12 checks REV02.
- `docs/`: SCREEN_MAP, API_MAPPING, GAP_REPORT, BUILD_STATUS, TEST_REPORT, acceptance checklist và minh chứng.

**Giới hạn UI:** Bố cục dựa trên REV01 snapshot AppShell; chưa thể nghiệm thu pixel-perfect với repository thật hoặc screenshot, chưa kiểm viewport. Runtime frontend chưa được kiểm chứng do thiếu npm dependencies. Đây là nguồn demo phục vụ phát triển, **không phải bản production**.
