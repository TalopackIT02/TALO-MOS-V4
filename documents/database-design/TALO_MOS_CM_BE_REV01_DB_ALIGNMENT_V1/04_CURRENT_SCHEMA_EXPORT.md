# Cách cung cấp schema DB hiện tại (KHÔNG cần dữ liệu khách hàng)

Đã có **SQL ứng viên REV01 R2** trong hội thoại, nên không cần bạn tự copy từng câu `CREATE TABLE`. Tuy nhiên, nó chưa thay thế được metadata của **TEST đã triển khai**. Claude Code đang ở máy Windows có Docker PostgreSQL, có thể làm việc này trực tiếp.

## Yêu cầu Claude xuất gói cấu trúc TEST

1. Kết nối **chỉ đọc** đúng `talo_mos_v4_test`, không DEV/PROD.
2. Lấy `pg_dump --schema-only --schema=cm --no-owner` từ PostgreSQL TEST, **không có row/data dump**.
3. Xuất thêm JSON/CSV catalog `pg_catalog` chứa: table/column/type/default/nullability, PK, FK, CHECK, indexes (đặc biệt partial), grants cột, owner, sequence và schema role. Truy vấn metadata không phải DML.
4. Đối chiếu `11 bảng / 114 cột / 25 index` và `cm.customer_code_seq`, so tên constraint/GRANT theo gói R2.
5. Trích fingerprint Foundation/IAM **metadata** trước/sau (không sửa chúng).
6. Tạo ZIP có báo cáo, dump **schema-only**, catalog và manifest SHA-256, không đưa mật khẩu, token, dữ liệu khách hàng.

### Lệnh mẫu cho Claude điều chỉnh theo Windows Git Bash

```bash
# Thực hiện ngoài repo, qua shell Git Bash (không dùng PowerShell 5.1 binary redirection).
# Xác nhận database trước bằng lệnh chỉ đọc:
docker exec talo-mos-v4-postgres psql -U admin -d talo_mos_v4_test -X -Atqc 'SELECT current_database(), current_setting('"'"'server_version'"'"');'
# Chỉ cấu trúc schema cm, có GRANT (không dùng --no-acl).
docker exec talo-mos-v4-postgres pg_dump -U admin -d talo_mos_v4_test   --schema-only --schema=cm --no-owner > cm_schema_TEST_20261029.sql
```

**Không** gửi dump dữ liệu (`pg_dump -Fc` toàn DB), `.env`, mật khẩu, tài khoản khách thật. Nếu file schema có tên/cấu trúc nhạy cảm ngoài CRM, rà soát trước khi chia sẻ.

Bạn có thể tải ZIP schema-only đó lên đây; hoặc để Claude đối chiếu trực tiếp trên máy và xuất báo cáo cùng gói migration. **Không cần chờ bạn tự trích thủ công từng bảng.**
