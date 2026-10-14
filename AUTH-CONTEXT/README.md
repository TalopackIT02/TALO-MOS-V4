# Minimal Claude Code support pack

Chép **thư mục `AUTH-CONTEXT/`** (4 file: `00-START-HERE.md`, `01-SOURCE-MAP.md`, `02-CLAUDE-START.txt`, `03-FAST-CHECK.ps1`) vào root repository `TALO-MOS-V4/`. File README này chỉ có trong gói để hướng dẫn, không bắt buộc chép vào repo.

- Dán nội dung `02-CLAUDE-START.txt` cho Claude Code.
- Context chỉ đọc **2 file**; không cần đưa ZIP hay nội dung của chúng vào prompt.
- `03-FAST-CHECK.ps1` là tùy chọn; typecheck có thể mất thời gian, và `-WithTests` chỉ dùng khi cần. Script không chạy DB integration, không cài package, không commit/push.
- Tránh tự động thêm `AUTH-CONTEXT/` vào `CLAUDE.md` hoặc cơ chế always-load: sẽ tốn tokens ở mọi task, kể cả task không liên quan Auth.
- File context phản ánh GitHub `e117d72` và báo cáo trong hội thoại; phải xác minh lại local Git status và các thay đổi chưa commit.
- Gói **không** chứa dữ liệu HIBP, secrets, SQL GRANT, migration hoặc mã runtime mới.
