# FMI-01 — Rào an toàn Security/IAM/Filesystem

## Phân quyền

- Giao diện chỉ hiển thị Quét Module cho tài khoản có cả `foundation.module_registry.read` và `foundation.module_registry.create`.
- API dùng `sessionHandler()` và `AccessGuard.authorize()` của Foundation, kiểm tra cả hai quyền theo IAM evaluator, assurance và policy hiện hành; không tự chế auth hoặc bypass.
- Quy tắc B08 DENIED audit của Foundation vẫn áp dụng khi một quyền bị từ chối. Đây là ghi audit bảo mật hiện hữu, khác với write dữ liệu nghiệp vụ từ **scan được cho phép**.
- Scan được cho phép chỉ SELECT Foundation. Không tạo B08 SUCCESS nếu quy tắc Foundation chưa định nghĩa hành động đó, trừ khi được phê duyệt riêng.
- Khách hàng không được xem mã nguồn, nội dung file, absolute path, secrets, thông tin database kết nối.

## Filesystem

1. Root xác định từ server configuration, không chấp nhận user-supplied path.
2. Kiểm tra `lstat` từng segment/entry trước khi đọc, chống symlink, junction, reparse point thoát root; nếu không bảo đảm được tại Windows thì **fail closed**.
3. Chỉ chấp nhận tên folder K01 trong đường dẫn con trực tiếp; folder sai tên vẫn có issue, không được dùng tên để join path không an toàn.
4. Không theo đường dẫn `../`, absolute path, UNC không rõ chủ, `file:` scheme.
5. Reject symlinks được khai báo trong folder, kể cả junction; không đi qua chúng.
6. Không duyệt `.git`, `node_modules`, `dist`, `build`, generated, `coverage`, `.env*`, secrets/keys. Tuy nhiên, nếu package chứa file nhạy cảm ngoài vị trí loại trừ thì đánh WARN/FAIL phù hợp, không silently PASS mà không kiểm tra rủi ro.
7. Không dùng `import`, `require`, dynamic import, `eval`, `Function`, `vm`, `spawn`, `exec`, `tsx` để nạp candidate. Không chấp nhận hooks/scripts từ manifest.
8. Giới hạn: 250 folders/request, 1500 file/package, 25MiB/package, 10 snapshots RAM, TTL 10 phút; nêu rõ khi vượt giới hạn.
9. Hash nội dung package phải deterministic; race file changed => issue, không đủ điều kiện Preflight.
10. Giữ log tối thiểu (`scanId`, `requestId`, counts, codes, duration), không log file content hoặc credentials.

## Data boundaries

- Không thay đổi B01–B14, IAM tables, B09 Navigation, các version, registry, grants, menu, ACTIVE/ENABLED.
- Không migration, CREATE/ALTER/DROP, GRANT, SET ROLE hay thay đổi SQL functions.
- Không kết nối DEV, PROD. Nếu database là TEST mới cần verification smoke; unit tests có thể dùng mock.
- Không force-restart Backend từ Scan API.
- Không tạo endpoints cho phép browser điều khiển đường dẫn hoặc command.

## Error/fail-closed

- Session invalid: HTTP 401 từ luồng Auth hiện tại.
- IAM missing: 403 và DENIED audit hiện hữu.
- IAM evaluation failure: 503, không giả được cấp quyền.
- Registry unavailable: 503 toàn scan hoặc UNAVAILABLE có đánh dấu đầy đủ; không kết luận NEW_MODULE.
- Root unavailable: 503.
- Hash không ổn định, MIC parse lỗi, symlink không xác minh được: không chuyển sang Preflight.
- Giữ thông báo khách hàng rõ lỗi nhưng không lộ stack trace.

## Proof

Acceptance phải có cả test rằng không có write SQL được phát ra từ authorized scan (spy/mocks), đối chiếu trước/sau B01–B14 trên TEST read-only khi có môi trường, và không có thay đổi danh sách installed-modules do thao tác scan.
