# MASTER PROMPT — CLAUDE CODE CONTINUE SCC

Bạn là Claude Code tiếp tục công việc TALO-MOS-V4 từ **working tree local hiện tại**. Bạn được quyền chủ động thực hiện phân tích, sửa code, bổ sung regression tests, dựng artifact và báo cáo **trong phạm vi an toàn**; không cần chủ dự án hướng dẫn từng bước kỹ thuật.

## Nhiệm vụ

**Hoàn tất SCC 0.1.1 trên TEST theo gate**, kế thừa công việc của ChatGPT Work/Codex thay vì xây dựng lại. Đầu ra cuối mong muốn là SCC 0.1.1 đọc được audit Foundation/IAM có dữ liệu thực, sáu màn hình SCC nghiệm thu, IAM/Direct DENY/Administrator Gate chính xác, Installer và journal nhất quán.

## Nguồn sự thật

- Repo: `D:\Documents\ClaudeProject\TALO-MOS-V4`.
- Branch expected: `feat/iam-admin-inheritance-20261024`.
- HEAD expected at handoff: `0e491a3fac77801488739f3cd95f99845bbcd69e`.
- **Dirty working tree contains uncommitted and untracked work. Never reset, clean, overwrite or replace with GitHub main.**
- Read accompanying files `00_BAT_DAU.md`, `01_BAO_CAO_TONG_HOP_CHI_TIET.md`, `02_CLAUDE_CODE_ACTION_PLAN.md`, `04_EVIDENCE_VA_QUYET_DINH.md`.
- Read original `CLAUDE_CODE_CONTINUATION_HANDOFF_20261027-201021.zip`, especially `00_PROGRESS_SUMMARY.md`, `01_CURRENT_WORKTREE_AND_ARTIFACTS.md`, `02_PENDING_WORK_AND_GATES.md`, and nested `SCC_PHASE2_ACCEPTANCE_PACKAGE_20261027-200250.zip`.
- Original nested package includes `DATABASE_MIGRATION.sql`, `DATABASE_APP_VERIFICATION.sql`, `DATABASE_ROLLBACK.sql`, `INSTALLER_RECOVERY_PLAN.md`, `TEST_REPORT.md`, `FINAL_STATUS.md`, `SCC_0.1.1_RELEASE.zip` and evidence.

## Đã làm / không được tự làm lại

- IAM `TALO_SYSTEM_ADMIN` inheritance đã được sửa và test, giữ Direct DENY, account/role/assurance, SCC Administrator Gate và lifecycle.
- SCC Audit 403 root cause do alias `system_controller_center.audit.read` vs catalog `system_controller_center.audit_log.read`; compatibility được thu hẹp đúng SCC 0.1.0.
- Installer IAM_POLICY đã hỗ trợ dynamic Administrator source, readProbe query placeholders và response assertions.
- SCC 0.1.1 code dùng 3 function `audit_api.read_*`; SQL least privilege đã có, isolated PostgreSQL 18 tests PASS.
- Backend regression 458/458 PASS (172 skipped), targeted 50/50, SCC contract 9/9, FMI-02 READY (9 PASS, 0 FAIL).
- Package `SCC_0.1.1_RELEASE.zip` SHA-256: `db96d4b1aaec6c93336dada304cb240b78d6f1306c410045544f93b84e993d3d`; Foundation package hash: `576eed9a74566b99e805200af06fbc8f4ee158b510baa488b9224cf2357a2eb2`.
- PostgreSQL TEST chưa có audit_api functions; 0.1.0 vẫn ACTIVE/enabled; journal `d6fa3a06-1707-43c1-84bd-470b4107a78f` còn `RECOVERY_REQUIRED` và chặn plan 0.1.1 bởi `INSTALL_IN_PROGRESS`.

Các kết quả trên đến từ báo cáo/handoff. Hãy xác minh source local và tình trạng thực tế mới nhất trước mọi tác động.

## Hành động chủ động được phép ngay

1. Đọc/tóm tắt source, Git diff và untracked files, tạo snapshot an toàn không commit.
2. Đối chiếu hash, test report, preflight và SQL scripts với code local; kiểm tra DB **read-only** nếu kết nối có sẵn.
3. Hoàn thiện và test native Installer operation đóng journal failed `NEW_MODULE` từ `RECOVERY_REQUIRED` sang `FAILED_SAFE` qua InstallerStore/service, module lock, re-read journal/B01/B02, Lifecycle DISABLE có audit, permission và acknowledgement. Không gọi operation trên TEST.
4. Rà soát và chuẩn bị phê duyệt SQL chính xác, quyền PostgreSQL, rollback, tương thích `psql` (migration có `\connect`) và điều kiện quyền tạo role/đổi function owner.
5. Tạo report theo từng gate và đóng gói toàn bộ code/evidence, không tự tuyên bố nghiệm thu runtime khi chưa chạy.

## Phê duyệt riêng — không được tự suy diễn

- **DB approval:** chưa có. Không chạy SQL migration lên `talo_mos_v4_test` trước văn bản phê duyệt cụ thể. Khi được phê duyệt, chỉ chạy SQL đã duyệt đúng đối tượng, verify raw SELECT denial, positive EXECUTE, rollback theo phạm vi duyệt nếu fail.
- **Deploy/restart approval:** riêng, không suy từ DB approval.
- **Lifecycle/Journal approval:** riêng, không suy từ Deploy. Không sửa trực tiếp JSON journal, B01/B02/B07/B08.
- **Installer 0.1.1 approval:** riêng, sau DB PASS, journal terminal, code deployed/restarted, fresh plan/preflight không blocker.
- **Git approvals:** commit, push, merge đều yêu cầu quyền riêng.
- Không tác động DEV/PROD, không sửa immutable SCC 0.1.0, không cấp broad DB SELECT hoặc grant IAM giả.

## Đường hoàn thành kỹ thuật

A. Reception baseline & status report → B. DB approval pack → C. Native recovery operation code/tests → D. Khi được phê duyệt: DB migration/verify → E. Khi được phê duyệt: deploy/restart → F. Khi được phê duyệt: native recovery/lifecycle `FAILED_SAFE` → G. Fresh 0.1.1 plan, Installer approval và cutover → H. Live acceptance sáu màn hình, Manager/Direct DENY negative tests → I. Handoff final.

Có thể triển khai code/tests độc lập song song ở B/C; không được thực thi gated operations trước approval.

**Audit acceptance:** HTTP 200 **không đủ**. Phải `logs.complete=true`, `logs.sources.FOUNDATION.state=AVAILABLE`, `logs.sources.IAM.state=AVAILABLE` và dữ liệu thật/truy vấn nguồn được xác nhận. 0 dòng trong time window cần phân biệt với database failure.

**Mỗi gate báo cáo:** trước/sau, chính xác code/script/hash, tests PASS/FAIL/SKIP, runtime evidence, blockers, rollback, phê duyệt tiếp theo. Dừng ở approval gate mà không chặn những công việc code/test an toàn còn lại.

**Bắt đầu tiếp nhận ngay từ working tree local. Không trả về một bản kế hoạch chung chung, không yêu cầu chủ dự án thao tác từng lệnh PowerShell. Chỉ yêu cầu phê duyệt khi thực sự chuẩn bị làm thao tác được bảo vệ.**
