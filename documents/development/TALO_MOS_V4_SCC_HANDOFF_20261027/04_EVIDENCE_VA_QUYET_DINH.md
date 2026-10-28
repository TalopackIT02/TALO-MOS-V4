# EVIDENCE INDEX / OWNER DECISION REGISTER

## 1. Chứng cứ nguồn (không biến thành “đã chạy thật”)

| Bằng chứng | Vị trí trong ZIP nguồn | Xác nhận được |
|---|---|---|
| Tiến độ Claude Code + Work/Codex | `00_PROGRESS_SUMMARY.md` | Lịch sử phân việc, trạng thái hiện tại |
| Git working tree | `01_CURRENT_WORKTREE_AND_ARTIFACTS.md` | Branch, HEAD, 14 tracked modified và 4 nhóm untracked |
| Gates còn tồn tại | `02_PENDING_WORK_AND_GATES.md` | Điều kiện/phê duyệt của các thao tác |
| Trạng thái cuối Phase 2 | `SCC_PHASE2...zip/FINAL_STATUS.md` | Code ready, runtime chưa triển khai |
| Bản kê quyền và phê duyệt DB | `DATABASE_ACCESS_APPROVAL.md`, `DATABASE_PRIVILEGE_MANIFEST.md` | Đối tượng/grants xin phép |
| SQL triển khai/verify/rollback | `DATABASE_MIGRATION.sql`, `DATABASE_APP_VERIFICATION.sql`, `DATABASE_ROLLBACK.sql` | SQL chính xác, chưa chạy trên TEST |
| Installer Recovery | `INSTALLER_RECOVERY_PLAN.md` | Journal stale, đề xuất `FAILED_SAFE` native operation |
| Nghiệm thu UI | `RUNTIME_ACCEPTANCE_MATRIX.md` | Tiêu chí 6 màn hình, chưa live acceptance |
| Regression/Preflight | `TEST_REPORT.md`, `evidence/preflight/` | Test reported PASS, FMI-02 READY |
| PostgreSQL thử nghiệm | `evidence/database/` | Function/grant/negative/rollback trong PostgreSQL 18 cô lập |
| 0.1.1 release ứng viên | `SCC_0.1.1_RELEASE.zip` | Release 49 entries, chưa install |

Nguồn lịch sử hỗ trợ thêm: `SCC_AUDIT_AUTH_FIX_20261026-162136.zip`, `SCC_COMPLETION_20261026-192042.zip`, `IAM_NAVIGATION_20261026-144727.txt`.

## 2. Artifact identification

| Artifact | Nhận dạng |
|---|---|
| Handoff ZIP | `CLAUDE_CODE_CONTINUATION_HANDOFF_20261027-201021.zip` |
| Nested Phase 2 ZIP | `SCC_PHASE2_ACCEPTANCE_PACKAGE_20261027-200250.zip` |
| Phase 2 SHA-256 | `bb60c2a16bc4716d6665aaee1a5de83f05e1915783f342f0ae816d09e6965019` |
| Release 0.1.1 SHA-256 | `db96d4b1aaec6c93336dada304cb240b78d6f1306c410045544f93b84e993d3d` |
| Foundation package hash | `576eed9a74566b99e805200af06fbc8f4ee158b510baa488b9224cf2357a2eb2` |
| FMI-02 Candidate | `e42284db-7cdc-44e1-b6fa-7121f6c3011f` |
| FMI-02 Run | `c0f6f8bd-b4c4-43e2-ba25-e651867051ad` |
| Old SCC 0.1.0 release lock | `f049fb885d8b87e63cac9d7cc1a072641aa36a50bed0438f19889b4f67bc9238` |
| Recovery journal | `d6fa3a06-1707-43c1-84bd-470b4107a78f` |
| Branch | `feat/iam-admin-inheritance-20261024` |
| HEAD reported | `0e491a3fac77801488739f3cd95f99845bbcd69e` |

**Kiểm tra độc lập trong phiên tổng hợp tài liệu:** 7/7 checksums của handoff và 31/31 checksums của Phase 2 manifest khớp, ZIP release SHA khớp. Đây là kiểm tra tính toàn vẹn file đã nhận, không phải kiểm tra PostgreSQL hoặc Git working tree Windows hiện tại.

## 3. Danh sách file nguồn Codex đã sửa (theo handoff)

**Tracked modified (14):**

1. `backend/src/module-host/capabilities.ts`
2. `backend/src/modules/foundation/foundation.installer.iam.ts`
3. `backend/src/modules/foundation/foundation.installer.service.ts`
4. `backend/src/modules/foundation/foundation.mic.ts`
5. `backend/test/unit/foundation/foundation.canonical.test.ts`
6. `backend/test/unit/foundation/foundation.installer.test.ts`
7. `backend/test/unit/module-host/module-host.permissions.test.ts`
8. `modules/SYSTEM_CONTROLLER_CENTER/PACKAGE_FILES_SHA256.txt`
9. `modules/SYSTEM_CONTROLLER_CENTER/README.md`
10. `modules/SYSTEM_CONTROLLER_CENTER/backend/system-audit.service.ts`
11. `modules/SYSTEM_CONTROLLER_CENTER/backend/system-controller-center.repository.ts`
12. `modules/SYSTEM_CONTROLLER_CENTER/mic/module.mic.json`
13. `modules/SYSTEM_CONTROLLER_CENTER/module.json`
14. `modules/SYSTEM_CONTROLLER_CENTER/tests/scc-contract.test.ts`

**Untracked cần bảo toàn:** `backend/scripts/scc-readonly-inventory.ts`; `backend/test/unit/foundation/foundation.installer.iam.test.ts`; `database/scripts/scc-audit-read/`; `modules/SYSTEM_CONTROLLER_CENTER/database/`.

Các file IAM inheritance sửa từ các giai đoạn Claude Code trước có thể vẫn nằm trong working tree; danh sách 14 file này là delta của lượt Codex theo source, **không phải tất cả file từng bị sửa trong toàn dự án**.

## 4. Chủ dự án phải duyệt điều gì?

### Quyết định 01 — DB Access (đang chờ)

- [ ] Duyệt **chính xác** migration để tạo role `talo_audit_reader` ở cluster và schema/function/grants chỉ trên `talo_mos_v4_test`.
- [ ] Duyệt chạy verification và rollback đã kèm theo nếu postcheck fail.
- [ ] Xác minh hash script dự kiến trước lúc chạy.
- [ ] Không bao gồm Installer/lifecycle/deploy/Git.

### Quyết định 02 — Deploy/Restart (chưa xin/chưa duyệt)

- [ ] Duyệt deploy/restart đúng source đã kiểm thử trên môi trường được chỉ định.
- [ ] Không tự cho phép thao tác DB hoặc journal.

### Quyết định 03 — Journal/Lifecycle (chưa xin/chưa duyệt)

- [ ] Duyệt gọi operation Foundation-native cho **journal cụ thể** sau review/test.
- [ ] Chấp thuận có thể `DISABLE` module đang enabled và terminalize `FAILED_SAFE` với audit.
- [ ] Không cho sửa JSON journal/B01/B02 thủ công.

### Quyết định 04 — Installer SCC 0.1.1 (chưa xin/chưa duyệt)

- [ ] Duyệt prepare/commit/cutover sau khi DB PASS, journal terminal và fresh plan/preflight không blockers.
- [ ] Mọi thất bại phải giữ recovery evidence và cơ chế phục hồi chính thức.

### Quyết định 05 — Git (chưa xin/chưa duyệt)

- [ ] Commit; [ ] Push; [ ] Merge — duyệt từng phạm vi, không suy rộng.

## 5. Điều kiện chốt dự án

**Không coi SCC hoàn thành** nếu chỉ có code PASS, SQL cô lập PASS, FMI READY hoặc HTTP 200 `complete=false`. Điều kiện là DB TEST thực tế hoạt động, journal/Installer terminal chính xác, runtime SCC 0.1.1, IAM/Admin Gate còn an toàn và tất cả 6 màn hình có evidence đạt hợp đồng.
