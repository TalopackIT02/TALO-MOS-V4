# 02 — NON-NEGOTIABLE GUARDS (MUST READ)

## G0 — Phạm vi

- Chỉ sửa Foundation/UI/Installer/Host contract tests cần thiết để thực hiện REV-A/B/C. Không phát triển module nghiệp vụ mới, không sửa `SYSTEM_TEST` hay `DATA_INSPECTOR` chỉ để test qua.
- `CLAUDE.md` local có ưu tiên cao hơn hồ sơ này. Nó cấm tự đổi business logic, DB schema/migrations/Prisma/data, dependency, IAM, grants, push/merge/deploy.
- Chỉ TEST `talo_mos_v4_test`; không DEV/production. Truy vấn metadata read-only trước; không thao tác data thật ngoài thay đổi được phê duyệt và có backup.
- Bảo toàn B01–B14, B07/B08, IAM logs, B09 Navigation, Module Host Protocol. Không `TRUNCATE`, `DELETE CASCADE`, disable FK hoặc thay DB role.

## G1 — Runtime và version

- `SYSTEM_TEST 1.1.1` và `DATA_INSPECTOR 0.1.0` ACTIVE ở baseline user gửi; **xác minh trạng thái hiện tại**, không assume.
- Không sửa/gỡ retired/active release; không update trực tiếp B02 trạng thái hay MIC của version đã khóa.
- `modules/` là candidate drop zone. Sync Host chỉ từ immutable release đã được lock. Không để scan/import code chưa được duyệt chạy trong server.
- Không tự kích hoạt `SYSTEM_TEST 1.2.0` trong đợt chỉnh Foundation; chỉ test bằng candidate/fixture an toàn. Test cutover chỉ thực hiện với fixture cô lập hoặc bản nâng cấp đã có phê duyệt riêng.
- Upgrade ACTIVE bị chặn cho tới khi có recovery đã test. **Không biến 409 thành SUCCESS hoặc bypass gate.**

## G2 — IAM và MIC

- MIC nguồn là `Candidate snapshot/mic/module.mic.json`. MIC10 PASS chỉ từ evidence server đã kiểm tra reportHash/runId/packageHash/environment.
- Không dùng `micTemplate()` để phát hành module; không copy/paste MIC từ AI như luồng chính.
- Không tự gán quyền Admin/Root hoặc mọi người dùng; dùng IAM policy và owner approval. Quyền UI không thay quyền API.
- Không tự GRANT PostgreSQL. Nếu DB grant thiếu, hiển thị blocker + bằng chứng, đợi phê duyệt.
- Không thay `MIC-1.0`, Host Protocol, K05 permission mapping hoặc Foundation validator để “cho qua”.

## G3 — Navigation & UI

- Giữ AppShell, topbar/sidebar/breadcrumb và UI 4 block đã yêu cầu; sidebar chỉ dùng điều hướng, không nhét form/diagnostics vào global sidebar.
- Navigation duy nhất là B09; không tạo menu hardcoded cho module đã cài. Developer Function chỉ dưới Develop; anchor bất biến.
- Không xóa hoặc di chuyển âm thầm menu người dùng đang dùng; giữ transaction/revision check của Builder.
- Drawer: xem/sửa một entity, error log; popup: xác nhận nguy hiểm; workspace riêng: nhiều bước kéo dài.

## G4 — Tests và dấu vết

- Không chỉnh sửa assertion để làm test xanh giả, không thay `NOT_TESTED` thành `PASS` nếu không chạy.
- Một test PASS phải có command, exit/status, scope, environment, hash khi cần. `skipped` và kiểm tra 401 không tương đương runtime authenticated PASS.
- Chụp baseline và so sánh; nếu test gây dữ liệu FBET, dùng fixture isolation/teardown có kiểm tra leftovers.
- Mọi artifact/release mới phải từ đúng candidate hash. Khi source thay đổi, invalidate run/plan tương ứng.
- Không log password, token, cookie, connection string, row data; chỉ error code, safe metadata, hash, correlation id.

## G5 — Change control

- Có thể code, refactor nhỏ và chạy test **trong scope đã chốt**. Không cần hỏi từng pha.
- Khi cần schema/migration/GRANT/IAM policy/alter lifecycle irreversible/real cutover: **dừng riêng bước đó**, nêu exact blocker, làm tiếp phần độc lập và kết luận PARTIAL/BLOCKED.
- Không push, merge, deploy production hoặc đổi protected files ngoài scope. Commit local chỉ nếu working tree an toàn và các gates tương ứng PASS.
- Không báo DONE nếu thiếu một acceptance bắt buộc. Giữ những gì đang chạy an toàn quan trọng hơn một nhãn PASS.
