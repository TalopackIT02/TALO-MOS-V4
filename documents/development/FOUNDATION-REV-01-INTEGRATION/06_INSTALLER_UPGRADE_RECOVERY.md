# 06 — FMI-03: UPGRADE, RELEASE CUTOVER & RECOVERY

## Lỗ hổng source được xác nhận

`foundation.installer.service.ts::blockersFor()` đang chặn nâng cấp mọi module: `UPGRADE_RECOVERY_UNAVAILABLE` khi có B02 ACTIVE, `UPGRADE_NOT_SUPPORTED` khi đã có B01 nhưng không ACTIVE. `continueInstall()` cũng yêu cầu `classification === NEW_MODULE`. Do vậy SYSTEM_TEST 1.2.0 READY **chưa thể cài qua Foundation**.

## Đích thiết kế

Cho phép *chuẩn bị và kiểm thử* nâng cấp module B01 cũ ở mọi trường hợp hợp lệ. Mở cutover có ACTIVE cũ **chỉ khi** có giải pháp recovery đã được phê duyệt và kiểm chứng, không bypass lifecycle. Một lượt commit không được khiến 1.1.1 mất khả năng phục vụ chỉ để chứng minh 1.2.0 cài được.

### Ma trận khả năng

| Module B01 | B02 cùng version | B02 ACTIVE khác | Kết quả |
|---|---|---|---|
| Chưa có | Chưa | Không | NEW: quy trình cài mới |
| Có | DRAFT | Không | UPGRADE vào DRAFT (validate, compare-and-swap) |
| Có | DRAFT | Có | Cho candidate/preflight/plan; cutover BLOCKED nếu chưa có recovery test |
| Có | APPROVED/ACTIVE/RETIRED/REJECTED | Bất kỳ | VERSION_LOCKED; không ghi đè |
| Có | Chưa có | Có | Tạo DRAFT sau plan; cutover yêu cầu recovery |
| Có | Chưa có | Không | Được triển khai nếu lifecycle/compatibility PASS và không còn blocker |

Phân loại `EXISTING_VERSION` của Scanner không được tự hiểu là cùng nội dung package đã đăng ký: so MIC hash/package hash đúng năng lực lưu trữ.

## Recovery là Gate độc lập

`activation()` hiện retire ACTIVE cũ trong một transaction B02; không có API hợp lệ đưa RETIRED trở lại ACTIVE. Rollback bằng copy code cũ hoặc sửa B02 SQL là sai.

Các phương án cần lập luận/đề xuất (không tự chọn nếu đòi sửa lifecycle hoặc schema):
- **A: Two-phase runtime cutover + reversible activation design** đã được owner phê duyệt và có unit/integration tests, audit bảo toàn.
- **B: Đường recovery qua lifecycle service mới** có state rules rõ, session/IAM/audit, backup/postcheck, test trước khi áp dụng thực tế; cần duyệt thay đổi logic nghiệp vụ.
- **C: Giữ chặn với nâng cấp ACTIVE** và hoàn tất các thành phần khác của REV-01 (PARTIAL, không giả DONE).

Khi chưa có A/B được kiểm chứng, C là hành vi mặc định bắt buộc. Hồ sơ này **không phê duyệt ngầm** thay đổi lifecycle.

## Pre-commit invariants

1. Verify current_database TEST và cấp quyền actor.
2. Candidate READY, source/snapshot sha256 trùng và report hash intact.
3. DRAFT/B01 state, original active version, runtime lock (backend/frontend), B09 revision, IAM policy và DB grants được snapshot.
4. Route conflicts (ACTIVE ENABLED; ACTIVE DISABLED khi enable lại), dependency, compatibility và new API contracts đã được test.
5. Không có install khác đang xử lý cùng Module Key; persist journal với idempotency.
6. Xác nhận recovery checklist và cách khôi phục không yêu cầu SQL độc đoán.
7. Prepare plan chỉ READ/không ghi; commit re-evaluate blockers ngay trước first write.

## Commit steps và thứ tự

Các bước cần đưa trong journal: VERIFY → RELEASE → REGISTER B01 (nếu mới) → B02 DRAFT → MIC from Candidate/evidence → SUBMIT → APPROVE → DEPLOYMENT LOCK → RESTART/SUPERVISOR → runtime hash verify → ACTIVATE → ENABLE → IAM CATALOG → B09 NAVIGATION → AUTHENTICATED/NEGATIVE POSTCHECK → `INSTALLED_ACTIVE`.

**Cảnh báo:** Chuỗi trên là luồng hiện hành cho NEW_MODULE; với ACTIVE UPGRADE, thứ tự/thời điểm ACTIVATE và phục hồi phải được chứng minh trong thiết kế recovery được phê duyệt. Không sao chép chuỗi NEW vào UPGRADE và hy vọng thành công.

## Restart / supervisor

- Source hiện trả `supervisor: NONE`; nếu không có host deploy control đã được chuẩn hóa, trạng thái `AWAITING_RESTART`, kèm chỉ dẫn cụ thể và nút Continue sau khi runtime hashes khớp.
- Không tự bổ sung `child_process` chạy lệnh hệ điều hành nhận từ Browser. Nếu nối với Windows Dev Control Center, phải có fixed allowlisted operation, authentication/role, process ownership, lock, audit và test; nếu thiếu thì **giữ manual restart**.

## Failure / recovery journal

- Lỗi trước B01/B02: `FAILED_SAFE`, không làm thay đổi runtime lock/ACTIVE.
- Lỗi sau B02 trước cutover: giữ version đúng trạng thái, log và phục hồi theo service; không tự xóa audit.
- Lỗi sau ACTIVE ở NEW_MODULE: disable có audit, `RECOVERY_REQUIRED`, idempotent Continue; không gọi INSTALLED_ACTIVE.
- Lỗi sau ACTIVE trong UPGRADE: xử lý theo recovery đã phê duyệt, không chỉ disable module vì sẽ làm mất bản đang sử dụng.
- Reopen workspace sau restart phải đọc journal persisted, không dựa vào local React state.
- Đừng in connection string, token, body hàng dữ liệu vào journal.

## Nghiệm thu upgrade

1. Test thuần máy trạng thái + race + lost connection.
2. DB isolated fixtures (TEST only, backup) chứng minh ACTIVE cũ giữ nguyên khi before-cutover blocked; B07/B08 đúng.
3. Test recovery A/B nếu được phê duyệt với trước/sau state, runtime hash, IAM and navigation, rollback failure injection.
4. Khả năng nâng cấp `SYSTEM_TEST 1.1.1→1.2.0` chỉ nghiệm thu sau khi có recovery thật và owner bật execution; **không tự kích hoạt trong task Foundation revision**.
