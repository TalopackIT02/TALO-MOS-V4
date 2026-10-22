# 06 — REST API — chỉ GET

> TALO-MOS-V4 | DATA_INSPECTOR | Hồ sơ v0.2 DRAFT | Package/MIC dự kiến 0.1.0 | 22/10/2026 | Repo `main` `fafc4d5f5e0215d40dc9ee7308d23973d1a7b19d`
> USER REVISED SCOPE (22/10/2026). Chỉ thiết kế; không cấp IAM/SQL privileges, không sửa Foundation/Host, không deploy. Bằng chứng runtime: NOT_TESTED.

## Endpoint catalog

| Method/Path | Function.Action | Required permission |
|---|---|---|
| `GET /api/data-inspector/tables` | `CATALOG.READ` | `data_inspector.catalog.read` |
| `GET /api/data-inspector/tables/{tableKey}/columns` | `CATALOG.READ` | `data_inspector.catalog.read` |
| `GET /api/data-inspector/tables/{tableKey}/rows?page=1&pageSize=50` | `ROWS.READ` | `data_inspector.rows.read` |

**All endpoints:** `Host.session -> Host.authorize -> Host.lifecycle -> hardcoded database username === 'admin' -> Host.readOnly SQL -> response`. Every endpoint independently checks. Host session actor only contains userAccountId/assuranceLevel/requestId; no username field; lookup is server side. Do not use user-controlled accountId.

## Contract payloads (ví dụ tổng hợp, KHÔNG PHẢI DB đã truy vấn)

**Tables response**

```json
{
  "scope": "CURRENT_DATABASE_ALL_SCHEMAS",
  "tables": [
    {"tableKey":"t_12345_0123456789abcdef","schema":"foundation","table":"fnd_modules","kind":"BASE_TABLE","readStatus":"READABLE"}
  ],
  "catalogComplete": true
}
```

`catalogComplete=true` chỉ khi query metadata kết thúc thành công, không có lọc server-side schema. Giá trị readStatus: `READABLE`, `PARTIAL`, `NOT_READABLE`, `UNKNOWN`; không lờ bảng không có SELECT. `?q=` search tên/schema (bounded, parameterized) là lọc người dùng, không được thay đổi inventory nguồn.

**Columns response**

```json
{"tableKey":"t_12345_0123456789abcdef","columns":[{"name":"module_key","dataType":"text","ordinalPosition":1,"nullable":false,"primaryKey":false,"selectPrivilege":true}]}
```

**Rows response**

```json
{
  "tableKey":"t_12345_0123456789abcdef",
  "page":1,"pageSize":50,"hasNext":false,
  "columns":["module_key"],
  "rows":[{"cells":["EXAMPLE_ONLY"]}],
  "rowVisibility":"DB_ROLE_AND_RLS",
  "ordering":"UNSTABLE_NO_KEY"
}
```

Không lấy schema/table/raw SQL từ query để cấu thành identifier. `tableKey` có thể bị stale => 409. Values và keys chỉ illustrative.

## Error envelope, validation, no mutation

```json
{"error":{"code":"FORBIDDEN","message":"Không có quyền truy cập.","requestId":"example"}}
```

| HTTP | Code | Nội dung |
|---|---|---|
| 400 | `VALIDATION_ERROR` | page/pageSize/tableKey/search không hợp lệ |
| 401 | `SESSION_INVALID` | Hết session (Host-owned) |
| 403 | `FORBIDDEN` | Không phải admin hoặc IAM DENY; không trả bảng |
| 403 | `TABLE_NOT_READABLE` | DB role không thể SELECT dữ liệu bảng |
| 404 | `TABLE_NOT_FOUND` | Không có bảng theo key |
| 409 | `CATALOG_CHANGED` | OID/schema/table đã đổi |
| 503 | `SERVICE_BUSY` / `QUERY_TIMEOUT` | IAM/DB/lifecycle/busy; fail closed |

Không endpoint POST/PUT/PATCH/DELETE. HTTP status/code riêng là **PROPOSED** (cần đối chiếu error envelope thực của module Host khi coding). GET không retry tự động không giới hạn. Không đưa thông tin DB credential/query raw lên error.

## Điều kiện read-only

Chỉ thực thi `SELECT` cố định vào catalog/table được server xác thực. `Host.readOnly` read-only transaction + timeout. Không `SELECT *` từ identifier client; không SQL console. Trả page bounded, không export/tải file.
