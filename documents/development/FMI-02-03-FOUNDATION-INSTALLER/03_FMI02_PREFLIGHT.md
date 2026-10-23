# 03 — FMI-02: Foundation Preflight Engine

## User story

Người quản trị chọn package đã quét → **Kiểm tra & Chạy thử** → thấy PASS/WARN/FAIL/NOT_TESTED từng kiểm tra, log, sửa folder rồi chạy lại. Không phải đổi version để sửa lỗi trước READY. Không cần Claude Code để add module.

## Candidate Workspace (đứng trước B02 immutable)

- Một candidate có `candidateId`, `moduleKey`, `packageVersion`, `scanId`, `sourceHash`, `stagedHash`, `stagedPath` (server only), `status`, `runHistory`, `createdBy`, `createdAt`.
- Giai đoạn `SCANNED` → `VALIDATING` → `NEEDS_FIX` hoặc `READY`. Có lỗi thì sửa folder, **quét lại bằng nút thủ công** rồi retry; run cũ vẫn có lịch sử nhưng không còn áp dụng với hash mới.
- Không tạo B02/khóa MIC ở Candidate Workspace. Nếu Foundation đã có cùng version B02 DRAFT, không âm thầm overwrite; cần kế hoạch tương thích. Với B02 APPROVED/ACTIVE/RETIRED, không sửa.
- Candidate snapshot và evidence tồn tại bền vững trong vùng quản lý cục bộ/TEST, có cơ chế atomic update và recovery; không thêm bảng DB khi chưa có phê duyệt schema.

## Giai đoạn preflight (tách static vs runtime)

P0: Verify scanner result + canonical package hash, không theo symlink, mọi path thuộc package root. Nếu hash đổi: `PACKAGE_CHANGED`; phải scan lại, không dùng evidence cũ.
P1: MIC-1.0 parse/validate, MIC01–10, MIC09 history, MIC05 API mapping, MIC07 K05, route/screen keys, Host Protocol.
P2: Build/typecheck Backend và Frontend bằng package snapshot trong staging; chạy không ảnh hưởng installed runtime; không auto chạy `predev/prebuild` có side effects tùy ý từ candidate.
P3: Contract tests (response envelopes, status codes, errors, authenticated/denied behavior, API ↔ frontend client; không tạo response giả).
P4: Host handshake, navigation route resolution, IAM mapping test dùng mock/fixture an toàn; test quyền chính thức sau activation nằm ở postcheck.
P5: Database contract test: chỉ đọc metadata/least privilege; test có ghi data bắt buộc chạy vào fixture isolated DB, **không main `talo_mos_v4_test`** trừ khi test được chứng minh an toàn và có approval rõ.
P6: Runtime smoke trong isolated worker/test host (fixed allowlisted test entrypoints, time/memory limits, no arbitrary command sent from browser); kiểm thử API thật khi khả thi.
P7: Regression ảnh hưởng AppShell, IAM, Foundation và installed release; old ACTIVE không bị thay.
P8: Xuất JSON report + TXT summary, hash report, logs sanitized và MIC10 evidence references. Kiểm tra all required PASS mới READY.

## Evidence

Evidence mỗi mục: `testId`, `result`, `environment`, `candidateId`, `packageHash`, `suiteVersion`, `runId`, `startedAt`, `finishedAt`, `exitCode`, `reportHash`, `reference`, `traceId`, `limitations`.
- `PASS` chỉ do runner tạo và đã kiểm bằng dữ liệu test thật.
- `NOT_TESTED`/`UNAVAILABLE` của required check chặn READY, không tô xanh.
- Report không chứa cookie, DB URL, mật khẩu, token, raw rows nhạy cảm.
- `MIC10 testEvidence` do Foundation tổng hợp đúng MIC-1.0 khi publish; `.reference` trỏ đến report đã hash và lưu, không tự do nhận PASS từ client.
- Nếu package hash/target/mic thay đổi sau test → READY tự mất hiệu lực; cần chạy lại.
- Không coi static-only PASS là runtime PASS.

## Trạng thái

`SCANNED`, `VALIDATING`, `NEEDS_FIX`, `READY`, `INVALIDATED`, `CANCELLED`; `ERROR` cho lỗi engine. Mọi trạng thái kèm người thực hiện và scan/test trace.

## Không thuộc FMI02

Không tự publish B02, không ghi IAM permission thật, không tạo Navigation B09, không ACTIVATE/ENABLE, không tự deploy code vào Host.
