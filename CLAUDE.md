# CLAUDE.md — TALO-MOS-V4

## Phạm vi

Repository này chỉ chứa phần mềm Fullstack và tài liệu kèm theo; không sử dụng AI_HUB/AI_WORK.

## Technology baseline từ tài liệu User
- Frontend: ReactJS, React Router, Axios, React Hook Form, Zod, MUI, TanStack Table, DayJS, Recharts, React Toastify.
- Backend: Node.js LTS, ExpressJS, Prisma ORM.
- Database: PostgreSQL.
- DevOps: Git, GitHub, Docker/Docker Compose; Nginx ở tầng triển khai.
- Chưa tự chọn phiên bản, ngôn ngữ JS/TS, thư viện bổ sung hoặc dịch vụ ngoài tài liệu.

## Ranh giới
1. `documents/` là đầu vào do User sở hữu: chỉ đọc, không ghi đè.
2. Không tự thay đổi business logic đã duyệt, cấu trúc database, file SQL thiết kế, Prisma schema/migrations hoặc dữ liệu.
3. Chỉ sửa `frontend/`, `backend/`, `tests/`, `docker/` và file cấu hình được nêu đích danh trong task đã duyệt.
4. Không tự cài dependency, thay framework, chạy migration, seed, xóa dữ liệu, push/merge/deploy production hoặc chỉnh quyền khi chưa được phê duyệt.
5. Nếu yêu cầu đụng protected scope, ghi rõ vấn đề và chờ User quyết định; không suy diễn phê duyệt.
6. Sau khi thực hiện, nêu file đã sửa, dependencies, lệnh test đã chạy, kết quả thật và phần chưa kiểm tra.
7. Không tuyên bố PASSED/COMPLETED khi thiếu bằng chứng.

LƯU Ý: Đây là chỉ dẫn cho agent, không thay thế phân quyền thực tế của hệ điều hành, Git hoặc PostgreSQL.
