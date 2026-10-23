# FMI-01 — TEST-RESULTS (kết quả thực tế)

**Ngày chạy:** 23/10/2026 · **Nhánh:** `feat/system-test-diagnostics-v1-1` · **HEAD trước triển khai:** `e456996` (working tree FMI-01 chưa commit tại thời điểm chạy)
**Log đầy đủ (đã lọc chuỗi kết nối/mật khẩu, nằm ngoài repo):** `D:\Documents\ClaudeProject\TALO-MOS-V4_exports\FMI-01-evidence-20261023-082426\` (`00-run.txt` = chỉ mục).
**Môi trường DB:** chỉ `talo_mos_v4_test` (vai trò runtime `talo_app`; fixture IAM qua `talo_test_harness`, dọn theo UUID, remaining 0).

## 1. Lệnh và kết quả

| # | Lệnh | Exit | Kết quả |
|---|---|---|---|
| 01 | `backend: npm run typecheck` (pretypecheck = modules:sync có khóa) | 0 | src + test sạch |
| 02 | `backend: npm test` (pretest = modules:sync) | 0 | 28 file PASS, 22 skipped; **394 PASS**, 168 skipped (suite DB tắt bằng cờ) |
| 03 | `backend: npm run build` | 0 | — |
| 04 | `frontend: npm run typecheck` | 0 | — |
| 05 | `frontend: npm run build` | 0 | — |
| 06 | T20 repo thật: candidate tạm `modules/FMI01_CANDIDATE_TMP` + `npm run modules:sync` (backend + frontend) | 0 | candidate **bị bỏ qua**; `registry.ts` trước/sau giống hệt; folder tạm đã gỡ |
| 07 | `vitest run test/unit/foundation/foundation.module-scan.test.ts` | 0 | **23/23 PASS** |
| 08 | `vitest run test/unit/module-host` | 0 | **14/14 PASS** (8 cũ + 6 runtime guard) |
| 09 | `TALO_FOUNDATION_DB=1 vitest run test/integration/foundation/foundation.module-scan.db.test.ts` | 0 | **2/2 PASS** (PostgreSQL TEST thật) |
| 10 | `TALO_FOUNDATION_DB=1 vitest run test/integration --no-file-parallelism` | 1 | 111 PASS, 2 FAIL, FBE-07 không chạy — xem §3 |
| 11 | DATA_INSPECTOR module tests | 0 | 37 PASS |
| 12 | SYSTEM_TEST module tests | 0 | 20 PASS |
| 13 | `playwright test module-scan` (react-dev + react-preview) | 0 | **14/14 PASS** |
| 14 | `playwright test` toàn bộ (react-dev + react-preview, API mock) | 1 | 273 PASS, 9 skipped, 2 FAIL (`auth-flow`) — xem §3 |
| 15 | **Live**: ứng dụng đang chạy (Vite 5173 → backend 3000 → TEST), tài khoản AUTHT- tạm có READ + CREATE, đăng nhập thật → Quản lý Module → Quét Module → drawer SYSTEM_TEST | 0 | 1/1 PASS (0 request trước khi bấm, 1 POST = 200, 2 package, ảnh `fmi01-live-table.png`, `fmi01-live-drawer.png`); fixture dọn, leftovers 0 |

`registry.ts` (backend / frontend) sha256 trước và sau mọi npm prehook: `c2a1dd6651a745b0…` / `a6d6dfa5d55806f4…` — **không đổi**. Mã đã cài (`installed-modules/*/backend|mic`) trùng nguồn được ghim (diff -r).

## 2. Ma trận T01–T22

| ID | Kết quả | Bằng chứng |
|---|---|---|
| T01 Không bấm thì không quét | PASS | Unit "T01" (dựng app không đọc folder/Registry); Playwright T01 (tải trang, đổi tab, reload: 0 POST, 0 GET); nút ẩn khi chỉ có READ |
| T02 Package hợp lệ | PASS | NEW_MODULE, 19/20 check PASS, MS-19 WARN (`TEST_EVIDENCE_UNVERIFIED`), `eligibleForPreflight=true`, SHA-256 thật. *Ghi chú:* `scanStatus` = WARN vì MIC-10 luôn chỉ là khai báo (khớp ví dụ trong 03_API_CONTRACT) |
| T03 Thiếu module.json | PASS | Folder vẫn được liệt kê, `MODULE_MANIFEST_MISSING`, INVALID_PACKAGE |
| T04 packageFormat sai | PASS | `PACKAGE_FORMAT_UNSUPPORTED` kèm expected/actual, không eligible |
| T05 Key khác tên folder | PASS | `MODULE_KEY_MISMATCH`, expected = folder, actual = key |
| T06 MIC JSON thiếu / sai | PASS | `MIC_FILE_MISSING`, `MIC_JSON_INVALID`, `MIC_SCHEMA_INVALID` (có field); MIC TS cũ của module đã đăng ký → WARN `LEGACY_MIC_FORMAT`, không import. Package thật SYSTEM_TEST / DATA_INSPECTOR vẫn được cài (T20) |
| T07 MIC01.version ≠ packageVersion | PASS | `MIC_IDENTITY_MISMATCH`, field `mic01Identity.moduleVersion`, expected 1.0.0 / actual 1.0.1 |
| T08 MIC07 sai K05 | PASS | `MIC_MAPPING_INVALID` / `IAM_MAPPING_K05_MISMATCH`, field `mic07IamMapping` |
| T09 MIC10 NOT_TESTED / PASS khai báo | PASS | WARN `TEST_EVIDENCE_PENDING` / `TEST_EVIDENCE_UNVERIFIED`; không có trạng thái READY |
| T10 Hai module trùng route | PASS | Cả hai FAIL `MODULE_ROUTE_CONFLICT`; route admin AppShell và route của module ACTIVE khác cũng FAIL |
| T11 Nâng cấp giữ route | PASS | UPGRADE_CANDIDATE, MS-16 PASS, MS-18 PASS (CHANGE đúng fromVersion) |
| T12 Registry lỗi | PASS | REGISTRY_UNKNOWN, MS-17/18 UNAVAILABLE, không NEW_MODULE, không eligible |
| T13 Phiên bản đã APPROVED/ACTIVE | PASS | EXISTING_VERSION + trạng thái, `VERSION_ALREADY_LOCKED`, `INTEGRITY_UNVERIFIED`, không eligible; OLDER_PACKAGE; 1.10.0 > 1.9.0 |
| T14 401 / thiếu một quyền | PASS | Unit: 401; READ-only, CREATE-only, không quyền → 403 + đúng 1 B08 DENIED `MODULE_PACKAGE.SCAN`; IAM lỗi → 503. **DB TEST:** 2 tài khoản bị từ chối → mỗi lượt đúng 1 dòng B08 DENIED, các bảng khác không đổi |
| T15 Hai POST đồng thời | PASS | Lượt 2 = 409 `SCAN_IN_PROGRESS`; khóa được giải phóng sau thành công và sau lỗi |
| T16 Một folder hỏng | PASS | Folder tốt vẫn được đánh giá; file ZIP ở gốc không bị coi là package |
| T17 Junction / .env / traversal / giới hạn | PASS | Junction ra ngoài → PATH_UNSAFE, không đọc; junction trong package → PATH_UNSAFE; `.env`, `*.key` → SENSITIVE_FILE, nội dung không lộ; body `{path:"C:\\"}` → 400; >1500 tệp → SCAN_LIMIT_EXCEEDED; >250 folder → 413. *Symlink tệp (cần quyền admin Windows):* NOT_TESTED — chỉ thử junction |
| T18 Sửa nội dung sau khi quét | PASS | Hash khác; snapshot cũ không tự cập nhật; tệp đổi giữa lúc liệt kê và lúc băm → `PACKAGE_CHANGED_DURING_SCAN`, hash null; hash độc lập thứ tự tạo tệp và CRLF/LF |
| T19 Quét được phép không ghi | PASS | Unit: chỉ SELECT, state FakeDb y nguyên, không B08; tệp package không đổi. **DB TEST:** số dòng B01–B14 và digest (B01/B02/B09) trước = sau |
| T20 Prehook sync không cài candidate | PASS | 6 test runtime guard (tái hiện rủi ro không khóa; có khóa: candidate bị bỏ qua, ghi đè folder đã triển khai → dừng trước khi xóa installed-modules, folder biến mất / khóa sai → dừng, CLI thiếu khóa → exit 1); repo thật (bước 06) |
| T21 UI drawer / trạng thái | PASS | Playwright: loading, 3 thanh, UNAVAILABLE riêng, tìm/lọc, drawer ≤ 680px bên phải, role dialog + aria-modal, focus, Escape, backdrop, nút ×, focus trả lại; 409/403/offline/hợp đồng sai/hết hạn/rỗng/401; mobile full-width |
| T22 Typecheck/build/regression | PASS* | Bước 01–05, 11–14 PASS. *Các lỗi còn lại không do FMI-01 — §3 |

## 3. Lỗi hồi quy còn lại (không do FMI-01)

| Lỗi | Nguyên nhân | Bằng chứng |
|---|---|---|
| FBE-06 V8, FBE-07 beforeAll | Đếm 2 permission DATA_INSPECTOR hợp lệ là dữ liệu thừa | Đã tái hiện y hệt tại HEAD `a65e673` (22/10, worktree sạch) |
| `auth-flow` (cấu hình Playwright mặc định) | Spec cần global setup của `playwright.auth.config.ts` | Đã đối chiếu tại HEAD trước đó |
| iam-admin "SYSTEM_TEST … DATA_VIEWER" | SYSTEM_TEST **1.1.1 đã ACTIVE** trên TEST (không còn DATA_VIEWER); test đọc phiên bản ACTIVE từ DB và còn kỳ vọng 1.0.3 | Test chỉ đọc DB, không dùng mã FMI-01; trạng thái ACTIVE xác nhận bằng truy vấn chỉ đọc |

## 4. Phát hiện thật trên TEST (scanner báo đúng)

Quét repo thật với Registry thật: DATA_INSPECTOR 0.1.0 = EXISTING_VERSION/ACTIVE/WARN; SYSTEM_TEST 1.1.1 = EXISTING_VERSION/ACTIVE/**FAIL** do `MODULE_ROUTE_CONFLICT`: module fixture `FBET_ST_MVJQQP1S_0383C3` (1.1.1 ACTIVE, để lại từ một lần chạy test DB SYSTEM_TEST bị dừng giữa chừng ngày 22/10) đang giữ `/system-test`, `/system-test/runner`. Nhiệm vụ này không được sửa dữ liệu Foundation → chưa xử lý; cần chủ dự án quyết định (RETIRE/DISABLE fixture qua API Foundation).

## 5. Chưa kiểm tra

- (Đã kiểm ở bước 15: giao diện + API trên ứng dụng đang chạy.)
- Symlink tệp trên Windows (cần quyền admin): NOT_TESTED.
- Bản build production chạy `node dist/server.js`: NOT_TESTED (scanner import `backend/scripts/*.mjs`, xem IMPLEMENTATION-REPORT §6).
