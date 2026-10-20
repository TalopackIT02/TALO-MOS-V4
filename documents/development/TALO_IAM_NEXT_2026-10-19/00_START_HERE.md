# TALO-MOS-V4 — IAM Management / Foundation Integration: TIẾP TỤC TRIỂN KHAI

**Mã:** TALO-IAM-NEXT-2026-10-19  
**Ngày:** 19/10/2026  
**Trạng thái:** Development brief — tiếp tục triển khai code; **không phê duyệt thay đổi quyền DB/seed/bootstrap/push/merge/deploy**.  
**Repo:** `TalopackIT02/TALO-MOS-V4`  
**Đích đặt bộ tài liệu trên máy chủ dự án:** `D:\Documents\ClaudeProject\TALO-MOS-V4\documents\development\TALO_IAM_NEXT_2026-10-19\`

## 1. Mục tiêu duy nhất

Hoàn thiện IAM Management đủ **sử dụng thật** trên AppShell hiện hữu, liên thông Foundation Navigation, để quản trị viên có thể **xem tài khoản, tạo/quản lý role, xem/tạo permission phù hợp MIC, gán/thu hồi role và direct permission, xem hiệu lực quyền và quản lý B09 menu bằng giao diện**. Nghiệm thu bằng việc cấp quyền cho một account mở `SYSTEM_TEST` qua menu và thu hồi/DENY khiến menu và API bị chặn.

**Không làm lại Foundation, Auth, IAM evaluator, IAM v0.3, MIC, lifecycle, Module Host hoặc SYSTEM_TEST đã có.**

## 2. Cách đọc theo thứ tự

1. `01_GITHUB_BASELINE_AND_GAPS.md`: nhánh/commit xác minh và việc còn thiếu.
2. `02_IMPLEMENTATION_REQUIREMENTS.md`: công việc phải sửa/hoàn thiện theo ưu tiên; màn hình và API cần dùng thật.
3. `03_FOUNDATION_AND_DB_GUARDRAILS.md`: vùng được thay đổi, quyết định DB phải xin duyệt.
4. `04_ACCEPTANCE_TESTS.md`: điều kiện để được gọi là DONE.
5. `05_EXECUTION_REPORT_TEMPLATE.md`: biểu mẫu trả kết quả có bằng chứng.
6. `06_CLAUDE_CODE_PROMPT.md`: prompt **đọc/ghi nhận hiện trạng rồi lập tức thực hiện các phần không bị chặn**.
7. `07_REFERENCE_FOUNDATION_FREEZE_CONTRACT.md`: bản sao nguyên văn quy tắc FREEZE từ handoff 19/10/2026 (ưu tiên cao nhất trong handoff này).

## 3. Căn cứ nguồn và cách xử lý xung đột

- `CLAUDE.md` trong repo là ranh giới thực thi, đặc biệt `documents/` chỉ đọc và **không tự push/merge/deploy/GRANT**.
- IAM v0.3 Decision Record, SQL/Prisma schema, Auth contracts, Foundation source là baseline chức năng.
- Bộ AI Governance Markdown trong `documents/development/` đang ở trạng thái **DRAFT**, dùng tham chiếu, không thay quyết định đã duyệt.
- Handoff 19/10/2026 là ảnh chụp quá khứ; **không được lấy câu “chưa có IAM API” của handoff cũ làm hiện trạng**, vì PR #1 đã bổ sung mã nguồn.
- **Git HEAD và DB thực tế thắng mọi tuyên bố cũ về “đã triển khai”; phê duyệt của chủ dự án quyết định có được thay đổi hay không**. Nếu phát hiện mâu thuẫn, ghi nhận và chỉ dừng nhánh thay đổi phải phê duyệt, tiếp tục việc được phép.

## 4. Kết quả bàn giao kỳ vọng

Một PR/nhánh IAM thực sự build và test được, không hồi quy Foundation, có bằng chứng cấp/thu hồi quyền và hiển thị/ẩn `SYSTEM_TEST`; nếu DB thiếu quyền hoặc bootstrap chưa duyệt thì báo **BLOCKED** đúng phần đó, kèm phương án SQL giới hạn để duyệt, không nói DONE.
