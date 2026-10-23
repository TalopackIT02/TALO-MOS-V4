# 09 — HTTP CONTRACT, ERRORS, RACES & UI BINDINGS

## Giữ API hiện hữu

Không đổi tên URL tùy tiện. Claude phải đọc `foundation.routes.ts`, `foundation.module-scan.routes.ts`, `foundation.installer.routes.ts`, `foundation.manifest.routes.ts`, `foundation.lifecycle.routes.ts` và `foundation.navigation.routes.ts` ở local trước khi sửa.

### FMI endpoints tham chiếu (GitHub commit b7b5f071)

| Method | API path bên dưới `/api` | Purpose |
|---|---|---|
| POST | `/foundation/module-packages/scan` | Trigger manual scan; body `{}` |
| GET | `/foundation/module-packages/scans/:scanId` | Snapshot cached; no scan |
| POST | `/foundation/module-candidates` | `{scanId,moduleKey}` tạo/reuse Candidate |
| GET | `/foundation/module-candidates` | List gần đây |
| GET | `/foundation/module-candidates/:candidateId` | Get persisted candidate |
| POST | `/foundation/module-candidates/:candidateId/preflight` | `{}` start run |
| GET | `/foundation/module-candidates/:candidateId/preflight/:runId` | Result/progress |
| GET | `/foundation/module-candidates/:candidateId/preflight/:runId/report.txt` | Download TXT |
| GET | `/foundation/module-candidates/:candidateId/preflight/:runId/report.json` | Download JSON |
| POST | `/foundation/module-candidates/:candidateId/install/prepare` | Dry run plan `{}` |
| POST | `/foundation/module-candidates/:candidateId/install/commit` | `{planId,acknowledge:true}` (client schema verify) |
| GET | `/foundation/module-installations/:installId` | Resume/review journal |
| POST | `/foundation/module-installations/:installId/continue` | `{}` continue after restart |
| GET | `/foundation/module-installations/:installId/report.txt` | Report |
| GET | `/foundation/runtime-release` | Backend/Frontend/lock state |

**Lưu ý:** local API contract được xác minh khi triển khai, không dựa vào bảng này để bỏ qua schema thật.

## Response JSON và lỗi

- Giữ response keys hiện có (`{candidate}`, `{run}`, `{installation}`, `{runtime}` etc.). UI client phải có parse/validator dùng chung; thay đổi schema có test cả producer và consumer.
- Error envelope chuẩn Foundation `{error:{code,message,requestId,details?}}` với HTTP 400/401/403/404/409/422/503 phù hợp. Không leak stack hoặc raw SQL.
- `UNEXPECTED_RESPONSE`: log/surface endpoint + field path bị thiếu, không log token/response body nhạy cảm; không thay bất kỳ status thành PASS.
- 409 status stale/lock: `PACKAGE_CHANGED`, `PLAN_EXPIRED`, `DRAFT_CHANGED_EXTERNALLY`, `INSTALL_IN_PROGRESS`, `VERSION_LOCKED`, `UPGRADE_RECOVERY_UNAVAILABLE`, `ROUTE_CONFLICT`.
- 422 validation policy (MIC compatibility/IAM/Navigation): danh sách machine-readable codes và safe UI explanation.
- 503: IAM/DB/runtime unavailability, phải fail-closed, không biến registry unavailable thành NEW_MODULE.

## Đề xuất API tối thiểu nếu cần cho UI Workspace

- `GET /foundation/module-candidates/:id/mic-diff` hoặc tính server response tổng hợp trong `GET candidate`: MIC candidate, stored B02 draft status/hash, structured diff đã lọc. Không gửi toàn bộ secret; không phải client PUT MIC.
- `GET /foundation/module-installations/:id/plan` nếu existing `GET installation` đủ thì không tạo mới.
- UI route `/foundation/modules/candidates/:candidateId` là client AppShell route; **không** được coi là endpoint backend.
- `POST /foundation/.../restart` **không thêm** nếu chưa có supervisor cố định an toàn đã phê duyệt.

## Concurrency / idempotency

- Scan explicit only; no auto scan when navigating workspace. Poll **run status** được phép trong preflight, không phải quét mới.
- Candidate snapshot hash and unique request; PATCH/change hash invalidates run/plan.
- `prepare` read-only except persisted plan journal; plan has TTL and pre-commit revalidation.
- `commit` requires idempotent transaction journal + module lock, no duplicate B01/B02/B09/IAM on retry. Đừng rely solely on process Set trong multi-instance.
- Version DRAFT mutation must re-read status/hash under appropriate synchronization and use expected hash; concurrent manual user edit must be blocked and shown.
- Postcheck failure must persist and remain inspectable after browser refresh/restart.

## Auth / download

All endpoints use session wrapper, CSRF/Origin for writes, IAM permissions server side; downloads are auth-protected and served with safe attachment names, `text/plain; charset=utf-8`, no-store, no arbitrary file path from user. Client doesn't put session tokens in localStorage.

## Contract test cases

- 401 no session; 403 lacks permission; 200 valid when permitted; envelope shape.
- 400 arbitrary `{path:...}` or unrecognized fields, no FS traversal.
- 409 stale scan/candidate/run, plan expired, collision/race.
- 503 backend/DB/registry not available.
- 200 response missing required field → UI catches with useful field name and no green state.
- TXT download filename, MIME, encoding, contents and no credentials.
- UI routes not accidentally shadow module tab paths or admin screen URLs.
