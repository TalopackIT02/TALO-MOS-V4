# TALO-MOS-V4

**Status:** BOOTSTRAP / NO APPLICATION IMPLEMENTED.

Đây là repository WebApp tích hợp source code, inputs của User, thiết kế, quy định kỹ thuật và đầu ra của Claude Code. **Không dùng AI_HUB hoặc AI_WORK.**

## Bắt đầu
1. Đọc `CATALOG.md` để hiểu cấu trúc folder.
2. Đọc `governance/CLAUDE_CODE_LAW.md`, `governance/PROTECTED_SCOPE.md` và `CLAUDE.md`.
3. Điền các quyết định chính thức vào `governance/TECHNOLOGY_REGISTRY.md` và `governance/ARCHITECTURE.md` (chỉ User hoặc quy trình được User phê duyệt).
4. Đặt tài liệu đầu vào vào `inputs/`, SQL tham chiếu vào `database/design/`.
5. Trước khi coding, tạo TASK, Plan, ghi phê duyệt, phạm vi file, test và thực hiện đúng quy trình.

## Giới hạn bản khởi tạo
- Chưa chọn frontend/backend framework, runtime, database engine hay package manager.
- `apps/`, `packages/`, `tests/` là scaffold thư mục, **chưa có ứng dụng chạy**; không có lệnh start/build/test thực tế.
- Không chứa SQL schema, database connection, credentials hoặc migration.
- File `.env.example` chỉ mô tả nguyên tắc, không chứa thông số cấu hình được bịa ra.
- LAW là hướng dẫn hành vi; để bảo vệ thực tế cần cấp quyền filesystem, database, Git và Claude Code tool permissions theo môi trường triển khai.
