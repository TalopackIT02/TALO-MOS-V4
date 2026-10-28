# SCC 0.1.1 INSTALLER-APPROVAL — hồ sơ nâng cấp (CHƯA THỰC HIỆN)

```
GATE:     SCC 0.1.1 INSTALLER-APPROVAL
STATUS:   CHỜ PHÊ DUYỆT — chưa quét, chưa tạo candidate, chưa preflight, chưa lập kế hoạch
TARGET:   TEST — talo_mos_v4_test, Backend :3000 / Frontend :5173 (dev watch / HMR)
UPGRADE:  SYSTEM_CONTROLLER_CENTER 0.1.0 (ACTIVE, đang TẮT) → 0.1.1, package hash e47e0084f5e0de3c5dd05e1a43126e0ccc4910f44b214ad3b3c44709bfa0ea51
```

## 1. Trạng thái xuất phát (đã xác minh sau Journal Gate)

| Mục | Giá trị |
|---|---|
| B01 SCC `707cfbd8…` | đã đăng ký, `is_enabled=false` |
| B02 | 0.1.0 `928b3499…` ACTIVE (MIC `8114f05f…`); chưa có 0.1.1 |
| Lock | SCC 0.1.0 `f049fb88…` (file `d0835db3…`) |
| Kho release | `module-releases/SYSTEM_CONTROLLER_CENTER/0.1.0` = `f049fb88…`; chưa có `0.1.1` |
| Journal SCC | chỉ có `d6fa3a06…` ở trạng thái `FAILED_SAFE` (không còn lượt mở) |
| Candidate cũ `5dd899ca…` | `INVALIDATED` (0.1.0); không dùng lại |
| Source `modules/SYSTEM_CONTROLLER_CENTER` | 0.1.1, `e47e0084…`, PACKAGE_FILES_SHA256 49 mục, SCC contract 14/14 |
| DB | `audit_api` + `talo_audit_reader` đã có (DB Gate PASS) |

## 2. Đối chiếu blocker của Installer (`blockersFor`), dự kiến

| Blocker | Dự kiến | Căn cứ |
|---|---|---|
| `WRONG_DB_TARGET` | không | runtime = `talo_mos_v4_test` |
| `CANDIDATE_NOT_READY` / `EVIDENCE_INVALID` | không, **nếu** preflight mới READY | cần quét lại và tạo candidate mới cho `e47e0084…` |
| `PACKAGE_CHANGED` | không, **nếu** không ai sửa `modules/SYSTEM_CONTROLLER_CENTER` từ lúc quét đến lúc commit | hash nguồn được so lại khi commit |
| `UPGRADE_RECOVERY_UNAVAILABLE` | không | lock 0.1.0 = B02 ACTIVE 0.1.0, release `f049fb88…` có trong kho, cùng hash |
| `VERSION_LOCKED` / `RELEASE_CONFLICT` | không | B02 và kho release chưa có 0.1.1 |
| `MODULE_ROUTE_CONFLICT` | không | 6 route `/system-controller-center*` chỉ thuộc SCC |
| `ACTOR_PERMISSION_MISSING` | không | TALO_SYSTEM_ADMIN kế thừa mọi quyền, gồm `foundation.module_version.retire` |
| `IAM_DB_GRANT_MISSING` | không | D2 đã PASS (REV-01 closure) |
| `RUNTIME_RESTART_PENDING` | không | runtime khớp lock |
| `INSTALL_IN_PROGRESS` | **không**, nhờ Journal Gate | `FAILED_SAFE` ∉ `OPEN_INSTALL` |

Cảnh báo dự kiến: "Nâng cấp 0.1.0 → 0.1.1: nếu thất bại sau restart, trình cài đặt phục hồi 0.1.0 …", cùng "cần restart thủ công sau bước LOCK".

## 3. Khác biệt 0.1.0 → 0.1.1

| MIC | Thay đổi |
|---|---|
| MIC-01 | `moduleVersion` 0.1.1 |
| MIC-05 | `readProbe` cho `architecture/functions` (`moduleKey`), `access/matrix` (`accountId`) và `audit/logs` (assert `complete=true`, FOUNDATION / IAM `AVAILABLE`). Đây là chỗ sửa hai lỗi 400 của lần hậu kiểm 24/10 |
| MIC-09 | `CHANGE` từ 0.1.0 |
| MIC-02/03/04/06/07/08 | **giống hệt**. IAM catalog: 0 quyền mới; route / menu không đổi |

Code: Audit Logs đọc qua `audit_api` (SECURITY DEFINER), quyền canonical `audit_log.read` (không cần alias Host), Access Matrix có `viaAdministrator`, lỗi được phân loại theo SQLSTATE.

## 4. Trình tự thực hiện (sau khi được duyệt)

| # | Bước | Người làm | Ghi chú / thay đổi |
|---|---|---|---|
| 0 | Precheck read-only + backup DB (`pg_dump` + globals, thử restore vào DB tạm như DB Gate) + hash lock / registry / release | Claude Code | dừng nếu lệch §1 |
| 1 | Quét Module, tạo candidate SCC 0.1.1 (hash phải = `e47e0084…`) | chủ dự án (UI) | chỉ ghi `var/installer` |
| 2 | Kiểm tra & Chạy thử → phải **READY** | chủ dự án (UI) | P3 chạy test package; không ghi DB |
| 3 | Lập kế hoạch → **0 blocker**, xem MIC diff và navigation plan | chủ dự án (UI) | dừng nếu có blocker |
| 4 | Commit (xác nhận) | chủ dự án (UI) | ghi release 0.1.1; B02 DRAFT 0.1.1 → MIC → SUBMIT → APPROVE (B07 / B08); điểm phục hồi (enabled=false); lock → 0.1.1 → `AWAITING_RESTART` |
| 5 | Restart TEST (Control Center RESTART WEB) | Claude Code | `modules:sync` nạp 0.1.1 từ kho release |
| 6 | Tiếp tục | chủ dự án (UI), cần phiên Admin vì `ACCESS_VERIFIED` dùng cookie của chính người bấm | ACTIVATE 0.1.1 (0.1.0 → RETIRED, có nhật ký) → ENABLE → IAM catalog (0 mới) → B09 → hậu kiểm |
| 7 | Hậu kiểm thu bằng chứng: journal, B01/B02/B07/B08/B09, lock, release, smoke, log | Claude Code | read-only |

Kết quả hợp lệ:
- **`INSTALLED_ACTIVE`**: 8/8 API GET trả 200 với phiên Admin và các assertion Audit Logs đạt.
- `POSTCHECK_INCOMPLETE`: còn `NOT_TESTED`. Dừng lại và báo cáo.

Nếu thất bại sau restart (ACTIVATE / ENABLE / IAM / B09 / hậu kiểm FAIL), trình cài đặt tự phục hồi:
- Lifecycle `recoverUpgrade`: 0.1.1 RETIRED, 0.1.0 ACTIVE lại (B07 ROLLBACK + B08);
- B01 tắt lại;
- ẩn link B09 do lượt này thêm;
- lock trở về 0.1.0 `f049fb88…`, rồi chuyển `RECOVERY_AWAITING_RESTART`.

Sau đó Claude Code restart lần 2, chủ dự án bấm **Tiếp tục** để có `RECOVERED`. Không đoán, không sửa SQL tay.

## 5. Rủi ro đã biết

1. **Dev watch / HMR:** trong suốt gate, không lưu file `backend/src` / `frontend/src` / `modules/` và không chạy `npm test` (`pretest` gọi `modules:sync`). Lý do: sẽ gây reload hoặc `PACKAGE_CHANGED`.
2. Hậu kiểm `ACCESS_VERIFIED` gọi thật 8 API SCC với phiên Admin. Bất kỳ 5xx hoặc assertion sai nào cũng dẫn tới rollback về 0.1.0.
   - Đã kiểm trước: probe EXPLAIN 21/21 OK bằng `talo_app`; service end-to-end trên bản sao cô lập PASS.
   - Cửa sổ mặc định của Audit Logs có thể trả 0 dòng. Điều đó vẫn hợp lệ vì assertion chỉ đòi `AVAILABLE`.
3. Nếu thành công, 0.1.0 thành RETIRED. Không có đường RETIRED → ACTIVE ngoài rollback của chính lượt này.
4. SCC sẽ được **BẬT** ở bước 6. Trước đó, SCC đang tắt.

## 6. Nội dung xin phê duyệt

1. Claude Code chạy bước 0 (backup + precheck) và bước 5, cùng restart lần 2 nếu phải phục hồi.
2. Chủ dự án thao tác UI các bước 1–4 và 6. Mỗi bước chỉ một lần; dừng nếu kết quả khác dự kiến.
3. Cho phép các ghi do Installer thực hiện qua service chính thức:
   - B02 0.1.1 (DRAFT → ACTIVE), 0.1.0 → RETIRED;
   - B01 ENABLE;
   - B07 / B08;
   - B09 qua Navigation Builder;
   - session / IAM audit;
   - file: `module-releases/SYSTEM_CONTROLLER_CENTER/0.1.1`, `module-deployments.json`, `src/installed-modules`, `var/installer`.
4. Giữ nguyên các giới hạn:
   - không đổi privileges / schema;
   - không sửa source;
   - không đổi module khác;
   - không gán quyền IAM;
   - không commit / push / merge;
   - không sang Gate nghiệm thu runtime 6 màn hình khi chưa được duyệt.
