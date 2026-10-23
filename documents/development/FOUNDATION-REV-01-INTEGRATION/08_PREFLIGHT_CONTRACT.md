# 08 — FMI-02 PREFLIGHT COVERAGE & EVIDENCE

## Hiện trạng

`foundation.preflight.ts` có 10 bước theo nhãn P0, P1, P2a, P2b, P3, P4, P5a, P5b, P6, P7. Báo cáo SYSTEM_TEST 1.2.0 gần nhất user đưa: 10/10 PASS, báo cáo TXT, hash candidate. Nhưng:

- `P6` chỉ kiểm 401 không phiên; **không chứng minh** API trả 200/403 và envelope dữ liệu đúng trong session.
- `P5b` PASS nếu package không có `*.db.test.ts`; mô tả phải ghi **NOT_APPLICABLE / không có test ghi DB**, không quảng bá DB integration đã chạy. Nếu bắt buộc có DB test mà thiếu -> NOT_TESTED block.
- `P2 typecheck` không thay thế frontend browser build và UI integration.
- Package tests có thể chỉ có 5 tests; không tự khẳng định bao phủ toàn bộ nghiệp vụ.

## Hợp đồng check sau REV-01

| ID | Check | Pass nghĩa là | Không được suy diễn |
|---|---|---|---|
| P0 | Package integrity | source/snapshot hash khớp | version ACTIVE đã thay |
| P1 | FMI-01 scan | static MIC/routes policy đạt | code runtime chạy được |
| P2a/b | Backend/Frontend compile+typecheck | đúng test toolchain trên staging | tất cả API data đúng |
| P3 | Package tests | test suite hiện hữu đạt | test chưa khai báo cũng đạt |
| P4 | Host handshake | mounts/method/path khớp MIC05 | IAM/response payload đúng |
| P5a | DB contract | tài nguyên MIC06 kiểm tra theo interface | SELECT dữ liệu nghiệp vụ đã đạt |
| P5b | DB tests | thực sự chạy isolated DB khi có test | absence = DB integration PASS |
| P6 | Unauthenticated smoke | 401/error envelope đúng | authenticated 200/403 PASS |
| P7 | Installed runtime isolation | active code/lock không bị thay trong staging | upgrade rollback đã chứng minh |

Bổ sung các check theo yêu cầu, không nhất thiết phá SUITE_VERSION cũ: `API_RESPONSE_CONTRACT` kiểm JSON real server↔frontend parse, `AUTHENTICATED_IAM_SMOKE` với principal allow/deny được phép, `FRONTEND_RUNTIME_OR_BUILD`, `NAVIGATION_B09_PREVIEW`, `UPGRADE_RECOVERY_GATE` cho cutover. Nếu một check không thể chạy do thiếu fixtures/scope: `NOT_TESTED` hoặc `UNAVAILABLE` với limitation chính xác, không auto PASS.

### Authenticated & denial test

- Dùng account/role fixture cô lập hoặc test harness hiện có, không mượn cookie/token admin thật từ Browser.
- Mọi endpoint trong MIC05: method/path/status/envelope, response required fields/type, negative scenarios, IAM deny.
- Dữ liệu chứa row/secrets chỉ so shape và sanitized examples; không log full payload.
- Nếu module endpoint cần DB fixture chưa có, contract test có thể dùng fixture API độc lập và *ghi rõ* mức độ chưa đạt của production-like runtime. Không fake result là runtime live.

### Navigation + UI

- MIC04 route phải được AppShell resolve khi module đã cài, permissions đúng. Staging check logic `moduleScreens`, `shellScreens`; test direct URL/SPA reload.
- Xuất report TXT/JSON cho từng run và mỗi bước; đủ version/hash/timestamp/exit/issue/limitation; UI cho download read-only.

## Evidence data contract

Từng check lưu `id,key,label,status,startedAt,finishedAt,durationMs,exitCode,issues,limitations,logRef,logHash,environment`. Run lưu `runId,candidateId,moduleKey,version,packageHash,scanId,suiteVersion,result,reportHash,startedAt,finishedAt`. Source test log sanitized, bounded; report immutable/readable after restart.

### Gate READY

- Chỉ READY khi tất cả **required** checks PASS, cùng Candidate source hash và snapshot, môi trường phù hợp, reportHash matches content.
- Optional `NOT_APPLICABLE` được ghi tách biệt, không tăng `PASS` nếu không có phép chạy.
- Upgrade với ACTIVE cũ có thể READY ở Preflight nhưng **INSTALL_PLAN BLOCKED** nếu recovery gate chưa được chứng minh. UI phải giải thích mức READY khác INSTALLABLE.
- Không sửa `MIC10` package trong quá trình Preflight; FMI-03 dùng evidence server ở commit.

### Tests chặn regression

- Một endpoint trả 200 JSON thiếu field: preflight API contract FAIL.
- 401 tất cả đạt nhưng authenticated 403 sai khi allow: không coi hoàn tất.
- DB test không tồn tại: status N/A rõ, không ghi “database tests đã chạy”.
- `NOT_TESTED/UNAVAILABLE` required => NEEDS_FIX; hash changed => INVALIDATED.
- Report TXT bao gồm mọi issue và limitation, không chỉ summary.
