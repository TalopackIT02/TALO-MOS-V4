# 08 — Bàn giao phát triển CRM Module

## 1. Kiến trúc
- CRM là **Module Package** `modules/CRM` (`TALO-MODULE-PACKAGE-1`, Host `TALO-MODULE-HOST-1`). Không nằm trong Backend Core / Foundation; không gắn route vào `backend/src/server.ts`.
- `modules-sync` chỉ chép `frontend/`, `backend/`, `mic/` (file `.ts/.tsx/.css/.json`) vào `backend/module-releases`; `dev/`, `tests/`, `docs/` không vào package runtime.
- Frontend entry `frontend/index.tsx` export `screens: Record<screenKey, ComponentType<{ tab: number; onSessionLost: () => void }>>` cho 5 screenKey trong `module.json`.
- Backend entry `backend/index.ts`: stub `CRM_BACKEND_STATUS = 'BLOCKED_BY_MODULE_HOST_WRITE_CAPABILITY'`, router rỗng. MIC `mic/crm.mic.ts`: `NOT_AUTHORED_GATE_3`.

## 2. Cấu trúc mã
```
modules/CRM/
  module.json               manifest (5 screens, capabilities)
  frontend/index.tsx        screens → CrmScreen(page)
  frontend/src/
    types/domain.ts         kiểu dữ liệu (khớp DB dictionary + đối tượng Gate 2)
    services/adapter.ts     interface CrmAdapter (hợp đồng phía frontend)
    services/mockAdapter.ts Mock Adapter: quy tắc REV01 + Target Design có nhãn
    mock/seed.ts            dữ liệu giả lập (TEST, không phải khách thật), persona, quyền giả lập
    hooks/crm.tsx           CrmProvider, useCrm, useQuery, useAction, useUrlParam, navigate
    components/ui.tsx       Badge, Modal, PromptDialog, Field, Pagination, Toasts, Reminders, MockBanner, Gate
    components/forms.tsx    AppointmentForm/Detail, TaskForm/Rows, ReportForm
    pages/*.tsx             5 màn hình + CustomerProfile + WorkQueue (hàng đợi bàn giao / pháp lý trong màn Khách hàng)
    styles/crm.css          lớp crm-*, scope .app-shell
  tests/crm.mock.test.ts    29 unit test
  dev/                      harness độc lập (AppShell mirror: compact, drawer mobile), vite config, e2e.mjs (29 bước)
  docs/01..10              tài liệu Gate 1 (09 = ma trận đối chiếu REV01 → REV02 → Module; 10 = truy vết đầu-cuối)
```

## 3. Chạy demo (từ thư mục gốc repo, dùng toolchain sẵn có của Host — không cài thêm gì)
```
# Dev server (http://127.0.0.1:5181/crm)
node frontend/node_modules/vite/bin/vite.js --config modules/CRM/dev/vite.config.mjs
# Build + preview (http://127.0.0.1:5182/crm)
node frontend/node_modules/vite/bin/vite.js build   --config modules/CRM/dev/vite.config.mjs
node frontend/node_modules/vite/bin/vite.js preview --config modules/CRM/dev/vite.config.mjs
# Kiểm tra
node frontend/node_modules/typescript/bin/tsc -p modules/CRM/tsconfig.json
node backend/node_modules/vitest/vitest.mjs run --root modules/CRM
node modules/CRM/dev/e2e.mjs http://127.0.0.1:5182 <thư mục ảnh>
```
Build ra `TALO-MOS-V4_exports/crm-frontend-dev-build` (đổi bằng biến `CRM_DEV_OUT`). Dữ liệu mock lưu `localStorage` (`talo-crm-mock-state`, `talo-crm-mock-account`); "Khôi phục dữ liệu mẫu" đưa về seed.

Kịch bản nghiệm thu nhanh: đổi persona ở thanh "DEMO — IAM GIẢ LẬP" → Quản lý: "Chờ tôi xử lý" duyệt bàn giao KH 000007 → Sale Cường: nhận bàn giao → xem To-do "Đã chuyển giao" (Target Design) → Kế toán / Quản lý: duyệt pháp lý KH 000002 → CSKH chỉ xem: định danh bị che.

## 4. Thay Mock bằng Adapter thật (sau khi có Gate 2/3)
1. Viết `HttpCrmAdapter implements CrmAdapter` gọi các endpoint REV01 (`04_API_IAM_DATABASE_TRACEABILITY.md`), qua tiền tố do Module Host cấp.
2. `crmAdapter()` trong `hooks/crm.tsx` chọn adapter thật khi Host cung cấp write capability; MockBanner tự ẩn (chỉ hiện với `MockCrmAdapter`).
3. Giữ mã lỗi REV01; ánh xạ HTTP 401 → `onSessionLost`.
4. Bỏ dần quyền giả lập: `session.permissions` lấy từ Host capability `authorize/evaluate`.
5. Các phần GAP (Lịch hẹn, To-do, Báo cáo, tạo tổng hợp, To-do theo bàn giao) chỉ chuyển sang thật khi có quyết định OD tương ứng và DB/API được duyệt.

## 5. Điều kiện để sang bước tiếp (không tự thực hiện)
| Bước | Điều kiện | Ai quyết |
|---|---|---|
| Nghiệm thu Gate 1 | Chủ dự án xem demo + báo cáo `CRM_GATE1_FINAL_DESIGN_ALIGNMENT_REPORT.md` | Chủ dự án |
| Gate 2 — DB Extension | Chọn phương án OD-03, 06, 07, 11, 12; duyệt thiết kế bảng Lịch hẹn / To-do / Báo cáo | Chủ dự án |
| Backend thật | Module Host cấp write capability (hiện chỉ `readOnly`) | Chủ dự án + Foundation |
| Gate 3 — IAM/MIC | Đăng ký quyền `crm.*`, MIC CRM, đăng ký module | Chủ dự án |
| Storage | OD-10 | Chủ dự án |

## 6. Ràng buộc vẫn áp dụng
Không sửa Foundation / IAM / SCC / Module Host; không tạo quyền thật hay đăng ký MIC; không chạy SQL/migration; không đăng ký module lên TEST; không thêm nghiệp vụ Đơn hàng / Kho / Kế toán / Công nợ; không dùng dữ liệu khách hàng thật; không commit / push / deploy khi chưa được yêu cầu.
