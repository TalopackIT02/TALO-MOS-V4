# SYSTEM_TEST — System Test & Diagnostics (module package)

Package format `TALO-MODULE-PACKAGE-1`, Host protocol `TALO-MODULE-HOST-1`, MIC `MIC-1.0`, version 1.0.0.

## Cài vào một Foundation tương thích
1. Copy nguyên thư mục `SYSTEM_TEST/` vào `modules/` của Host.
2. `npm run build` (hoặc `npm run dev`) trong `backend/` và `frontend/`: Host tự chạy `modules:sync` — đọc `module.json`,
   kiểm protocol/capability, chép package vào `src/installed-modules/` và sinh registry. Không sửa source Host.
3. Đăng ký qua Foundation API như mọi Module: REGISTER → VERSION → PUT MIC (`mic/system-test.mic.ts`) → SUBMIT →
   APPROVE → ACTIVATE → ENABLE, tạo mục menu; quyền IAM `system_test.*` do quản trị IAM cấp. Copy folder **không** phải
   là phê duyệt MIC; Module chỉ chạy khi Session + IAM ALLOW + ACTIVE + ENABLED.

## Giới hạn
- Data Viewer đọc các bảng Foundation B01–B14 bằng vai trò API của Host; bảng không có quyền SELECT hiển thị
  "Không có quyền xem". Module không tự cấp quyền DB.
- Full Regression do runner CLI của Host chạy (`backend/test/system-test/`), dùng các suite của repository này;
  Host khác không có các suite đó thì tab kết quả báo NOT_RUN.
- Test tương thích (unit, PostgreSQL) nằm phía Host: `backend/test/unit/system-test/`, `backend/test/integration/system-test/`.
