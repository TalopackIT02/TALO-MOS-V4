# 03 — Function, Action, IAM và điều kiện admin

> TALO-MOS-V4 | DATA_INSPECTOR | Hồ sơ v0.2 DRAFT | Package/MIC dự kiến 0.1.0 | 22/10/2026 | Repo `main` `fafc4d5f5e0215d40dc9ee7308d23973d1a7b19d`
> USER REVISED SCOPE (22/10/2026). Chỉ thiết kế; không cấp IAM/SQL privileges, không sửa Foundation/Host, không deploy. Bằng chứng runtime: NOT_TESTED.

## Function–Action catalog (định danh ổn định)

| Function | Action | Nature | IAM proposed permissionCode | MIC07 triple | Assurance |
|---|---|---|---|---|---|
| `CATALOG` | `READ` | READ | `data_inspector.catalog.read` | `DATA_INSPECTOR/CATALOG/READ` | 1 (proposed) |
| `ROWS` | `READ` | READ | `data_inspector.rows.read` | `DATA_INSPECTOR/ROWS/READ` | 1 (proposed) |

Các permissionCode **chưa được kiểm chứng tồn tại/được cấp**. MIC07 không chứa permissionCode và không tự cấp quyền.

## Hard-coded account gate (OWNER-confirmed; design only)

Nguồn identity duy nhất: `actor.userAccountId` của Host session, không đọc `username` do browser gửi. Qua `host.readOnly`, truy vấn **read-only và parameterized**:

```sql
SELECT a.username, a.account_status, a.disabled_at
FROM iam.iam_user_accounts AS a
WHERE a.user_account_id = $1::uuid;
```

So sánh nghiêm `username === 'admin'`, đúng một account record, status `ACTIVE`, disabled_at NULL. Bất thường/SQL thiếu SELECT => fail closed, không dùng hard-coded `userAccountId` tự bịa hoặc `isAdmin` bypass. Việc DB role có SELECT vào bảng IAM này **chưa được kiểm tra thực tế**, cấm tự GRANT.

Trình tự mỗi API: `Host.session -> Host.authorize(permission) -> Host.lifecycle('DATA_INSPECTOR') -> hard-coded admin gate via readOnly -> validate tableKey -> readOnly SELECT -> response`. Nếu backend Host có thứ tự an toàn chặt hơn, không được bỏ bất kỳ gate nào. Direct DENY luôn thắng.

## Hiển thị menu — hạn chế kiến trúc xác minh

Đã kiểm tra `foundation.navigation.service.ts`: Menu B09 dùng IAM requirement MIC07, không có predicate username. Do đó module riêng **không thể tự hardcode bộ lọc menu toàn AppShell**. Có hai mức:

1. **Không sửa Foundation (phương án trong scope):** qua *quy trình IAM riêng được phê duyệt*, định nghĩa 2 permission và **direct ALLOW riêng account `admin`, không cấp qua role chung, không grant tài khoản khác**. Khi chỉ admin được phép theo IAM, B09 chỉ hiện cho admin. Backend vẫn kiểm username, ngăn lỗi cấp quyền nhầm dẫn tới đọc dữ liệu. Không tự thực hiện cấp quyền trong task này.
2. **Nếu yêu cầu guarantee “kể cả ai đó cấp nhầm quyền IAM thì menu tuyệt đối không xuất hiện”:** cần sửa cách lọc navigation của Foundation hoặc một cơ chế Host đã duyệt. Điều này **ngoài scope/blocked** và tuyệt đối không được âm thầm sửa Foundation.

Frontend nếu nhận session username `admin` có thể ẩn nội dung module trước khi fetch (UX only); **không thể** coi đó là giải pháp menu/server security.

## Negative permission cases

| Actor / condition | Menu Foundation | Backend |
|---|---|---|
| `admin` có direct ALLOW và không DENY | Hiện nếu ACTIVE/ENABLED, B09 đủ điều kiện | ALLOW nếu DB SELECT hợp lệ |
| Account khác không có grant | Không hiện | 403 IAM |
| Account khác bị cấp nhầm ALLOW | **Có thể hiện** do hạn chế B09 hiện tại | **403 qua username hardcode** |
| `admin` bị direct DENY | Không hiện | 403 IAM |
| `admin` disabled/revoked/assurance thấp | Không hiện | 401/403 |
| Module disabled hoặc activeVersions != 1 | Không hiện | 503/deny fail closed |
