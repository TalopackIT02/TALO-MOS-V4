# 02 — Xử lý fixture FBET và xung đột route

## Hiện tượng quan sát

Ảnh chụp 23/10/2026: Module Scan báo `MODULE_ROUTE_CONFLICT` cho `/system-test` và `/system-test/runner`, cùng một module `FBET_ST_...` đang ACTIVE. Mục quản trị ẩn khoảng 1.914 `FBET_*`. Đây là **dấu hiệu fixture gây xung đột**, chưa đủ căn cứ xoá mọi record FBET.

## Bước A: chỉ đọc và chứng minh ownership

- Kết nối `talo_mos_v4_test` bằng read-only session; query B01/B02/B03..B06/B09, MIC04 các version ACTIVE và permission IAM liên quan.
- Xác định mọi holder đang claim `/system-test` và `/system-test/runner`; liệt kê moduleId, versionId, moduleKey, status, enabled, package hash nếu có, path, menuId, parent, references.
- Đọc fixture sources/teardown scripts và B07/B08/correlation để chứng minh module được tạo bởi regression suite.
- Xác minh không có dữ liệu nghiệp vụ liên quan và không trùng key của SYSTEM_TEST thật.
- Xuất `fixture-inventory.json` (an toàn, không chứa bí mật) và `route-owners-before.json`; kèm số liệu đếm từ DB.
- Nếu không có bằng chứng, chuyển `NEEDS_OWNER_REVIEW`, **không RETIRE/DELETE/DISABLE**.

## Bước B: remediate theo mức ít xâm lấn

1. Tách test fixture runtime khỏi route không gian thật. Tất cả future fixture **bắt buộc namespace riêng** (ví dụ `/__fixture/<run-id>/...` nếu Host route validator cho phép, nếu không dùng namespace hợp lệ `/fbet-<id>`), không reserve `/system-test` hoặc module nghiệp vụ.
2. Sửa test suite để tạo fixture trong isolated staging, và cleanup có ownership proof; không bỏ assertions, không sửa route runtime thật cho test PASS.
3. Đối với phiên bản fixture ACTIVE gây route conflict: qua lifecycle hợp lệ sau khi xác minh. `DISABLE` chỉ có ý nghĩa nếu scanner/runtime xác định route không còn chiếm chỗ; **không giả PASS bằng cách chỉ bỏ qua is_enabled** khi code Host vẫn mount route. Nếu buộc `RETIRE` irreversible, cần backup đầy đủ, owner approval cho danh sách ID, xác nhận không ảnh hưởng AppShell, và ghi rõ không có đường reactivation public.
4. Không dùng `DELETE FROM foundation... WHERE module_key LIKE 'FBET_%'`, không TRUNCATE CASCADE; giữ lịch sử B07/B08. Các fixture dư không phá runtime có thể ẩn mặc định ở UI. Hide không thay cho xử lý route holder.
5. Quét lại: 0 route owner không hợp lệ; SYSTEM_TEST giữ route của nó; đọc lại bằng kết nối khác để xác thực.

## Bước C: ngăn tái phát

- Before test: snapshot route ownership và B09 counts. After test: đối chiếu, teardown fixtures sở hữu hoặc quarantine; không để fixture ACTIVE chiếm route sản phẩm.
- Fixture phải có unique run marker/correlation ID & source metadata, và nếu cần test ACTIVATE, sử dụng route fixture riêng.
- Regression cho 2 tình huống: (1) fixture chiếm route thật bị flag; (2) fixture có namespace riêng không ảnh hưởng module thật.
- Test cleanup không xoá dữ liệu append-only/audit trái quy tắc; chỉ quản lý presentation mặc định nếu không được xóa.

## Gate độc lập

`CLEANUP_READY`: đã nhận diện và có cleanup plan.
`ROUTE_CONFLICT_RESOLVED`: quét lại bằng data thật và không còn takeover.
`TEST_ISOLATION_PASS`: chạy suite hai lần không tạo xung đột route thật.
Nếu 1 trong 3 gate không PASS thì chưa làm cutover SYSTEM_TEST 1.2.0.
