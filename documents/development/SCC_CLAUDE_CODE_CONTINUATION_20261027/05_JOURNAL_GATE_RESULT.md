# JOURNAL GATE RESULT — đóng lượt cài đặt SCC 0.1.0 thất bại

```
GATE:      JOURNAL-APPROVAL (close-failed d6fa3a06-1707-43c1-84bd-470b4107a78f)
STATUS:    PASS
TARGET:    TEST — Backend 127.0.0.1:3000, Frontend 127.0.0.1:5173, DB talo_mos_v4_test
APPROVAL:  chủ dự án, "JOURNAL GATE APPROVAL", 27/10/2026
EXECUTED:  2026-10-27T17:33:36Z (28/10 00:33:36 giờ máy) — chủ dự án bấm "Đóng lượt cài đặt" trên UI, đúng 1 lần
ACTOR:     0e7b0190-0173-4bc2-8e35-816730a4002b (TALO_SYSTEM_ADMIN, vai trò active, hiệu lực)
EVIDENCE:  D:\Documents\ClaudeProject\TALO-MOS-V4_exports\SCC_JOURNAL_GATE_20261027-230116\  (evidence-sha256.txt)
NEXT:      dừng tại SCC 0.1.1 INSTALLER-APPROVAL (06_SCC_011_INSTALLER_APPROVAL_PACK.md)
```

Claude Code không gọi `close-failed`, không sửa source, không restart, không ghi DB. Mọi truy vấn kiểm tra chạy trong giao dịch `read_only`.

## 1. Journal trước / sau

| Trường | Trước | Sau |
|---|---|---|
| `state` | `RECOVERY_REQUIRED` | **`FAILED_SAFE`** |
| `classification` / `recoveryPoint` / `rollback` | `NEW_MODULE` / null / null | không đổi |
| `after` | module `707cfbd8…`, version `928b3499…`, ACTIVE, enabled=false | không đổi |
| `updatedAt` | 2026-10-24T07:08:38.524Z | 2026-10-27T17:33:36.213Z |
| `recovery` | 3 dòng (nguyên nhân `ACCESS_VERIFIED`) | +3 dòng: người đóng, DISABLE qua Lifecycle, danh sách giữ nguyên, có thể lập kế hoạch mới |
| `history` | — | +1: `FAILED_SAFE` "failed NEW_MODULE installation closed (acknowledged); module disabled by this operation" |
| SHA-256 file | `ebba121e…` | `68f8d016…` |

Diff đầy đủ: `journal-diff.txt`. Chỉ 4 trường trên thay đổi.

## 2. HTTP response `close-failed`

```
POST /api/foundation/module-installations/d6fa3a06-1707-43c1-84bd-470b4107a78f/close-failed → 200 (173.9 ms)
requestId 0101459a-8ca3-4425-a9b1-0d9035810ce2
warn "module install closed as failed safe" disabledNow=true
```

- Body trả về là bản ghi journal mới, có nội dung = `journal-after.json`. Giao diện hiển thị thông báo khớp với `recovery`.
- Số lời gọi `close-failed` cho journal này trong log sau thao tác: **1**. Lời gọi còn lại là smoke `00000000-…`, trả 401.
- Log: 1043 info, 1 warn (dòng trên), **0 error / fatal**, 0 lần backend khởi động lại.

## 3. B01 / B02 trước / sau

| Mục | Trước | Sau |
|---|---|---|
| B01 SCC `is_enabled` | **true** (updated 2026-10-26 08:56:24Z) | **false** (2026-10-27 17:33:36Z) |
| B02 SCC 0.1.0 `928b3499…` | ACTIVE, manifest `8114f05f…`, activated 2026-10-24 07:08:37Z | **không đổi** |
| B02 phiên bản khác của SCC | không có | không có |

## 4. Bằng chứng audit

| Bảng | Trước | Sau | Bản ghi mới |
|---|---|---|---|
| B07 `fnd_module_events` (SCC) | 7 | 8 | `DISABLE` 17:33:36.166Z, actor `0e7b0190…` |
| B08 `fnd_audit_logs` (SCC) | 9 | 10 | `MODULE_REGISTRY.DISABLE` SUCCESS, target MODULE, 17:33:36.197Z, actor `0e7b0190…`, `talo-mos-backend` |
| `fnd_audit_logs` toàn bộ | 14559 | 14560 | chỉ dòng trên |
| `iam_audit_logs` | 149 | 151 | `LOGIN FAILURE` 17:31:01Z (không actor), `LOGIN SUCCESS` 17:31:10Z actor `0e7b0190…` |
| `iam_sessions` | 39 | 40 | phiên đăng nhập của chủ dự án |

Đây đều là các thay đổi trong phạm vi được duyệt: Lifecycle DISABLE kèm audit, cùng session và audit cho việc đăng nhập. Không có bản ghi nào bị xóa.

## 5. SCC và các module khác

- Module có `updated_at` thay đổi kể từ đầu gate: chỉ `SYSTEM_CONTROLLER_CENTER=false`. B07 kể từ đầu gate: chỉ `DISABLE@SYSTEM_CONTROLLER_CENTER`.
- Số module bật: 260/2083 → 259/2083, tức chỉ SCC.
- DATA_INSPECTOR 0.1.0 ACTIVE, tắt; SYSTEM_TEST 1.1.1 ACTIVE, tắt. Cả hai không đổi.
- B09 SCC: 6 mục, cả 6 hiển thị, không đổi. Menu vẫn còn, còn route / API trả `MODULE_UNAVAILABLE` vì module đang tắt.

## 6. Release, lock, runtime

| Mục | Giá trị | So với trước |
|---|---|---|
| Kho release `module-releases/SYSTEM_CONTROLLER_CENTER/0.1.0` | `f049fb88…` | bảo toàn |
| Snapshot candidate `5dd899ca…` | `f049fb88…` | bảo toàn |
| Lock `backend/module-deployments.json` | `d0835db3…` (SCC 0.1.0 `f049fb88…`) | không đổi |
| Registry frontend / backend | `1388cc35…` / `8e18efde…` | không đổi |
| Source `modules/SYSTEM_CONTROLLER_CENTER` | `e47e0084…` (0.1.1) | không đổi |

Smoke không cần phiên: **16/16 PASS** cả trước lẫn sau thao tác (`smoke-before.txt`, `smoke-after.txt`).

## 7. Ghi nhận ngoài lời gọi `close-failed`

Lúc 17:32:57Z, trước khi đóng journal, chủ dự án đã bấm **Kiểm tra & Chạy thử** trên candidate cũ `5dd899ca…`. Kết quả:

- Preflight run `0446a2a3…` kết luận `INVALIDATED`. P0 `PACKAGE_CHANGED`: source hiện là `e47e0084…` (0.1.1), trong khi candidate là 0.1.0 `f049fb88…`. Các bước P1–P8 không chạy.
- Candidate `5dd899ca…` chuyển `READY → INVALIDATED`.

Thao tác này chỉ ghi file trong `backend/var/installer/candidates/`, **không ghi DB**. Kết quả đúng thiết kế: candidate 0.1.0 vốn đã lỗi thời. Nó không ảnh hưởng tới bước nâng cấp, vì 0.1.1 cần candidate mới. Snapshot 0.1.0 và kho release vẫn nguyên hash.

## 8. Đối chiếu điều kiện bắt buộc

| Điều kiện | Kết quả |
|---|---|
| Journal sang `FAILED_SAFE` đúng quy trình | PASS: qua API chính thức, dưới module lock, có history |
| SCC có thể tạm DISABLED | Đã DISABLE qua Lifecycle (B07 + B08) |
| Release 0.1.0 được bảo toàn | PASS: `f049fb88…` |
| Không xóa journal / không sửa bằng SQL | PASS |
| Không bỏ qua kiểm tra quyền Administrator | PASS: actor TALO_SYSTEM_ADMIN, API kiểm `registry.read` + `version.activate` + `registry.disable` |
| Không mất khả năng nâng cấp 0.1.1 | PASS: `FAILED_SAFE` ∉ `OPEN_INSTALL`; không còn journal SCC nào mở; điểm phục hồi hợp lệ (lock 0.1.0 = B02 ACTIVE 0.1.0 = release `f049fb88…`) |
| Không đổi module khác / privileges / schema / source | PASS |

**Kết luận: JOURNAL GATE PASS.**

## 9. Chưa nghiệm thu

- **Việc xem dữ liệu qua giao diện SCC chưa nghiệm thu**, bao gồm trang Audit Logs SELECT qua `audit_api`. Runtime vẫn là 0.1.0, nay đang TẮT. Cần qua Installer Gate 0.1.1, rồi nghiệm thu runtime 6 màn hình.
- `ACCESS_VERIFIED` (403 ngày 24/10, trước Admin Inheritance `f41f368`) chưa được kiểm lại live. Việc này sẽ diễn ra ở hậu kiểm của lượt cài 0.1.1.
