# TALO-MOS-V4

Repository WebApp Fullstack: **ReactJS frontend**, **Node.js/ExpressJS backend**, **PostgreSQL** và **Prisma ORM** theo tài liệu kỹ thuật của dự án.

## Bắt đầu

Mở **catalog.html** để xem cây thư mục và chức năng của từng thư mục/file. File HTML hoạt động offline.

- `frontend/`: giao diện React; chưa scaffold / chưa chạy được.
- `backend/`: API Express; chưa scaffold / chưa chạy được.
- `database/`: tài liệu SQL và vị trí Prisma schema/migrations; chưa có schema hay dữ liệu thật.
- `documents/`: tài liệu User cung cấp.
- `tests/`: kiểm thử.
- `docker/`: cấu hình hạ tầng; chưa triển khai.

**Lưu ý:** Các thư mục trống có `.gitkeep` để Git có thể theo dõi. `docker-compose.yml` chỉ là placeholder, không được coi là môi trường đã cấu hình. Các phiên bản công nghệ và JavaScript/TypeScript chưa được chốt.

## Nguyên tắc

Claude Code chỉ triển khai theo yêu cầu được chấp thuận. Không tự thay đổi quy tắc nghiệp vụ, SQL/schema/migration hoặc tài liệu gốc. Nếu cần thay đổi ngoài phạm vi, phải báo và xin quyết định.

## Chạy Development

- **Windows:** giải nén rồi nhấp đúp `run-dev.cmd` ở thư mục gốc.
- **Linux/macOS:** `bash run-dev.sh`.
- **Chạy riêng:** `cd frontend && npm run dev` hoặc `cd backend && npm run dev`.

Các launcher **không tự cài package hoặc khởi tạo database**; chúng kiểm tra `scripts.dev` và `node_modules` trước khi khởi chạy. Hiện cả frontend/backend chỉ là placeholder nên launcher sẽ thông báo `NOT READY`, không chạy dịch vụ nào. Khi Claude Code scaffold phần mềm, cần bổ sung script `dev`, source code và cài dependencies theo task được duyệt. Catalog HTML chỉ có thể cung cấp nút sao chép lệnh/tải launcher; không thể tự thực thi terminal trên máy.
