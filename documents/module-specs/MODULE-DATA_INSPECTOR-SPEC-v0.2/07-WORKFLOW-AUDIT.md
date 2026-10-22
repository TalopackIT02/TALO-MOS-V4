# 07 — Workflow đọc và audit

> TALO-MOS-V4 | DATA_INSPECTOR | Hồ sơ v0.2 DRAFT | Package/MIC dự kiến 0.1.0 | 22/10/2026 | Repo `main` `fafc4d5f5e0215d40dc9ee7308d23973d1a7b19d`
> USER REVISED SCOPE (22/10/2026). Chỉ thiết kế; không cấp IAM/SQL privileges, không sửa Foundation/Host, không deploy. Bằng chứng runtime: NOT_TESTED.

## Workflow (không có nghiệp vụ thay đổi trạng thái DB)

`OPEN_SCREEN -> AUTHORIZED -> CATALOG_VISIBLE -> TABLE_SELECTED -> COLUMNS_VISIBLE -> ROWS_VISIBLE/PAGE_NEXT`. Lỗi: `SESSION_INVALID`, `IAM_DENIED`, `NOT_ADMIN`, `LIFECYCLE_DENIED`, `TABLE_NOT_READABLE`, `CATALOG_CHANGED`, `QUERY_TIMEOUT` -> không cấp thêm quyền và không chạy mutation.

**Per-request flow:**

1. Host lấy actor session; IAM authorize tương ứng Function.Action (direct DENY ưu tiên).
2. Host lifecycle `ENABLED + 1 ACTIVE`; fail closed.
3. Dùng Host.readOnly truy vấn `iam.iam_user_accounts` bằng actor.userAccountId; so sánh username **exact** `admin`, trạng thái ACTIVE, không disabled.
4. Nếu danh sách bảng: truy vấn `pg_catalog` trên mọi schema, trả status per table.
5. Nếu xem bảng: revalidate `tableKey` -> quyền SQL column/table -> SELECT bounded / RLS; không nâng quyền.
6. Chuẩn hóa DTO, không ghi row values ra log.

Không có approve/reject, không có idempotent write hay transaction mutations. Mọi truy vấn DB bên trong transaction read-only của Host; không persistent business audit trừ cơ chế đã được chấp thuận.

## Audit/log contract

- IAM deny qua `Host.authorize` dùng AccessGuard/audit DENIED hiện có.
- Điều kiện `NOT_ADMIN` sau IAM chưa có audit Success/Denied universal qua Host. Chỉ ghi event `DATA_INSPECTOR.ACCESS_DENIED` bằng logger nếu policy chấp nhận; log actor accountId, requestId, route, outcome, không ghi username đáng tin client hay giá trị dòng.
- Logging/read audit thành công nếu muốn durable storage trong Foundation là ngoài scope; không INSERT thẳng vào `iam.iam_audit_logs`/Foundation.
- Event codes MIC08 đề xuất: `DATA_INSPECTOR.CATALOG.READ`, `DATA_INSPECTOR.ROWS.READ`, `DATA_INSPECTOR.ACCESS_DENIED`. Không khẳng định đã có audit persistence.
- No body logging, no credential/token/password hash logging, no telemetry chứa row data. Retention của log theo nền tảng hiện hữu, chưa chốt retention mới.

## Race/error

- Mỗi request tái xác minh admin/IAM/lifecycle, không cache đặc quyền ở frontend.
- Đổi quyền/rename/drop table giữa metadata và SELECT => fail closed, lỗi CATALOG_CHANGED/TABLE_NOT_READABLE.
- Nếu username admin bị đổi/reassigned giữa hai requests, request tiếp theo dùng trạng thái DB mới. Bảo đảm chặt hơn trong một transaction hoặc session pinning cần test; không tự mở rộng Host.
