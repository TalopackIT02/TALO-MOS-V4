# DEPLOY GATE RESULT — RESTART TEST

```
GATE:      DEPLOY / RESTART TEST
STATUS:    PASS
TARGET:    TEST runtime trên máy local — Backend 127.0.0.1:3000 (npm run dev / tsx watch), Frontend 127.0.0.1:5173 (Vite dev),
           DB 127.0.0.1:5433/talo_mos_v4_test (không thay đổi)
APPROVAL:  chủ dự án, "DEPLOY / RESTART TEST APPROVAL", 27/10/2026
EXECUTED:  2026-10-27 22:35:27 → 22:35:58 (giờ máy), Control Center "RESTART WEB" (-Mode action -Action restart)
EVIDENCE:  D:\Documents\ClaudeProject\TALO-MOS-V4_exports\SCC_DEPLOY_GATE_20261027-223340\  (evidence-sha256.txt)
ROLLBACK:  đã chuẩn bị (snapshot source + hash cấu hình); KHÔNG cần chạy
NEXT:      dừng tại JOURNAL-APPROVAL
```

## 1. Phiên bản mã nguồn thực tế

| Mục | Giá trị |
|---|---|
| Branch / HEAD | `feat/iam-admin-inheritance-20261024` / `0e491a3fac77801488739f3cd95f99845bbcd69e` + thay đổi chưa commit |
| Snapshot để khôi phục | `source-snapshot/`: `tracked-changes.patch` (diff nhị phân so với HEAD), `untracked-files.tar` (20 file, liệt kê trong `untracked-files.txt`), `git-status.txt`, `snapshot.sha256` |
| Cấu hình (SHA-256 trước = sau) | `.env` `82bd1f7d…`; lock `backend/module-deployments.json` `d0835db3…`; registry frontend `1388cc35…`; registry backend `8e18efde…` |
| Module runtime (lock không đổi) | DATA_INSPECTOR 0.1.0 `45c4a3a0…`, **SYSTEM_CONTROLLER_CENTER 0.1.0 `f049fb88…`**, SYSTEM_TEST 1.1.1 `4cc97571…` |

## 2. Trạng thái trước / sau

| Mục | Trước | Sau |
|---|---|---|
| Backend | PID 19940 (con của `tsx watch` khởi động 26/10 16:20, tự nạp lại lúc 27/10 21:04:37) | Khởi động lại sạch 22:35:38; hiện PID 13564 (watch nạp lại 22:37:20, xem §5) |
| Frontend | Vite PID 33280 (từ 26/10 16:19) | Vite PID 40772 (22:35:47) |
| Log khởi động | — | Nạp IAM Management, 3 module package, `server started` trên `talo_mos_v4_test`; **0 dòng error / fatal** |
| DB (`snap.sh` + SCC state + `audit_api`) | — | **Giống hệt** trước restart. Số dòng **mọi bảng** sau hồi quy = lúc kết thúc DB Gate |
| Journal `d6fa3a06…` | `RECOVERY_REQUIRED`, `updatedAt` 2026-10-24T07:08:38Z | Không đổi |

## 3. Build và kiểm tra

| Lệnh | Exit | Kết quả |
|---|---|---|
| `backend: npm run build` | 0 | PASS |
| `backend: npm run typecheck` (src + test) | 0 | PASS |
| `frontend: npm run build` | 0 | PASS (99 modules) |
| Lock / registry sau build | — | Không đổi |

## 4. Smoke tests và xác minh chức năng

**Smoke không cần phiên** (`smoke.sh`, 16 kiểm tra): **16/16 PASS** ở cả 3 lần — trước restart, sau restart, cuối gate. Danh sách kiểm tra:
- Backend health 200.
- AppShell `/`, `/foundation/modules`, `/system-controller-center` trả 200.
- Auth session trả 401 `SESSION_INVALID`.
- Foundation modules / navigation trả 401.
- IAM capabilities trả 401.
- Installer:
  - runtime-release, journal, `continue` trả 401;
  - **`close-failed` trả 401 → route đã nạp**;
  - op không tồn tại trả 404 (đối chứng).
- Module Host SCC (audit / access / architecture) trả 401 → các route đã mount.

**IAM / Administrator Inheritance** (READ ONLY, code đã deploy: `loadAccessFacts` + `evaluateAccess` + alias Host, chạy bằng `talo_app`):
- Tài khoản `TALO_SYSTEM_ADMIN` (ACTIVE): ALLOW với Foundation registry.read / version.activate / navigation.manage, IAM permissions.manage, SCC audit_log / access_matrix / architecture, DATA_INSPECTOR catalog.
- Alias SCC 0.1.0 `system_controller_center.audit.read` được chuyển thành `audit_log.read` → ALLOW.
- Tài khoản `PENDING_MEMBERSHIP`: DENY toàn bộ (`ACCOUNT_NOT_ELIGIBLE`).

**Không gọi** `close-failed`. Log backend: 0 lời gọi `close-failed`, 0 request `/api/auth/login` trong khoảng deploy.

## 5. Regression

| Lệnh | Exit | Kết quả |
|---|---|---|
| `backend: npm test` | 0 | **465 passed / 0 failed / 172 skipped** |
| SCC contract (cấu hình preflight) | 0 | 14/14 |
| `npx playwright test --project=react-dev --project=react-preview` (chạy trên runtime mới) | 1 | **315 passed / 2 failed / 9 skipped / 6 did not run** |

Ghi chú:
- 2 lỗi Playwright là `auth-flow.e2e.spec.ts:38`, có từ trước. Spec cần biến `AUTH_E2E_FIXTURES` nên dừng trước khi gọi API; không có request login.
- `pretest` của `npm test` chạy `modules:sync`, ghi lại `src/installed-modules` với nội dung giống hệt. `tsx watch` nạp lại backend lúc 22:37:20 với **cùng package / hash** — registry và lock vẫn không đổi, smoke cuối gate 16/16.

## 6. Ghi nhận cần chủ dự án biết

1. **Runtime TEST là dev server có watch / HMR.**
   - Mọi lần lưu file trong `backend/src` hoặc `frontend/src`, hay mỗi lần chạy `npm test` / `modules:sync`, đều nạp thẳng vào runtime.
   - Hệ quả: code Installer (`close-failed`) đã **tự nạp vào runtime lúc 27/10 21:04:37**, trước khi có phê duyệt Deploy. Lúc đó tôi lưu file routes trong bước viết code.
   - Route không được gọi (log: 0 lời gọi; journal không đổi).
   - Gate này đã restart sạch và xác minh lại.
   - Đề xuất: khi cần cô lập triển khai, chạy TEST bằng bản build (`npm run build` + `npm start`) thay cho chế độ watch. Việc này cần quyết định riêng.
2. Chưa kiểm HTTP có phiên đăng nhập thật: đăng nhập sẽ ghi session và audit vào DB, mà gate này không cho phép ghi DB.
   - Trên TEST chỉ có 1 tài khoản ACTIVE (Administrator) và 0 Direct DENY, nên các ca Manager 403 và Direct DENY chưa thể kiểm live.
   - Hai ca này có unit test bao phủ, và được dời sang nghiệm thu runtime.
3. Runtime SCC vẫn là **0.1.0**, nên trang Audit Logs vẫn chưa đọc được dữ liệu cho đến khi cài 0.1.1.

## 7. Khôi phục (nếu cần)

Runtime trước gate này chạy **đúng source hiện tại** (đã tự nạp lúc 21:04:37), nên không có phiên bản runtime khác cần khôi phục.

Nếu cần quay lại trạng thái trước các sửa đổi của Claude Code:
- áp ngược `tracked-changes.patch` / `untracked-files.tar` theo `snapshot.sha256` (cần phê duyệt riêng vì ghi đè working tree);
- sau đó chạy Control Center RESTART WEB.

DB không bị thay đổi, nên không cần khôi phục DB.

## 8. Gate tiếp theo (chưa thực hiện)

**JOURNAL-APPROVAL:** gọi `POST /api/foundation/module-installations/d6fa3a06-1707-43c1-84bd-470b4107a78f/close-failed` `{acknowledge:true}` bằng phiên Administrator. Có thể thao tác qua nút "Đóng lượt cài đặt thất bại…" trong Candidate Workspace của candidate SCC 0.1.0.

Hệ quả dự kiến:
- SCC (đang enabled) bị DISABLE qua Lifecycle (B07 DISABLE + B08) cho đến khi cài 0.1.1;
- journal chuyển `FAILED_SAFE`;
- B02 0.1.0 vẫn ACTIVE; lock / release / B09 giữ nguyên.

Thao tác này cần phiên đăng nhập của chủ dự án, hoặc phê duyệt cho Claude Code dùng một phiên Administrator.
