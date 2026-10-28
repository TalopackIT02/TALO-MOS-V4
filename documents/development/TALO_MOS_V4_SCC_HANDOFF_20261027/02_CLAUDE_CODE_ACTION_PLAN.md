# CLAUDE CODE — ACTION PLAN ĐỂ HOÀN THÀNH SCC TRÊN TEST

**Mục tiêu cuối:** SCC 0.1.1 hoạt động thật trên `talo_mos_v4_test`, sáu màn hình nghiệm thu đầy đủ; không phá kiến trúc Foundation/IAM, không cấp DB quyền rộng cho `talo_app`.

## 0. Điều kiện nhận việc

**Repo local do handoff báo cáo:** `D:\Documents\ClaudeProject\TALO-MOS-V4`  
**Branch:** `feat/iam-admin-inheritance-20261024`  
**HEAD:** `0e491a3fac77801488739f3cd95f99845bbcd69e`  
**Dirty working tree:** phải bảo toàn tracked/untracked.  
**Gate:** `DB-APPROVAL REQUIRED`.

Claude Code được tự chủ toàn bộ phân tích, sửa source, test và lập báo cáo. Nhưng mọi bước ghi vào TEST, journal/lifecycle, triển khai và Git cần phê duyệt cụ thể; không hỏi chủ dự án từng thay đổi code nhỏ.

## WORK PACKAGE 1 — Nhận bàn giao, đối chiếu repository

**Được thực hiện ngay, không cần DB approval.**

- Đọc handoff gốc + Phase 2 package + bộ tổng hợp này.
- Kiểm tra Git branch, HEAD, tracked diff, untracked, bất kỳ code change nào mới sau handoff; snapshot an toàn (không reset).
- Kiểm tra `SCC_0.1.1_RELEASE.zip` SHA-256 `db96d4b1aaec6c93336dada304cb240b78d6f1306c410045544f93b84e993d3d` và Foundation package hash `576eed9a74566b99e805200af06fbc8f4ee158b510baa488b9224cf2357a2eb2`.
- Xác minh immutable SCC 0.1.0 không bị thay.
- Đối chiếu danh sách file thay đổi trong `CHANGED_FILES.txt` và `01_CURRENT_WORKTREE_AND_ARTIFACTS.md`.
- Nếu source lệch gói, xác định delta và chỉ test lại phạm vi có tác động.

**Kết quả:** `RECEPTION_BASELINE.md` ghi branch/HEAD, changed/untracked, hash, source version, blockers. **DỪNG** nếu working tree không đúng baseline hoặc thiếu file quan trọng; không overwrite.

## WORK PACKAGE 2 — Database Gate: chuẩn bị phê duyệt, sau đó thi hành có điều kiện

**2A — Được làm ngay:** review và đối chiếu DB read-only.

- Kiểm tra quyền/đối tượng hiện tại trên TEST read-only; xác minh audit_api chưa tồn tại, role liên quan, quyền `talo_app`, bảng nguồn/cột/chữ ký function.
- Review `DATABASE_MIGRATION.sql`, `DATABASE_APP_VERIFICATION.sql`, `DATABASE_ROLLBACK.sql` và các file SQL đã tách `01`–`05`.
- Xác minh accounts thực thi có `CREATEROLE`, quyền GRANT object, tạo schema, đổi function owner (không giả định).
- Chuẩn bị SQL manifest, ảnh hưởng cluster vs TEST, hash scripts, transcript intended execution, rollback và danh sách checkpoint.
- **Đảm bảo công cụ thực thi:** SQL hợp nhất chứa `\connect`, cần `psql` hoặc thao tác tương đương đã kiểm tra; không paste nguyên file vào pgAdmin Query Tool.
- Trình gate rõ phạm vi lên chủ dự án.

**2B — Chỉ sau văn bản phê duyệt DB cụ thể:**

1. Kiểm tra server/database/user/session/backup readiness trước thay đổi.
2. Chạy **đúng nội dung SQL đã được duyệt**, tạo `talo_audit_reader` tại database bảo trì `postgres`, các grants/schema/functions chỉ tại `talo_mos_v4_test`.
3. Static verify owner, SECURITY DEFINER, search_path, timeout, public revoke, grants theo cột, `talo_app` chỉ EXECUTE.
4. Dùng kết nối trực tiếp `talo_app` chạy `DATABASE_APP_VERIFICATION.sql` read-only; kiểm tra chức năng trả kết quả, raw SELECT vẫn bị `42501`.
5. Nếu pre/postcheck bắt buộc fail, dừng và rollback theo đúng phê duyệt, lưu bằng chứng lỗi. Rollback giữ lại cluster role để review; không tự DROP ROLE.
6. Kiểm tra số row theo khoảng có dữ liệu; 0 row trong 24 giờ không đồng nghĩa function lỗi.

**Kết quả:** `DATABASE_GATE_RESULT.md`: trạng thái trước/sau, script hash, who/when/where, quyền, SQLSTATE, raw denial, function availability, rollback status. **Không đánh dấu DB PASS nếu chưa thực chạy trên TEST.**

## WORK PACKAGE 3 — Native Recovery Operation (code & tests)

**Được phân tích/viết code/test ngay; việc GỌI trên TEST cần phê duyệt lifecycle/journal.**

Thiết kế một operation chỉ cho case **failed NEW_MODULE recovery**:

- Journal `RECOVERY_REQUIRED` + classification `NEW_MODULE` + không recovery point.
- Yêu cầu acknowledgement rõ và quyền Foundation của actor.
- Serialize bằng module lock; re-read journal/B01/B02 trong critical section; kiểm tra stale/mismatched snapshots.
- Nếu module enabled, sử dụng Foundation Lifecycle `DISABLE` có audit; xác minh disabled.
- Terminalize journal bằng Installer Store/service thành `FAILED_SAFE`; **không sửa JSON trực tiếp**.
- Không xóa/sửa thủ công B01/B02/B07/B08, release, navigation, lock.
- Fail closed nếu có concurrent update, guard mismatch hoặc disable fail.
- Test: happy path, already disabled, wrong class, no recovery point requirement, missing permission/acknowledgement, module lock contention, race, retry/idempotency, disable failure, audit evidence.

**Kết quả:** source changes + `RECOVERY_NATIVE_OPERATION_TEST_REPORT.md`; báo cáo chưa từng gọi trên TEST trước khi có approval.

## WORK PACKAGE 4 — Deploy/restart & reconciliation gates

**Bắt buộc thứ tự điều kiện, approvals riêng.**

- Xác minh Database Gate PASS và native recovery code/tests PASS.
- Trình **DEPLOY APPROVAL** cho đúng code đã review. Sau approval, deploy/restart môi trường TEST và kiểm tra nạp source, Module Host alias và Installer code, không sửa SCC 0.1.0 immutable release.
- Trình **LIFECYCLE/JOURNAL APPROVAL** mô tả chính xác operation `FAILED_SAFE` và hậu quả có thể DISABLE tạm SCC. Chỉ sau approval mới gọi operation một lần có audit.
- Trước khi gọi: chụp journal `d6fa3a06-1707-43c1-84bd-470b4107a78f`, B01/B02, lock, active version, enabled.
- Sau khi gọi: xác minh journal terminal `FAILED_SAFE`, module disabled theo kế hoạch và dữ liệu registration/release/navigation giữ nguyên.
- Nếu operation fail: dừng, không chỉnh journal tay, lập incident/rollback plan.

**Kết quả:** `RECOVERY_GATE_RESULT.md` + `DEPLOY_GATE_RESULT.md`, before/after và evidence.

## WORK PACKAGE 5 — SCC 0.1.1 Installation Gate

**Chỉ sau khi DB ready, journal cũ terminal, deploy code mới và Installer approval.**

- Tạo **fresh plan** cho 0.1.1; kiểm tra `UPGRADE` recovery point, MIC diff, runtime lock, lifecycle precondition và blockers.
- Đối chiếu package/hash; preflight mới nếu trạng thái/source đổi. Gói 0.1.1 hiện được báo cáo `READY` nhưng cần kiểm lại tại thời điểm install.
- Trình riêng **INSTALLER APPROVAL** (không coi DB/deploy approval là đủ).
- Nếu được duyệt, chạy prepare/commit/cutover bằng Installer chính thức; postcheck không dùng HTTP 200 làm tiêu chí duy nhất.
- Kiểm tra duy nhất đúng ACTIVE version, enabled theo thiết kế, Installer journal terminal thành công; giữ audit và recovery evidence.
- Nếu lỗi: dừng, dùng Foundation-native recovery; không xóa/sửa journal hoặc state SQL thủ công.

**Kết quả:** `INSTALLER_011_RESULT.md` kèm plan/candidate/run ID mới, hash, B01/B02, journal và postcheck.

## WORK PACKAGE 6 — Nghiệm thu toàn bộ SCC

| Chức năng | Bằng chứng dương tính bắt buộc | Bằng chứng âm tính |
|---|---|---|
| System Health | Admin session, API/contract hợp lệ, UI thể hiện trạng thái thật | Manager bị Administrator Gate chặn |
| Test Results | Admin xem artifact/test status có thật, không thực thi shell trái contract | Manager 403 |
| Data Inspection | Read-only, dữ liệu đúng schema/phạm vi, masking và bảng nhạy cảm bị chặn | Manager 403, unauthorized table denied |
| Foundation & Module | API dùng `moduleKey` hợp lệ, dữ liệu module/version/functions đúng | Manager 403, invalid query handled |
| IAM Access Matrix | API dùng `accountId` hợp lệ, thể hiện inheritance/Direct DENY đúng | Manager 403, Direct DENY wins |
| System Audit Logs | **HTTP 200 + `complete=true` + Foundation/IAM `AVAILABLE` + bằng chứng real rows/count ở khoảng có event** | Manager 403, direct denial 403, disabled module 503 theo contract |

Đồng thời xác minh tài khoản inactive/disabled, assurance thấp và role invalid nếu có test harness an toàn. Thu bằng chứng timestamp, account role (không lộ secret), request/response đã redacted, DB function data status, UI screenshots và kết luận.

**Kết quả:** `SCC_RUNTIME_ACCEPTANCE_FINAL.md` có PASS/FAIL/NOT_TESTED từng màn hình. Chỉ công bố `SCC_ACCEPTED_ON_TEST` khi đủ bằng chứng.

## WORK PACKAGE 7 — Git và chốt báo cáo

Chỉ theo phê duyệt riêng từng thao tác commit/push/merge. Không bundle DB/lifecycle/Installer/Git thành một quyết định. Sau gate hoàn thành cập nhật handoff, source manifest, test results, hashes và kế hoạch rollout sau TEST (nếu chủ dự án yêu cầu riêng).

## Tiêu chuẩn báo cáo cho mỗi gate

```
GATE:
STATUS: PENDING | APPROVED | RUNNING | PASS | FAIL | BLOCKED
TARGET: server/database/module/version
BEFORE: trạng thái đo được
ACTIONS: thao tác thực tế, mã/script/hash
AFTER: trạng thái đo được
TESTS: PASS / FAIL / SKIP / NOT_TESTED
EVIDENCE: đường dẫn log/report
ROLLBACK: đã chuẩn bị / đã chạy / không cần
BLOCKERS:
NEXT_OWNER_APPROVAL:
```

## Việc tuyệt đối không làm

Không overwrite working tree; không checkout GitHub main cũ; không sửa immutable 0.1.0; không GRANT raw audit tables cho `talo_app`; không tạo IAM grant để giả kế thừa; không bỏ Direct DENY/Administrator Gate; không ép `HTTP 200` thành audit PASS; không thủ công sửa journal JSON/B01/B02; không thay đổi DEV/PROD; không deploy, install, commit, push/merge hay chỉnh TEST DB chỉ từ việc có bộ handoff này.
