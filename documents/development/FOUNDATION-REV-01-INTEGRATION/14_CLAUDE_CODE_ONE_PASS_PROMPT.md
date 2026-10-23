# CLAUDE CODE — EXECUTION PROMPT (DÁN NGUYÊN VĂN)

Bạn là kỹ sư thực thi duy nhất cho TALO-MOS-V4 tại `D:\Documents\ClaudeProject\TALO-MOS-V4`. Đây là yêu cầu **triển khai mã nguồn và test trong một lượt**, không phải chỉ lập kế hoạch, không phải add module SYSTEM_TEST bằng Claude thủ công.

**Mục tiêu:** hoàn thiện Foundation Integration REV-01 đã chốt: đồng nhất Quét Module → Candidate → Preflight → MIC → Installer → IAM/B09 → runtime postcheck; hỗ trợ chuẩn bị nâng cấp module đã đăng ký an toàn; chuẩn hóa UI hai màn hình `Quản lý Module` và `Candidate Workspace`, Navigation Builder giữ màn hình riêng; thao tác ngắn dùng drawer bên phải, thao tác nguy hiểm dùng popup. Không phát triển module nghiệp vụ mới.

## Cách đọc tài liệu để tiết kiệm token

1. Đọc `CLAUDE.md` (local), `documents/development/FOUNDATION-REV-01-INTEGRATION/00_START_HERE.md` và `02_NON_NEGOTIABLE_GUARDS.md`.
2. Dùng `01_SOURCE_BASELINE.md` + `12_FILE_MAP_AND_IMPLEMENTATION.md` để tra đúng file; **local là nguồn ưu tiên**, GitHub commit `b7b5f071` chỉ làm reference. Không dump toàn repo, không nhắc lại nguyên tài liệu vào chat.
3. Triển khai lần lượt theo `13_ONE_PASS_RUNBOOK.md`; mỗi pha chỉ đọc đúng nhóm spec trong `00_START_HERE.md`. Dùng `rg` và đọc các đoạn liên quan. **Không hỏi lại những gì hồ sơ đã chốt.**
4. Ghi kết quả ngắn vào `documents/development/FOUNDATION-REV-01-INTEGRATION/implementation-evidence/`, chỉ tóm tắt cuối cho người dùng. Không tạo trùng checklist hoặc tài liệu thừa.

## Các lỗi P0 cần sửa thật

- `VersionPanel.micTemplate()` tạo `MAIN.READ`/`INITIAL_REGISTRATION` cho DRAFT, trong khi Candidate có MIC thật: sửa luồng để MIC package là nguồn chuẩn, B02 DRAFT reuse với diff + expected hash + fresh readback; người dùng không dán MIC.
- `foundation.installer.service.ts` chặn **mọi UPGRADE** trong `blockersFor()` và `continueInstall()`: cho phép staging/preflight/plan với B01 cũ, xử lý DRAFT phù hợp; ACTIVE cutover **không được vượt chặn nếu recovery chưa được phê duyệt và test**.
- Installer tạo B09 nhóm gốc→Function, khác Navigation Builder AREA→MENU→FUNCTION; thống nhất planner/validation, xử lý hidden link idempotency, preserve Develop.
- P6/postcheck mới chứng minh 401: bổ sung contract test/response schema và authenticated IAM allow/deny phù hợp; `NOT_TESTED` và `N/A` phải được ghi đúng, không giả runtime PASS.
- Installer tạo IAM catalog không đồng nghĩa đã gán quyền/đăng nhập truy cập được: phân biệt các gate và đưa blocker/next action rõ.

## UI phải giao được

- `/foundation/modules` chỉ là bảng quản lý + nút Quét/summary, chọn row → drawer.
- Workspace có route hợp lệ `/foundation/modules/candidates/:candidateId`, stepper Scan/Preflight/Plan/Install, MIC diff, report TXT, journal/restart/resume; chi tiết checks và lỗi mở drawer; confirm dangerous changes bằng modal.
- Navigation Builder là màn hình riêng: giữ drag/drop, revision, unsaved guards; cây trên màn chính, form editor và kho chức năng ở drawer, preview popup. Giữ AppShell 4 block/theme/tabs, quyền IAM Backend/Frontend.

## Rào không được vượt

- Chỉ `talo_mos_v4_test`; không DEV/production. Không tự sửa DB schema/migration/Prisma, raw SQL grants, B07/B08 history, IAM evaluator/root/notSelf, MIC-1.0/Host Protocol, current ACTIVE modules/release hashes, business logic ngoài scope.
- Không `reset/checkout` ghi đè thay đổi chưa commit, không tự cài dependency, không xóa FBET/B09 dựa vào tên, không push/merge/deploy.
- Không tự INSTALL/ACTIVATE SYSTEM_TEST 1.2.0. Ngăn fixture chiếm route thật; cleanup lịch sử chỉ khi có chứng cứ ID + backup + quyền.
- Nếu một sửa đổi đòi phê duyệt lifecycle/DB/GRANT hoặc recovery chưa test: **không làm đường tắt**; ghi blocker cụ thể, tiếp tục mọi phần có thể hoàn tất. Không lấy PARTIAL làm DONE.

## Quy trình một lượt

(1) chụp baseline Git/DB TEST/ACTIVE/lock/B09; (2) viết tests tái hiện bug; (3) triển khai REV-A backend; (4) triển khai REV-B UI; (5) REV-C contract/security/fixture/regression; (6) chạy typecheck/build/unit/integration/e2e an toàn, sửa lỗi trong scope và test lại; (7) cập nhật implementation-evidence và báo cáo DONE/PARTIAL/BLOCKED theo `11_ACCEPTANCE_MATRIX.md`.

Không dừng để hỏi tiến hành phase tiếp theo; chỉ chặn đúng protected operation cần owner quyết định, giải thích rõ một lần khi kết thúc. Tests chưa chạy phải ghi NOT_TESTED, không bịa PASS. Đảm bảo SYSTEM_TEST 1.1.1 và DATA_INSPECTOR 0.1.0 ACTIVE vẫn hoạt động cho tới khi có upgrade được phê duyệt.

**Output cuối:** trạng thái; files changed; API/UI flows; G0/A/B/C gate PASS/FAIL/NOT_TESTED; exact test commands + counts; protected before/after; blockers và phương án; local commit nếu an toàn; không push/deploy. Mục tiêu là **Foundation dùng được để thêm module qua chính giao diện**, không cần Claude add từng module.
