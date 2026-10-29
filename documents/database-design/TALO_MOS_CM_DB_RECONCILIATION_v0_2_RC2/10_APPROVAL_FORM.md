# CUSTOMER MANAGEMENT — OWNER DESIGN APPROVAL

**TRẠNG THÁI HIỆN TẠI: `NOT APPROVED`.** Bảng dưới đây là mẫu ký duyệt, không phải quyết định của chủ dự án.

## Ghi nhận cơ sở
- Candidate: v0.2-RC2; 27 bảng; metadata TEST ngày 2026-10-29.
- Báo cáo nguồn: `evidence/CM_FOUNDATION_PREFLIGHT_REPORT.md`.
- Mọi thay đổi so với từ điển cột trong gói cần ghi ở phần `Owner-approved changes` bên dưới; không được tự sửa file gốc.

## Quyết định bắt buộc

| ID | Phương án đề xuất cần chủ dự án đánh dấu APPROVED/REJECTED/REVISE | Trạng thái |
|---|---|---|
| D-CM-01 | schema `cm`, owner NOLOGIN `talo_cm_owner` | PENDING |
| D-CM-02 | SQL Gate riêng FBE-01B; Foundation không tạo DDL | PENDING |
| D-CM-03 | actor `*_account_id uuid`, không FK IAM | PENDING |
| D-CM-04 | PK `<entity>_id` ứng viên; ngoại lệ `code` và composite | PENDING |
| D-CM-05 | Không `row_version`; chốt metadata theo từng bảng | PENDING |
| D-CM-06 | `status_code`/`is_hidden`/`is_active`/`retired_at` và chính sách DELETE | PENDING |
| D-CM-07 | schema `master_data`, owner NOLOGIN `talo_master_owner` | PENDING |
| D-CM-08 | Explicit GRANT theo bảng/cột, quyền IAM tách biệt | PENDING |
| D-CM-09 | Backend SQL thuần; không chỉnh Prisma trong giai đoạn này | PENDING |
| D-CM-10 | `source_module_code varchar(50)` hay `varchar(80)` | PENDING |
| D-CM-11 | Backend cấp mã khách hàng; DB UNIQUE | PENDING |
| D-CM-12 | Storage/file/PII policy (metadata only V1) | PENDING |
| D-CM-13 | Chỉ approved seed; Master danh mục phải có nguồn | PENDING |
| D-CM-14 | Target TEST only, không DEV/PROD | PENDING |
| D-CM-15 | Danh sách index và FK/constraint chốt theo dictionary | PENDING |

## Vấn đề nghiệp vụ bổ sung còn phải giải quyết trước DDL
- `cm_customer_group_members`: gỡ nhóm/gán lại theo cơ chế nào khi PK kép và hạn chế DELETE?
- `currency_code DEFAULT 'VND'`: có seed `VND` được duyệt trước khi sử dụng hay không?
- Thuộc tính `created_at`, `updated_at`, `retired_at` trên từng bảng: có/không, kiểu/NULL/default theo bảng.
- Tax number duplicate / điều kiện giao dịch: phần nào DB constraint, phần nào Backend validation?
- Quy tắc idempotency của hoạt động module tương lai: chưa tạo UNIQUE trước khi chốt contract.
- Các thay đổi tên/cột/type nếu có phải ghi rõ ở đây và trở thành bảng dictionary FINAL đã duyệt, không dùng candidate nguyên xi.

## Owner-approved changes
(Để trống cho đến khi chủ dự án ghi trực tiếp.)

## Approval
- Approved baseline file/hash: PENDING
- Decision date / approver: PENDING
- GO for SQL AUTHORING ONLY: **NO**
- GO for SQL EXECUTION: **NO**
