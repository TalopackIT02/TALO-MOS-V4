# 07 — Rào an toàn và cổng dừng

## Môi trường

- Cố định nghiệm thu trên `talo_mos_v4_test`; validate hostname, db name, role trước operations.
- Backup custom pg_dump + checksum, `pg_restore -l` trước mọi DB write cleanup/lifecycle. Không dump secrets ra logs.
- Không DEV/PROD. Không tự cấp SQL GRANT, không tắt constraints, không TRUNCATE/CASCADE, không sửa IAM core.
- Không đụng source module SYSTEM_TEST 1.1.1 / DATA_INSPECTOR 0.1.0 đang chạy nếu chưa backup và deployment plan.

## Workflow access

- Reuse Session + CSRF + B08 denied audit. IAM policy cho prepare/test/install riêng, có authorization server-side; nếu cần permission mới cho installer, bootstrap phê duyệt rõ ràng, không tự grant.
- Không tin `MIC10 PASS` do client cung cấp, không accept arbitrary CLI/script path hay SQL trong request.
- Staging worker chạy least privilege, isolated filesystem + test DB, fixed allowlisted scripts, CPU/memory/time quotas, không chạy npm install từ mạng tự động nếu không phê duyệt.
- Integrity: rehash source trước/giữa/sau test, staged artifact, installed release; hash mismatch abort.
- Không để candidate mới nạp vào AppShell qua `modules:sync` hoặc registry tự động.
- Mọi activation/cutover tạo audit + report đủ trace.

## Gates

- G0: Baseline & backup (before DB writes) verified.
- G1: Fixture owner provenance verified. Nếu chưa rõ: chưa retire/delete.
- G2: Real route conflict resolved; scan refresh đúng.
- G3: Installed runtime isolated from candidates, regression PASS.
- G4: FMI02 evidence pipeline PASS, signed/hashed server report.
- G5: Candidate READY, full required checks PASS, hash unchanged.
- G6: FMI03 deployment plan valid, privilege + restart/recovery capability verified.
- G7: controlled install staged/published/activated and postcheck PASS.
- G8: DATA_INSPECTOR old independent module unaffected until owner explicitly authorizes sunset.

## Thứ tự phát triển không được đảo

`route cleanup+fixture isolation` → `installed-runtime isolation` → `FMI02 preflight` → `FMI03 prepare` → `FMI03 commit with recovery` → `acceptance`.

## Hard stop

- Không có reliable recovery for ACTIVE upgrade: block auto cutover.
- Unable to control backend/frontend restart: AWAITING_RESTART, not completed.
- Unable to verify IAM grant: fail closed.
- Mixed source/runtime hashes: stop and reconcile.
- Database target uncertain: stop DB actions.
- Untracked changes owned by user: preserve, no git reset.
