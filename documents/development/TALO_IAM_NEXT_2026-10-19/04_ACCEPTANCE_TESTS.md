# 04 — KIỂM THỬ VÀ TIÊU CHÍ NGHIỆM THU IAM ↔ FOUNDATION

**Phân biệt:** `PASS` = đã chạy và có output; `FAIL` = đã chạy và lỗi; `SKIPPED` = runner chủ động bỏ qua, phải ghi lý do; `NOT_TESTED` = chưa chạy/không có môi trường; `BLOCKED` = thiếu phê duyệt/điều kiện. Không báo DONE từ source review.

## Gate 0 — Trước code

- Ghi Git branch/remote SHA/local status và diff PR #1 so với `main`.
- Chụp read-only/HTTP baseline Foundation và Auth trong môi trường khả dụng; ghi nếu không có database thật.
- Ghi rõ target DB/role; chưa được đổi DB hay chạy write test vào database nghiệp vụ.
- Xác nhận các file cần sửa đúng `03_FOUNDATION_AND_DB_GUARDRAILS.md`.

## Gate 1 — IAM Management

| ID | Nghiệm thu | Kỳ vọng |
|---|---|---|
| IAM-01 | Login admin đúng scope; list accounts/role/catalog | Dữ liệu thật, tìm kiếm/trang, F5 không mất |
| IAM-02 | Chưa login / activation session | 401/403 đúng Auth session contract |
| IAM-03 | Account thường không quyền admin | 403 cho API admin, không lộ dữ liệu |
| IAM-04 | Grant undefined/ambiguous, thiếu assurance, account inactive | Fail closed |
| IAM-05 | Tạo/sửa/kích hoạt/vô hiệu hóa role | Lưu thật; system role không bị sửa trái quy định |
| IAM-06 | Gán/bỏ permission vào role | Hiển thị đúng; không cho duplicate active trái unique constraint |
| IAM-07 | Gán/thu hồi Role trên account | `revoked_at` đúng và grant mất hiệu lực |
| IAM-08 | Direct ALLOW/DENY và revoke | DENY thắng ROLE ALLOW; revoke DENY có thể phục hồi ALLOW |
| IAM-09 | Permission definition theo MIC-07 | Đúng K05, không trùng code/triple, không tự tạo khi ACTIVATE |
| IAM-10 | Validation UUID, body, expiredAt, duplicate FK | Lỗi có mã đúng; không lộ SQL/secret; không có 500 giả cho lỗi 409 dự kiến |
| IAM-11 | IAM audit/transaction | Audit và mutation cùng commit/rollback; fail closed khi thiếu privilege |
| IAM-12 | Effective permissions account khác | Không lẫn assurance/session admin với trạng thái target; chỉ hiển thị kết quả có căn cứ |
| IAM-13 | Least privilege | Runtime role không cần superuser/owner; kiểm tra phép bị cấm |

## Gate 2 — Navigation & SYSTEM_TEST

| ID | Nghiệm thu | Kỳ vọng |
|---|---|---|
| NAV-01 | Admin chọn module, Function (B03/B05/B06) | Chọn bằng tên, không nhập UUID thủ công; đúng ACTIVE version |
| NAV-02 | List B09 và chỉnh menu | DB persistent, reload nhìn thấy; dùng PATCH Foundation hiện có |
| NAV-03 | Tạo menu `DIAGNOSTICS`, `DATA_VIEWER`, `TEST_RUNNER` | Có 3 Function items đúng MIC-04; parent/group nếu cần |
| NAV-04 | No grants hoặc Direct DENY | Không thấy SYSTEM_TEST; module API 403 |
| NAV-05 | Đủ grants + ACTIVE/ENABLED + B09 | Thấy đúng SYSTEM_TEST, mở `/system-test`, `/system-test/data`, `/system-test/runner` |
| NAV-06 | User 2 không được cấp quyền | Không thấy; không gọi được API; account isolation |
| NAV-07 | Revoke Role hoặc revoke Direct ALLOW | Sau refresh/session mới, menu biến mất và API từ chối nếu không còn nguồn ALLOW khác |
| NAV-08 | Module DISABLED/không ACTIVE, MIC hash sai, B09 hidden | Menu ẩn; không tự bypass |
| NAV-09 | F5/back-forward, sidebar và AppShell | Không phá 4 Block, route/tab và UI Foundation cũ |

**Điểm quyết định:** Nếu Foundation 1.0.3 chưa ACTIVE/ENABLED trong DB, **không tự chuyển lifecycle bằng SQL**. Xác định chính xác hạng mục có thể xử lý qua UI hiện có, rồi làm bằng quyền hợp lệ khi được phép.

## Gate 3 — Foundation FREEZE regression

| ID | Bất biến |
|---|---|
| FRZ-01 | Register Module, create version, save/reload MIC như trước |
| FRZ-02 | SUBMIT/APPROVE/ACTIVATE/ENABLE/DISABLE, gates/hash/audit như trước |
| FRZ-03 | GET Foundation Navigation vẫn là menu cá nhân được lọc IAM |
| FRZ-04 | POST/PATCH B09 và UI Foundation cũ không bị đổi hành vi |
| FRZ-05 | Auth login/session/first-change/logout không hồi quy |
| FRZ-06 | `SYSTEM_TEST` tiếp tục được load generic qua Module Host, không hardcode |
| FRZ-07 | IAM/Foundation DB schema và dữ liệu/version hiện hữu được bảo tồn |
| FRZ-08 | Diff/test trước và sau không xuất hiện regression ngoài phạm vi |

## Lệnh kiểm thử tham chiếu (lệnh phải chạy thật trên máy Claude Code)

```powershell
cd D:\Documents\ClaudeProject\TALO-MOS-V4\backend
npm run prisma:generate
npm run typecheck
npm test
npm run build

cd ..\frontend
npm run typecheck
npm run build
```

- Đọc scripts trong `package.json` trước khi chạy, không đoán flag; `npm run prisma:generate` chỉ sinh client local, không chạy migration.
- Chạy `tests/` browser/E2E theo cấu hình đã có; ghi trường hợp không có Browser/server/test fixture.
- Test PostgreSQL integration chỉ bật các cờ tương ứng khi đúng **isolated test DB** và được phép chạy; tuyệt đối không bật trên DB nghiệp vụ.
- Những thông tin test cũ (ví dụ 283 PASS /149 SKIPPED ngày 19/10/2026) là **baseline lịch sử**, không thay kết quả chạy của nhánh PR #1.

## Kết luận nghiệm thu

- **DONE** chỉ khi Gate 1/2 có evidence thực, Gate 3 không hồi quy, database grant/bootstrap được chấp thuận và cấp quyền có thể thực hiện từ UI.
- **PARTIAL** nếu build và UI đã làm nhưng DB/E2E chưa chạy.
- **BLOCKED** nếu cần GRANT/bootstrap/protected-source changes chưa được duyệt.
- Thất bại regression: giữ Foundation, sửa/rollback phần IAM gây lỗi; không tự sửa Foundation ngoài scope.
