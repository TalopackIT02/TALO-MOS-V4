# TALO-MOS-V4 — FMI-02 + FMI-03 / Integrated Foundation Installer

Ngày lập hồ sơ: 2026-10-23. Trạng thái: **IMPLEMENTATION SPEC / NOT DEPLOYED**.

Mục tiêu: **Không cần Claude Code để thêm, kiểm thử, hay kích hoạt một module sau khi Foundation Installer hoàn thành**. Claude Code (nếu dùng) chỉ triển khai nền tảng Installer một lần. Lần thêm module về sau phải thực hiện trong giao diện Foundation.

## Phạm vi

1. Khắc phục xung đột route bởi các fixture `FBET_*` trên TEST; ngăn tái phát và làm gọn dữ liệu quản trị mà không phá lịch sử.
2. FMI-02: Preflight/Run Tests — chạy kiểm tra thực có bằng chứng, xuất và xác minh MIC10 theo package hash; candidate không bị khóa khi còn lỗi.
3. FMI-03: Install & Activate — quản lý deploy có kiểm soát, MIC/versions, quyền IAM, navigation, backend/frontend runtime và hậu kiểm.
4. Nghiệm thu thực tế trên `talo_mos_v4_test`, tuyệt đối không động DEV/PROD.

## Baseline nhìn thấy từ giao diện người dùng

- 23/10/2026: Module Scan nhận 2 folder; DATA_INSPECTOR 0.1.0 ACTIVE; SYSTEM_TEST 1.2.0 DRAFT.
- SYSTEM_TEST 1.1.1 ACTIVE; 1.2.0 có lỗi xung đột `/system-test` và `/system-test/runner` với module fixture FBET ACTIVE.
- MIC10 1.2.0 NOT_TESTED; package hash chưa được Foundation đối chiếu.
- Quản lý Module hiển thị ~1.914 module thử nghiệm `FBET_*` bị ẩn mặc định. **Số liệu ảnh chụp, phải đo lại bằng truy vấn TEST trước khi hành động**.
- FMI-01 Manual Scan đang hiện trên giao diện; mã FMI-01 local chưa được kiểm chứng với GitHub (branch từ xa còn ở trạng thái cũ).

## Nguyên tắc triển khai

- Không viết lại IAM, Foundation v0, AppShell; sửa theo hướng bổ sung và kiểm thử hồi quy.
- Không tự động quét filesystem. Scan chỉ khi nhấn nút.
- Không sửa version B02 đã APPROVED/ACTIVE để vượt gate. Candidate workspace đứng **trước** vòng đời version chính thức.
- Không dùng testEvidence `PASS` do AI tự khai báo; evidence PASS phải do engine thực thi và liên kết package hash + environment + run ID.
- Không tự tạo SQL GRANT, không tắt FK, không xoá B07/B08/audit, không TRUNCATE/CASCADE.
- Không xóa module ACTIVE thật, kể cả DATA_INSPECTOR, khi chưa có chuyển đổi thành công và xác nhận chủ dự án.
- Không quảng bá `ACTIVE` nếu code chưa được nạp, IAM/Navigation chưa sẵn sàng và hậu kiểm chưa PASS.
- Thiếu deploy supervisor/restart control, không được hứa zero-downtime hay tự động cài đặt hoàn tất.

## Nội dung hồ sơ

- `01_BASELINE_AND_RISKS.md`: trạng thái, fact-check, blockers.
- `02_FBET_CLEANUP.md`: làm sạch route/fixture và ngăn tái phát.
- `03_FMI02_PREFLIGHT.md`: chạy thử tự động có evidence.
- `04_FMI03_INSTALLER.md`: orchestration/cutover và rollback.
- `05_IAM_NAVIGATION_LIFECYCLE.md`: xử lý phụ thuộc và quyền.
- `06_API_UI_CONTRACT.md`: API và UX.
- `07_SECURITY_AND_GATES.md`: rào bảo vệ.
- `08_TEST_ACCEPTANCE.md`: kiểm thử nghiệm thu.
- `09_RUNBOOK.md`: thứ tự triển khai một lần.
- `10_CLAUDE_CODE_IMPLEMENTATION_PROMPT.md`: prompt đầy đủ để Claude Code **xây Foundation Installer**, không phải thêm module thủ công.

## Đích sử dụng

Giải nén vào `D:\Documents\ClaudeProject\TALO-MOS-V4\documents\development\`. ZIP có folder gốc `FMI-02-03-FOUNDATION-INSTALLER`.

**Các tài liệu là bản thiết kế; chưa triển khai code, chưa dọn fixture hay thay đổi TEST database.**
