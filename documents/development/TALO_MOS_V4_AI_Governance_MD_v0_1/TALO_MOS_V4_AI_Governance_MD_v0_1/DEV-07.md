# TALO-MOS-V4

## QUY TRÌNH TRIỂN KHAI, KIỂM THỬ VÀ NGHIỆM THU

Mã tài liệu: DEV-07

Phiên bản: 0.1

Trạng thái: DRAFT — CHỜ PHÊ DUYỆT

Ngày soạn: 15/10/2026

Phạm vi: Khung quy tắc phát triển phần mềm; không cấp quyền thực thi thay đổi code/database

Phân loại: các quy tắc được gắn nhãn ĐỀ XUẤT trong bộ tài liệu chưa trở thành quy định bắt buộc cho đến khi chủ hệ thống phê duyệt. IAM v0.3 và ranh giới CLAUDE.md đang có được kế thừa, không ghi đè.

## 1. Bảy cổng triển khai

- GATE 1 Business Scope: business flow, actor, case bình thường/ngoại lệ, tiêu chí thành công.

- GATE 2 Architecture Review: Foundation/IAM/Module/DB owners, khả năng tái dùng, tác động.

- GATE 3 UI Specification: AppShell, 4 Block, mockup hoặc HTML prototype được duyệt.

- GATE 4 Contract Design: API/Capability/Authorization/Data/Workflow, validation, audit.

- GATE 5 Approval: file scope, dependencies, DB changes, rollback, test plan.

- GATE 6 Development & Tests: thực hiện trong scope, test security/business/regression.

- GATE 7 Acceptance & Handoff: nghiệm thu với bằng chứng, bàn giao, tồn đọng.

## 2. Đầu vào bắt buộc của task Claude Code

- Mục tiêu và out-of-scope, danh sách file được phép chỉnh, liên kết quyết định/contract, điều kiện test, quyền thao tác DB, rollback.

- Không nhầm plan với phê duyệt triển khai. Một yêu cầu đọc GitHub không cho phép sửa repository.

- Cần xác nhận Git branch/HEAD, trạng thái worktree, cấu hình môi trường và database mục tiêu trước khi thực thi tác vụ có side effect.

## 3. Tiêu chí kiểm thử

- Kiểm tra quyền deny override, role aggregation, trạng thái Account, Module disable và feature registration.

- Kiểm tra điều kiện nghiệp vụ, transaction, workflow, audit, migration compatibility.

- Kiểm tra AppShell responsive, sidebar, accessibility, 4 Block và visual consistency.

- Kiểm tra local/test tách production, không tuyên bố production-ready từ kết quả local.

## 4. Mẫu báo cáo nghiệm thu

- Mã task/version/commit; phạm vi đã làm; file sửa; test và lệnh thực chạy; PASS/FAIL/NOT TESTED; ảnh hưởng DB; vấn đề mở.

- Ghi rõ bằng chứng đã xác minh trực tiếp và thông tin chỉ trích từ báo cáo trước.

## Nguồn tham chiếu và giới hạn

- TaloMOS.docx: Tài liệu ý tưởng do chủ hệ thống cung cấp, 19 trang; mục A.1–A.2, quy ước UI 4 Block, CRM và Sản phẩm.

- GitHub / CLAUDE.md: https://github.com/TalopackIT02/TALO-MOS-V4/blob/main/CLAUDE.md

- GitHub / IAM Decision Record v0.3: https://github.com/TalopackIT02/TALO-MOS-V4/blob/main/documents/database-design/IAM%26Sercurity/TALO-MOS-IAM-v0.3-Decision-Record.md

- GitHub / IAM Prisma mapping: https://github.com/TalopackIT02/TALO-MOS-V4/blob/main/database/prisma/schema.prisma

- GitHub / AUTH Context: https://github.com/TalopackIT02/TALO-MOS-V4/blob/main/AUTH-CONTEXT/00-START-HERE.md

Chưa xác minh trạng thái database local/production hoặc kiểm thử lại. Mọi khác biệt cần kiểm tra trên môi trường đích bằng thao tác chỉ đọc trước khi áp dụng.

## Phê duyệt tài liệu

| Người phê duyệt | ____________________________ |

| --- | --- |

| Ngày phê duyệt | ____________________________ |

| Quyết định | ☐ Phê duyệt  ☐ Yêu cầu sửa  ☐ Chưa phê duyệt |
