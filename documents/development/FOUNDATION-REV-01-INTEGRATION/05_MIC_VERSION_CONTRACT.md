# 05 — MIC, VERSION & EVIDENCE: SINGLE SOURCE OF TRUTH

## Nguồn chuẩn

`modules/<KEY>/mic/module.mic.json` → scan → immutable Candidate snapshot → FMI-02 preflight + `runId/reportHash` → FMI-03 compose server evidence → `B02.DRAFT.manifest_json` → SUBMIT → APPROVE → ACTIVATE. Đến khi Installer commit, B02 DRAFT cũ là dữ liệu hiện có, không phải nguồn MIC tự động.

Mọi hoạt động tạo/cài module từ folder phải đi qua chuỗi này. MIC TS adapter vẫn dùng cho Host nếu package yêu cầu; không import/eval nó trong Scanner.

## MIC10 evidence

- Trong **package nguồn**, MIC10 testEvidence `NOT_TESTED` là hợp lệ để scan. PASS do AI viết không tự trở thành evidence hợp lệ.
- FMI-02 ghi từng check: `testId`, `status`, timestamp, environment, candidateId, moduleKey/version, package SHA-256, suiteVersion, runId, exitCode, logHash, limitations; report JSON/TXT có digest.
- FMI-03 chỉ tạo `mic10Manifest.testEvidence` PASS từ run READY còn hiệu lực, gắn report hash, runId và target. Nếu run đã invalid/changed/stale, chặn.
- Không đánh PASS cho test bị skip/không có fixture. `NOT_TESTED/UNAVAILABLE` ở **required check** chặn READY; optional check phải ghi giới hạn.
- Khi B02 DRAFT được cập nhật, tính canonical MIC hash bằng đúng `canonicalDigest()` Foundation; PUT rồi fresh GET và so sánh nội dung, hash. Xác minh MIC05↔Host routes, MIC02/03↔07, MIC04↔Builder mapping trước SUBMIT.

## DRAFT hiện có chứa `MAIN.READ` template

Trường hợp thực tế SYSTEM_TEST 1.2.0 đã có `DRAFT` với MIC mẫu: `MAIN.READ`, `/system_test`, `mic05Api: []`, `INITIAL_REGISTRATION`, test `NOT_TESTED`. Đây không phải MIC của package.

Installer được phép **đề xuất ghi đè DRAFT** khi tất cả điều kiện:
1. ModuleKey, moduleVersion, contractVersion chính xác.
2. B02 vẫn `DRAFT` sau read-lock/re-read; không có lượt review khác.
3. Có Candidate READY đúng hash, quyền updateManifest và owner-approved install plan; chỉ dùng dịch vụ hiện có để PUT, không SQL.
4. So sánh `expectedManifestHash`/version revision ngay trước ghi; phát hiện DRAFT bị sửa ngoài Installer → `DRAFT_CHANGED_EXTERNALLY`, yêu cầu review chứ không overwrite âm thầm.
5. Hiển thị diff ở UI; ghi audit update với actor thật.
6. Fresh GET = MIC mới; không thể còn `mic05Api: []` nếu package có 7 API.

Nếu DRAFT chứa chỉnh sửa người dùng không tương ứng mẫu, giữ nguyên đến khi có xác nhận trong plan; không đoán đó là rác.

## Chặn đường thủ công sai

- `VersionPanel.micTemplate()` không được tạo ra dữ liệu “có vẻ đúng” cho cùng module/version khi package Candidate READY đã có MIC chuẩn. Hiển thị `CHƯA ĐỒNG BỘ MIC TỪ CANDIDATE` hoặc tab read-only, nút đưa đến Candidate Workspace.
- Không xóa API `PUT manifest` thủ công; có thể giữ Advanced mode dành cho trường hợp legacy, guarded bởi quyền thực, kèm cảnh báo chưa được Preflight bảo đảm.
- Đối với đường manual, vẫn dùng validator và gate hiện tại; không thể submit/activate MIC mẫu giả.
- `INITIAL_REGISTRATION` chỉ cho module mới, không dùng cho SYSTEM_TEST upgrade; `CHANGE.fromVersion` phải dựa lịch sử thật, không tự đổi version 1.2.0 thành 1.2.1.

## MIC ↔ UI ↔ Host mapping phải khớp

| MIC block | Tham chiếu | Cần đối chiếu |
|---|---|---|
| MIC01 | module.json/B01/B02 | moduleKey, name, version |
| MIC02 | B03 functions | functionKey, display name |
| MIC03 | B04 actions | function/action/nature |
| MIC04 | AppShell/B09 | routePath, screenKey, function, menuLabel, Develop policy |
| MIC05 | Host HTTP mounts | method, path, status/error contract |
| MIC06 | DB/API resources | interface kind; metadata/read semantics; không giả có bảng |
| MIC07 | IAM K05 | moduleCode = KEY, resourceCode = functionKey, operation = actionKey; mức assurance |
| MIC08 | B07/B08 / event code | audit event action declarations |
| MIC09 | compatibility/version history | INITIAL_REGISTRATION vs CHANGE/fromVersion |
| MIC10 | server preflight evidence | reference đã hash, scope môi trường |

B02 stored MIC có hash riêng; **package SHA-256** của Candidate là digest độc lập. Không lấy một digest thay cho digest kia.

## Acceptance

- Có Candidate READY và DRAFT đang chứa MIC mẫu: plan hiển thị khác biệt; commit ghi đúng MIC của Candidate; fresh GET khớp trước khi SUBMIT.
- API count/method/path, functions/actions/mappings đồng nhất; không còn route `/system_test` do template tạo giả nếu package dùng `/system-test`.
- Không update version APPROVED/ACTIVE, không fake MIC10, không tăng version để sửa bug trong Candidate.
