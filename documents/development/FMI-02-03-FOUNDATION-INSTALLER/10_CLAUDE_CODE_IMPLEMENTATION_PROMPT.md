# PROMPT — XÂY FOUNDATION INSTALLER MỘT LẦN; KHÔNG DÙNG CLAUDE ĐỂ ADD MODULE

Bạn là kỹ sư triển khai trên **repository local** `D:\Documents\ClaudeProject\TALO-MOS-V4`.

## MỆNH LỆNH

Triển khai Foundation Installer theo toàn bộ hồ sơ trong `documents/development/FMI-02-03-FOUNDATION-INSTALLER/` theo một lượt liên tục: đọc, thiết kế delta dựa trên mã thật, thực hiện code, chạy test, sửa lỗi, nghiệm thu và báo cáo. **Không dừng hỏi sau từng pha khi các pha có thể thực hiện an toàn**. Mục tiêu là tạo trải nghiệm người dùng về sau: thêm package vào folder → Quét Module → Kiểm tra & Chạy thử → READY → Cài đặt & Kích hoạt bằng Foundation UI. **Claude chỉ viết Installer một lần, không trực tiếp thêm module SYSTEM_TEST 1.2.0 bằng tay.**

## PHẠM VI

A. Khắc phục xung đột FBET giữ route `/system-test` và `/system-test/runner` trên TEST, chứng minh provenance và ngăn fixture tái phát. Mọi cleanup dữ liệu nguy hiểm yêu cầu backup, ID manifest, audit và sự cho phép; không tự xoá hàng loạt.

B. Bảo vệ runtime khỏi `modules:sync` hiện nay tự quét tất cả folder: tạo đường nạp artifact đã duyệt, migrate chính xác các release đang chạy, không auto đưa candidate vào Host trước READY và publish. Bảo toàn SYSTEM_TEST 1.1.1 ACTIVE và DATA_INSPECTOR 0.1.0 ACTIVE.

C. FMI-02 Preflight: candidate workspace trước B02, snapshot/hash, MIC Schema/compatibility, build/typecheck, contract/API/IAM/DB/runtime/regression trong staging có kiểm soát, evidence tự động có reference, tải JSON/TXT, stale hash tự invalidate.

D. FMI-03 Installer: prepare/dry-run với blockers, release lock, immutable artifact, lifecycle B01/B02/MIC, IAM catalog+assignment theo chính sách, B09 idempotent, deploy/restart có supervisor, runtime postcheck, report. **Không thay đổi B02 APPROVED/ACTIVE, không coi việc viết MIC10 PASS là test thật.**

## TÀI LIỆU RÀNG BUỘC

Đọc toàn bộ `00_README.md` đến `09_RUNBOOK.md` trong cùng thư mục trước khi triển khai. Các tài liệu là implementation spec; đối chiếu với source local, nếu thấy khác thì lập delta; không ghi đè code mới bằng remote GitHub cũ.

## NHỮNG ĐIỂM PHẢI NHẬN BIẾT

1. FMI01 Quét Module đã chạy trong UI hiện tại, không xây lại scanner nếu không cần.
2. Chỉ quét folder khi người dùng bấm nút — không watchers/auto scan.
3. `modules:sync` predev/prebuild có thể mount candidate chưa duyệt; **giải quyết trước khi install**.
4. `createPermission` trong IAM hiện yêu cầu version ACTIVE, gây phụ thuộc với preflight và postcheck; tách fixture/staging tests và IAM provision sau ACTIVE theo policy.
5. Lifecycle đang RETIRE ACTIVE cũ khi activate; không có public rollback RETIRED→ACTIVE. **Không thực hiện upgrade cutover nếu chưa có recovery/rollback được thử nghiệm.** Nếu cần thay đổi lifecycle/schema có rủi ro ngoài quyền phê duyệt, dừng đúng Gate, báo BLOCKED và hoàn tất phần an toàn còn lại.
6. Version SYSTEM_TEST 1.2.0 trên TEST là DRAFT theo ảnh; không duplicate record. Giữ legacy DATA_INSPECTOR cho đến khi xác nhận gộp hoàn chỉnh.
7. Đừng bỏ qua fixture đang chiếm route bằng cách chỉ ẩn nó ở UI; phải chứng minh route thật không còn bị chiếm. Không retire/delete khi chưa đủ ownership/authorization.
8. Chỉ DB `talo_mos_v4_test`; không tự SQL GRANT, FK disable, TRUNCATE, data erase hoặc production deploy.

## YÊU CẦU CODE

- Backend APIs typed, Foundation session/CSRF/IAM guard, exact error envelope, bounded worker, no client-chosen command/path, storage atomic, concurrency controls.
- Frontend thêm vào `frontend/src/pages/foundation/ModuleScreen.tsx` và api client hiện có; không tạo route admin lạ, giữ AppShell và quyền hiệu lực.
- Tests phải cover matrix `08_TEST_ACCEPTANCE.md` và regression module ACTIVE.
- Report TXT/JSON đủ kết quả scan/preflight, thời điểm, hash, mỗi phép check, lỗi và limitations, không lộ secrets.
- Docs triển khai thật: API contract, operator runbook, diagrams nếu hữu ích, test evidence, git diff, known risks.
- Ưu tiên mã nhỏ gọn, không mở rộng thành workflow engine đa năng, không viết lại IAM/Navigation/UI.

## QUY TRÌNH MỘT LƯỢT

0. Thu baseline Git local, code, DB target và các package. Ghi nguồn baseline tránh mất thay đổi chưa commit.
1. Route-holder inventory + fixture isolation; cleanup có ID manifest và gate.
2. Installed release guard; chứng minh không nạp candidate khi chạy npm scripts.
3. FMI02 Backend/Frontend, contract tests, isolated execution, evidence.
4. FMI03 prepare + installer state machine; chỉ commit/cutover khi required gates PASS và rollback/restart thực sự hoạt động.
5. Chạy unit/API/integration/security tests, typecheck, builds, kiểm tra B01/B02/B09/B07/B08/IAM và runtime.
6. Viết full report và hướng dẫn người sử dụng. Không tự push/merge/deploy PRODUCTION; không tự activate SYSTEM_TEST 1.2.0 trừ khi có approval riêng cho thao tác install cụ thể trên TEST.

## XỬ LÝ BLOCKER

Không hỏi lặp lại dữ liệu đã biết. Nếu gặp blocker không thể giải quyết trong các rào được cho phép, thực hiện tiếp các phần không phụ thuộc; đánh dấu rõ PARTIAL/BLOCKED, không tạo PASS giả. Thiếu supervisor/rollback/DB quyền là blocker thật. Không bỏ qua một guard để đạt kết quả.

## OUTPUT BẮT BUỘC

Báo cáo bằng tiếng Việt:
- Kết luận cho route cleanup, runtime isolation, FMI02, FMI03: DONE/PARTIAL/BLOCKED.
- Exact baseline branch/HEAD/local dirty files.
- Danh sách file thay đổi và chức năng thực sự dùng được.
- Route owners và fixture count trước/sau, thao tác database đã thực hiện (nếu có), backup hash.
- API contracts, permission checks, test run counts, report references.
- Ứng dụng đã chạy được ở TEST chưa, backend/frontend release/hash có khớp không.
- Có/không thể **thêm module hoàn toàn bằng UI Foundation**; nếu không, nêu blocker còn lại, không che giấu.
- Không push/merge/production deploy và không tuyên bố DONE chỉ vì typecheck/build.

**BẮT ĐẦU TRIỂN KHAI TRÊN MÃ NGUỒN LOCAL.**
