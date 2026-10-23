# FMI-02 — Handoff sau FMI-01

**Tài liệu này KHÔNG ủy quyền triển khai FMI-02 trong lượt FMI-01.**

## Đầu vào FMI-02

- Kết quả scan `scanId`, `packageHash`, `moduleKey`, `packageVersion`, MIC JSON, registry classification, static issues.
- `eligibleForPreflight=true` chỉ cho phép chuẩn bị test candidate; không phải activate.
- Candidate phải được snapshot bởi cơ chế staging cách ly với installed runtime. Nếu packageHash thay đổi, invalidating test evidence và yêu cầu chạy lại.

## FMI-02 dự kiến

- TypeScript typecheck, import/Host handshake, backend/frontend build.
- API response contract tests (bắt lỗi UNEXPECTED_RESPONSE), session/IAM denied tests.
- Test PostgreSQL trên TEST có fixture cleanup, schema/data contract, SQL privilege.
- Navigation/route mapping, regression Host/AppShell/IAM/Foundation.
- Evidence runner phát hành MIC10 PASS có file reference, run ID, candidate hash, môi trường, kết quả.
- Trạng thái workspace: DRAFT/VALIDATING/NEEDS_FIX/READY. Chưa ghi version B02 chính thức.

## FMI-03 dự kiến

- Cài đặt/phát hành package đã READY, verify hash, đăng ký Foundation, finalize MIC, IAM provisioning theo policy, B09, ACTIVATE và postcheck.
- Bản ACTIVE cũ phải tiếp tục chạy cho đến khi nâng cấp hợp lệ. Vì lifecycle hiện tại không có RETIRED→ACTIVE đơn giản, cần plan rollback riêng trước activation.

## Không được suy diễn từ FMI-01

- MIC10 `PASS` do AI ghi trong file không được công nhận runtime evidence.
- Scan status `PASS` không chứng minh backend/frontend chạy thành công.
- Folder version trùng ACTIVE không có nghĩa bản local đang là bản deployed.
- `packageHash` scan không phải `manifest_hash` B02; là hai giá trị khác nhau.
- Không có quyền tự cấp IAM hoặc chỉnh B09.
