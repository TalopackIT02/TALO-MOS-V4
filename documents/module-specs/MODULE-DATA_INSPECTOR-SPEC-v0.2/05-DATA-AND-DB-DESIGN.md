# 05 — PostgreSQL data contract — READ ONLY

> TALO-MOS-V4 | DATA_INSPECTOR | Hồ sơ v0.2 DRAFT | Package/MIC dự kiến 0.1.0 | 22/10/2026 | Repo `main` `fafc4d5f5e0215d40dc9ee7308d23973d1a7b19d`
> USER REVISED SCOPE (22/10/2026). Chỉ thiết kế; không cấp IAM/SQL privileges, không sửa Foundation/Host, không deploy. Bằng chứng runtime: NOT_TESTED.

## 1. Phạm vi catalog — ALL SCHEMAS

Đích là **một database hiện tại của backend**, không phải toàn cluster/mọi database. Query `pg_catalog` không ràng buộc schema application-only:

```sql
SELECT n.nspname AS schema_name, c.relname AS table_name,
       c.oid AS relation_oid, c.relkind,
       pg_catalog.has_table_privilege(c.oid, 'SELECT') AS can_select
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
ORDER BY n.nspname, c.relname;
```

`r` ordinary table (bao gồm partition leaf), `p` partitioned-table parent. Catalog có thể bao gồm `iam`, `foundation`, `public`, schema module, `pg_catalog`, `pg_toast` và schema tạm nếu tồn tại. Không tự loại bất kỳ schema nào vì các giới hạn thiết kế v0.1 trước đây đã được chủ dự án thay thế. **View, materialized view, sequence, foreign table không phải base/partitioned table theo truy vấn này; việc bao gồm chúng cần quyết định mới.**

Người dùng muốn thấy mọi bảng kể cả bảng không được SQL role SELECT; metadata trả về không đồng nghĩa SELECT giá trị. Truy vấn bằng tài khoản kết nối hiện hữu, tuyệt đối không chạy SET ROLE/superuser, không sửa GRANT, không disable RLS.

## 2. Đọc dữ liệu mỗi bảng

- `tableKey` do backend tạo từ OID + danh tính schema/table kiểm tra lại; ví dụ dạng `t_<oid>_<digest>` **không phải token quyền**.
- Trước truy vấn bất kỳ tableKey: verify `actor` là `admin` + IAM/lifecycle; re-resolve table từ `pg_class` theo OID bound; kiểm tra namespace, relkind, không stale/rename.
- Query cột qua `pg_attribute`, `pg_type` / `format_type`, `pg_index`, phát hiện cột bị DROP.
- Chỉ SELECT khi DB role có quyền phù hợp; nếu thiếu, hiển thị `NOT_READABLE`, không tự thử nâng quyền. Nếu chỉ có column SELECT, có thể hiển thị những cột có quyền và đánh dấu `PARTIAL`; không báo đây là toàn bộ dữ liệu. RLS tiếp tục có hiệu lực.
- **Dynamic SQL an toàn:** table/column identifiers phải lấy từ catalog server đã kiểm tra, escape double-quote đúng chuẩn; client không gửi SQL/identifier lắp thẳng vào lệnh. Dùng bind parameters cho LIMIT/OFFSET/search/OID; cấm `SELECT ${userInput}`.
- Phân trang `page` mặc định 1, `pageSize` mặc định 50, max 100, lấy `pageSize+1` rows làm `hasNext`; khi không có PK/unique ordering, báo thứ tự không ổn định. Tránh `COUNT(*)` trên bảng lớn; count nếu được trả về phải ghi rõ EXACT/ESTIMATE.
- `Host.readOnly` chạy `SET TRANSACTION READ ONLY` và statement timeout 5 giây theo repo. Query SQL vượt timeout => lỗi rõ ràng, không đổi Host timeout.

## 3. Database contract

| Resource hợp đồng MIC06 | Nguồn vật lý | Operation | Ownership |
|---|---|---|---|
| `TABLE_CATALOG` | `pg_class`, `pg_namespace`, quyền SQL | SELECT | DB/PostgreSQL; DATA_INSPECTOR chỉ sở hữu DTO |
| `COLUMN_CATALOG` | `pg_attribute`, `pg_index`, `pg_type` | SELECT | Bảng gốc thuộc owner riêng |
| `TABLE_PAGE` | Bảng chọn theo catalog, thông qua Host.readOnly | SELECT | Không chiếm quyền sở hữu bảng nguồn |

Các field MIC06 biểu thị **API projection**, không tạo bảng vật lý. Không có PK/FK/index/triggers/migration/seeds mới. Không ALTER IAM–Foundation. Không lưu bản sao dữ liệu, không cache disk/export.

## 4. Bảng chứa dữ liệu nhạy cảm

Duyệt `iam.iam_credentials`, `iam.iam_sessions` và các bảng nghiệp vụ có thể hiển thị hash/token/PII *nếu SQL role hiện hữu cho phép*. Hiện **không có phê duyệt riêng cho mask/loại cột**, và yêu cầu mới không nói loại trừ. Thiết kế không tự coi mọi giá trị là an toàn; đưa **rủi ro lộ thông tin nhạy cảm** vào Decision Log để Owner quyết định trước G7. Không log dữ liệu trả về.

## 5. Tính đầy đủ và giới hạn

- Catalog `ALL_SCHEMAS` là phạm vi truy vấn, chưa được xác nhận bằng database runtime; thiếu `USAGE`/catalog restrictions có thể làm sai lệch.
- Kết quả rows chỉ theo DB SELECT/RLS đang có. Nếu role không có SELECT **không thể đáp ứng 100% nội dung toàn DB** mà vẫn giữ ràng buộc không tự mở quyền. Báo không truy cập được thay vì bịa toàn bộ dữ liệu.
- Backup và rollback database: không áp dụng vì không tạo bất kỳ thay đổi persistent nào.
