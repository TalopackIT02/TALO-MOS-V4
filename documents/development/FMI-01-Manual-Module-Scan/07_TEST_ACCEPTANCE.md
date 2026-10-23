# FMI-01 — Test Plan / Acceptance Matrix

## Yêu cầu evidence

Mỗi test ghi: ID, command/setup, input, expected, actual, PASS/FAIL/NOT_TESTED, file log/reference, commit/working-tree SHA khi có. Không viết PASS khi chưa thực thi.

| ID | Scenario | Expected |
|---|---|---|
| T01 | Không nhấn Quét Module | Không có request scan mới, không watcher/poll |
| T02 | Package hợp lệ | Phát hiện, đúng key/version, PASS static |
| T03 | Thiếu module.json | Vẫn có folder và issue MODULE_MANIFEST_MISSING |
| T04 | PackageFormat sai | FAIL, không eligible |
| T05 | Key sai tên folder | FAIL, expected/actual |
| T06 | MIC JSON thiếu/schema sai | FAIL mới; legacy active không mất runtime |
| T07 | MIC01.version khác packageVersion | FAIL rõ field |
| T08 | MIC07 sai K05 | FAIL chính xác mapping |
| T09 | MIC10 NOT_TESTED hoặc declared PASS | WARN chưa xác minh runtime, không giả READY |
| T10 | Hai module trùng route | Conflict FAIL |
| T11 | Upgrade giữ route của chính module | Không báo conflict sai |
| T12 | Registry lỗi | REGISTRY_UNKNOWN/UNAVAILABLE; không NEW_MODULE |
| T13 | Existing approved/active version | Không bị sửa, không eligible same-version override |
| T14 | 401, một trong hai permission thiếu | Fail closed; DENIED audit theo hiện trạng |
| T15 | Hai POST đồng thời | Một cái 409 SCAN_IN_PROGRESS, lock được giải phóng |
| T16 | Một folder hỏng | Các folder khác vẫn được liệt kê |
| T17 | Windows junction/symlink, .env, path traversal | Không đọc/execute trái phép, issues phù hợp |
| T18 | Sửa content package sau scan | Hash khác, snapshot cũ không auto-update |
| T19 | Authorized scan | Không ghi B01–B14/IAM, không thay lifecycle |
| T20 | predev/prebuild/module sync | Package ACTIVE cũ vẫn nạp đúng; candidate chưa chấp thuận không thay thế |
| T21 | UI drawer, keyboard, error/empty/loading | Đúng UX, không trắng trang |
| T22 | Typecheck/build/regression | Backend/frontend PASS; không phá Host/IAM/Foundation |

## Negative/API tests bổ sung

- Body `null`, `[]`, `{ "path": "C:\\" }`, body quá kích thước, duplicate/unknown fields.
- Scan ID không hợp lệ, hết TTL, snapshot không tồn tại.
- Connection interrupted, error envelope đúng.
- File đổi mtime/size giữa lần đọc, race content.
- Folder >250, >1500 files, >25MiB, symlink chain/cycle, junction to external dir, permission denied filesystem.
- Registry empty/truncated/unauthorized, SemVer compare `1.10.0` > `1.9.0`.
- MIC-09 change fromVersion không tồn tại, không tự sửa nội dung.
- Route conflict với AppShell admin route, route trùng 2 module và reuse same-module upgrade.
- Hash ổn định trên Windows khi thứ tự `readdir()` thay đổi.
- API response deliberately malformed => frontend UNEXPECTED_RESPONSE, không crash.

## Required execution order

1. Unit tests pure validation and parser.
2. API tests with fake IAM/Registry and tmp filesystem; không chạm real DB.
3. Frontend UI tests (nếu toolchain repo hỗ trợ), TypeScript checks.
4. Runtime Host sync protections with temp fixtures.
5. Backend + Frontend build, các regressions liên quan.
6. Nếu có TEST DB an toàn: smoke read-only, baseline/postcheck B01–B14/IAM; nếu không ghi NOT_TESTED.

## Gates

- G0 Baseline: local worktree/branch + backup safety.
- G1 Scanner correctness: T02–T19 static/API PASS.
- G2 UI: T01/T21 PASS.
- G3 Host safety: T20 PASS (bắt buộc), regressions không hỏng.
- G4 Handoff: Docs, TEST-RESULTS evidence, git diff reviewed.

`DONE` chỉ khi các gates G1–G4 đạt. Nếu T20 chưa đạt, tối đa PARTIAL/BLOCKED.
