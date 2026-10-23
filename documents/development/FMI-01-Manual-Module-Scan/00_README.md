# TALO-MOS-V4 — FMI-01 Manual Module Scan

**Tình trạng:** APPROVED DESIGN / READY FOR IMPLEMENTATION — chưa triển khai hoặc nghiệm thu  
**Phiên bản hồ sơ:** 1.0 — 23/10/2026  
**Đường dẫn lưu đề nghị:** `D:\Documents\ClaudeProject\TALO-MOS-V4\documents\development\FMI-01-Manual-Module-Scan\`  
**Môi trường tích hợp:** chỉ `talo_mos_v4_test`, không DEV/PROD.

## Mục đích

Người dùng chép một folder module do AI tạo vào `modules/MODULE_KEY/`, mở **Foundation → Quản lý Module → Module & Phiên bản**, nhấn **Quét Module**, xem báo cáo tĩnh về manifest, MIC, version, route và các điều kiện sơ bộ. Scanner **không** chạy test runtime, không cài đặt, không đăng ký, không ghi database và không tự kích hoạt.

## Bộ hồ sơ

| Tệp | Nội dung |
|---|---|
| `01_FUNCTIONAL_SPEC.md` | Phạm vi, luồng thao tác, trạng thái, acceptance |
| `02_UI_UX_SPEC.md` | Giao diện nút, bảng, ba thanh trạng thái, drawer |
| `03_API_CONTRACT.md` | API, payload, auth, errors, validation |
| `04_SCAN_RULES.md` | 20 phép kiểm, rule ưu tiên, MIC, registry, hash |
| `05_SECURITY_CONSTRAINTS.md` | IAM, filesystem, no-write, deny audit, giới hạn |
| `06_HOST_RUNTIME_GUARD.md` | Rủi ro `modules:sync` và bảo vệ module đã chạy |
| `07_TEST_ACCEPTANCE.md` | Bộ test T01–T22, test xấu, bằng chứng và gates |
| `08_IMPLEMENTATION_RUNBOOK.md` | Quy trình Claude Code làm một lượt, đường dẫn và verify |
| `09_CLAUDE_CODE_PROMPT.md` | Prompt tự chứa, giao cho Claude Code thực thi |
| `10_FMI02_HANDOFF.md` | Ranh giới và contract đầu vào cho FMI-02 |

## Quy tắc bất biến

1. **Manual-only:** Không tự quét trên trang, login, khởi động, build, thay file, không watcher/polling.
2. **Read-only:** Scan không INSERT/UPDATE/DELETE B01–B14/IAM/B09, không chạy lệnh, không ghi vào module folder; DENIED audit bảo mật của Foundation nếu từ chối request là ngoại lệ do cơ chế IAM hiện hành.
3. **Không đụng module ACTIVE:** SYSTEM_TEST hiện ở local có thể là 1.1.1 (GitHub cũ có 1.0.0), DATA_INSPECTOR đã ENABLED trên TEST. Local working tree là nguồn thật, tuyệt đối không reset/checkout đè.
4. **Không sửa lifecycle:** DRAFT/IN_REVIEW/APPROVED/ACTIVE/RETIRED thuộc Foundation hiện hành; kết quả scan chỉ là preview, không tạo READY/ACTIVE và không được coi là MIC10 runtime evidence PASS.
5. **Không tự lấy MIC từ mã không tin cậy:** Scanner đọc JSON dữ liệu; không `import`, `eval`, `tsx`, dynamic execution đối với package chưa duyệt.
6. **Không làm trái Host contract:** Chưa có package hash gắn với version trong DB thì không kết luận mã local khớp code đang chạy chỉ dựa vào số version.

## Cách sử dụng

1. Giải nén ZIP vào `...\documents\development\`. Kết quả là thư mục `FMI-01-Manual-Module-Scan`.
2. Mở Claude Code ở repository root `D:\Documents\ClaudeProject\TALO-MOS-V4`.
3. Dán toàn bộ `09_CLAUDE_CODE_PROMPT.md` (hoặc trỏ Claude Code đọc nguyên file).
4. Claude Code phải đọc tất cả tài liệu trong folder trước khi sửa mã nguồn, chạy baseline và thực hiện từ A–F trong một lượt.
5. Chỉ gọi DONE khi test bắt buộc PASS. Chưa có bằng chứng runtime/TEST phải ghi NOT_TESTED/BLOCKED, không suy diễn.

**Không đưa thư mục tài liệu này vào `modules/`**, nơi chỉ dành cho package module.
