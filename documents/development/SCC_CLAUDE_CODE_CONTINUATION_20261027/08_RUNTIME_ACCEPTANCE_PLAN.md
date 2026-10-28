# RUNTIME ACCEPTANCE GATE — kế hoạch nghiệm thu 6 chức năng SCC 0.1.1 (CHƯA THỰC HIỆN)

```
GATE:     SCC RUNTIME ACCEPTANCE
STATUS:   CHỜ PHÊ DUYỆT
TARGET:   TEST — http://127.0.0.1:5173/system-controller-center (SCC 0.1.1 ACTIVE, đang bật)
TIỀN ĐỀ:  Installer Gate PASS (07_INSTALLER_GATE_RESULT.md)
```

## 1. Điều kiện bắt đầu (Claude Code kiểm tra READ ONLY ngay trước khi nghiệm thu)

1. Journal `8f22fc3b…` vẫn `INSTALLED_ACTIVE`; B01 SCC bật; B02 0.1.1 ACTIVE; lock và runtime đều ở 0.1.1 `e47e0084…`.
2. ACL PostgreSQL giống lúc kết thúc DB Gate; `audit_api` còn đủ 3 hàm.
3. Smoke 16/16; log backend từ lúc restart không có `42501`, error hay 5xx.
4. **Không bật / tắt module, không chạy Installer, không lưu file source, không chạy `npm test`** trong suốt gate (runtime đang ở chế độ watch).
5. Chủ dự án đăng nhập bằng tài khoản TALO_SYSTEM_ADMIN.

## 2. Nghiệm thu từng màn hình

Chủ dự án thao tác. Claude Code đối chiếu với log backend (status / requestId) và với số liệu đếm READ ONLY trong DB.

| # | Menu / route | API | Tiêu chí PASS |
|---|---|---|---|
| 1 | **Sức khỏe hệ thống** `/system-controller-center` | `GET /health`, `POST /checks/run` (chỉ đọc, không ghi DB) | Trang tải 200. "Chạy kiểm tra" trả kết quả; mục audit hiển thị AVAILABLE (denied / failures là số thật); không có FAIL do quyền DB |
| 2 | **Báo cáo kiểm thử** `/system-controller-center/tests` | `GET /results` | Hiển thị kết quả có sẵn, hoặc trạng thái "chưa có" một cách rõ ràng; không có lỗi 5xx |
| 3 | **Dữ liệu hệ thống (Data Inspection)** `/system-controller-center/data` | `GET /data/tables`, `…/{table}/columns`, `…/{table}/rows` | Danh mục bảng có trạng thái quyền đúng như bảng §3. Mở được dữ liệu thật của một bảng READABLE, ví dụ `foundation.fnd_modules` (≈2083 dòng, có phân trang). Các bảng IAM nhạy cảm hiển thị `[ACCOUNT_PROTECTED]` ở cột được che. Bảng NOT_READABLE hiện thông báo `TABLE_NOT_READABLE`, không phải lỗi 5xx |
| 4 | **Foundation & Module** `/system-controller-center/architecture` | `GET /architecture/modules`, `/functions?moduleKey=` | SCC hiển thị 0.1.1 ACTIVE; DATA_INSPECTOR / SYSTEM_TEST hiển thị ACTIVE và đang tắt; danh sách chức năng của SCC có 7 mục |
| 5 | **Ma trận phân quyền** `/system-controller-center/access` | `GET /access/accounts`, `/access/matrix?accountId=` | Tài khoản Admin có "Admin kế thừa = Có" và "Nguồn hiệu lực" ở trạng thái ALLOW cho 7 quyền SCC. Tài khoản `PENDING_MEMBERSHIP` bị từ chối |
| 6 | **Nhật ký hệ thống (Audit Logs)** `/system-controller-center/logs` | `GET /audit/logs` | `complete=true`; FOUNDATION và IAM đều AVAILABLE. Cửa sổ 24 giờ phải thấy các sự kiện thật của lượt cài đặt (`MODULE_VERSION.ACTIVATE`, `MODULE_REGISTRY.ENABLE` lúc 06:43Z ngày 28/10) và `LOGIN`. Cửa sổ 31 ngày có phân trang. Bộ lọc ISSUES / action / outcome hoạt động; drawer chi tiết mở được. Số sự kiện khớp số đếm READ ONLY trong DB cho cùng cửa sổ |

Ca âm tính có thể kiểm live:
- Không có phiên → 401. Smoke đã bao phủ ca này.
- Truy vấn sai tham số, ví dụ khoảng thời gian > 31 ngày → `VALIDATION_ERROR` 400 / 22023, có thông báo rõ.

Ca chưa kiểm được live vì TEST chỉ có 1 tài khoản ACTIVE và 0 Direct DENY:
- Manager 403 (`ADMIN_ROLE_REQUIRED`);
- Direct DENY thắng.

Muốn kiểm hai ca này cần một quyết định riêng: tạo tài khoản hoặc gán DENY trên TEST.

## 3. Trạng thái quyền SELECT của `talo_app` (đây là thiết kế, không phải lỗi)

| Trạng thái | Bảng |
|---|---|
| READABLE | `fnd_actions`, `fnd_compatibility_changes`, `fnd_compatibility_checks`, `fnd_data_contracts`, `fnd_data_fields`, `fnd_functions`, `fnd_module_versions`, `fnd_modules`, `fnd_navigation_items`, `fnd_version_actions`, `fnd_version_functions`; `iam_credentials`*, `iam_memberships`, `iam_permissions`, `iam_role_permissions`, `iam_roles`, `iam_sessions`*, `iam_user_accounts`*, `iam_user_permissions`, `iam_user_roles` (* có che) |
| NOT_READABLE | `fnd_audit_logs`, `iam_audit_logs` (chỉ đọc qua `audit_api` ở màn hình Audit Logs), `fnd_module_events`, `fnd_data_access_rules`, `iam_account_verifications` |

Nếu cần xem dữ liệu thô của các bảng NOT_READABLE ở màn hình Data Inspection, phải mở một **DB Gate mới**. Việc này không nằm trong gói 0.1.1.

## 4. Bằng chứng sẽ thu

- Ảnh chụp 6 màn hình (do chủ dự án cung cấp, hoặc Playwright chạy bằng phiên của chủ dự án nếu được phê duyệt).
- Đoạn log backend của từng requestId: status, không có 42501 / 5xx.
- Đối chiếu số liệu: số sự kiện audit theo cửa sổ, số dòng `fnd_modules` và trạng thái module giữa giao diện và DB (READ ONLY).
- Trạng thái lifecycle trước / sau gate phải giống hệt nhau: gate chỉ đọc.

Kết luận PASS / FAIL theo từng màn hình. **Chỉ khi màn hình 6 (Audit Logs) và màn hình 3 (Data Inspection) PASS trên giao diện, lỗi SELECT mới được coi là đã khắc phục.**

## 5. Nội dung xin phê duyệt

1. Thực hiện kế hoạch §1–§4 trên TEST.
2. Chỉ thao tác đọc. `POST /checks/run` là thao tác chỉ đọc. Các ghi phát sinh tất yếu chỉ gồm session / LOGIN audit của chủ dự án.
3. Tùy chọn: cho phép Claude Code chạy Playwright chụp màn hình bằng phiên do chủ dự án cung cấp. Nếu không, chủ dự án tự chụp.
4. Không commit / push / merge. Không sang Git Gate khi chưa được duyệt.
