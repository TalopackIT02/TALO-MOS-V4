# 04 — FMI-03: Installer & Activation Orchestrator

## Trải nghiệm đích

Sau khi candidate ở `READY`, quản trị viên nhấn **Cài đặt & Kích hoạt**, Foundation tự thực hiện những thao tác kỹ thuật đã được phép: verify hash → staging artifact → build → deploy bằng cơ chế an toàn → publish B01/B02 & MIC (nếu hợp lệ) → lifecycle activation → IAM catalog → B09 → runtime postcheck. Không yêu cầu người dùng dán MIC, chạy npm hoặc viết SQL.

## BẮT BUỘC triển khai hai pha

**Pha Prepare — chưa làm thay đổi bản LIVE**
1. Acquire install lock per module; verify permission và môi trường TEST.
2. Re-read candidate READY và rehash snapshot; re-verify MIC10 evidence matches hash and target.
3. Build deterministic release backend + frontend tại immutable staging directory; verify manifest/contract/route/Host.
4. Check exact previous ACTIVE module/version/runtime hashes, IAM access facts, navigation, compatibility, DB constraints and required grants.
5. Prepare audit/backup, deployment/restart supervisor capabilities và cutover plan. Abort sạch nếu thiếu bất cứ điều kiện.
6. Run staging runtime smoke với credential/test DB an toàn.
7. Nếu upgrade có ACTIVE version, **không cutover trừ khi có recovery plan tested** (vì current lifecycle không hỗ trợ RETIRED→ACTIVE).

**Pha Commit/Cutover — chỉ sau tất cả gate PASS**
1. Snapshot immutable current deployed artifacts & signed install ledger. Installed packages chỉ lấy từ danh sách release đã được phép, không đọc trực tiếp candidate `modules/`.
2. Đăng ký B01 khi là NEW_MODULE hoặc đối chiếu B01 có sẵn; tạo B02 DRAFT khi chưa có, PUT MIC đã có evidence, SUBMIT, APPROVE thông qua lifecycle API/service chuẩn với audit.
3. Thực hiện deploy/restart có kiểm soát và version-aligned prechecks. Không tự dùng `process.exit` để thay thế supervisor. Nếu không có supervisor được quản lý, trả `DEPLOY_RESTART_REQUIRED`, **không đánh dấu hoàn tất**.
4. ACTIVATE bằng service chuẩn chỉ khi thực sự deploy/runtime target khớp và có recovery nếu failed upgrade. Sau khi ACTIVE mới tạo IAM permission theo MIC07 (API hiện tại yêu cầu ACTIVE), gán theo policy được phê duyệt; không tự cấp cho tất cả người dùng.
5. Cấu hình B09 theo MIC04, idempotent, không tạo duplicate; kiểm chứng trong menu hiệu lực và per-user access.
6. Sau deploy: handshake, session, IAM, API responses, routes, UI, DB access; quan sát code/backend/frontend phiên bản thực sự đang chạy.
7. Chỉ `INSTALLED_ACTIVE` nếu **B02 ACTIVE + runtime expected hash/version + IAM required ready + B09 ready + postcheck PASS**. Nếu postcheck thiếu bằng chứng, `RECOVERY_REQUIRED` hoặc `PARTIAL_INSTALL` với hướng recovery; không công bố thành công.

## Vấn đề rollback phải được giải quyết thật

Mã hiện tại tự RETIRE ACTIVE cũ khi activate version mới, và không có route RETIRED→ACTIVE. **Không có rollback chỉ bằng việc copy folder**. Người triển khai phải lựa chọn và test một kế hoạch rollback tương thích lifecycle/IAM/audit đã được duyệt; nếu cần bổ sung chức năng recovery có kiểm soát thì báo phạm vi schema/lifecycle để chủ dự án duyệt trước khi sửa. Không disable fail-open. Trước khi recovery thật được chứng minh: chặn one-click cutover cho upgrade ACTIVE.

## Quản lý generated registry / mã nạp

- Không để npm `predev`/`prebuild` quét mọi folder candidate. Phải có một installed release lock/ledger xác định chính xác package nào được phép build/mount.
- Migration một lần phải snapshot module đã active thực tế; không auto bless folder nguồn mới nhất vào allowlist.
- Không sử dụng allowlist trống gây mất module đang hoạt động.
- Installed release store immutable và riêng với folder candidate. Sync từ store được duyệt, không từ `modules/*` trôi nổi.
- Generated registries/copies được thay nguyên tử; kiểm tra compiler + Host handshake trước cutover.
- Giữ đầy đủ source/binary release cũ để phục vụ recovery, không overwrite tại chỗ.

## Cài đặt cùng module key

- SYSTEM_TEST 1.2.0: nâng cấp Module Key `SYSTEM_TEST`, dùng B01 hiện có; `DATA_INSPECTOR` 0.1.0 vẫn ACTIVE cho đến khi xác minh chức năng gộp trên 1.2.0. Không xóa DATA_INSPECTOR, không gỡ permission/log/menu ngay khi candidate READY.
- Version B02 1.2.0 đang DRAFT theo ảnh; không tạo bản duplicate; không sửa version đã APPROVED/ACTIVE.
- Nếu 1.2.0 không đủ compatibility/runtime/IAM, installer dừng an toàn và giữ 1.1.1 ACTIVE.

## Install state

`READY`, `PREPARING`, `STAGED`, `PUBLISHING`, `AWAITING_RESTART`, `CUTTING_OVER`, `POSTCHECK`, `INSTALLED_ACTIVE`, `RECOVERY_REQUIRED`, `FAILED_SAFE`. Đây là installer transaction states, không thay đổi enum B02 nếu không cần.
