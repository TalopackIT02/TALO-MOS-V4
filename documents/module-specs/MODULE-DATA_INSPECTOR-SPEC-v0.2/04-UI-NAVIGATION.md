# 04 — Giao diện AppShell và navigation

> TALO-MOS-V4 | DATA_INSPECTOR | Hồ sơ v0.2 DRAFT | Package/MIC dự kiến 0.1.0 | 22/10/2026 | Repo `main` `fafc4d5f5e0215d40dc9ee7308d23973d1a7b19d`
> USER REVISED SCOPE (22/10/2026). Chỉ thiết kế; không cấp IAM/SQL privileges, không sửa Foundation/Host, không deploy. Bằng chứng runtime: NOT_TESTED.

## UI cố định, không phát triển tính năng ngoài phạm vi

- Một Host screen `data.inspector`; route `/data-inspector`; menu label: **Trình xem PostgreSQL**; một tab **Xem dữ liệu**.
- Không tự dựng header/sidebar AppShell thứ hai. Bố cục 4-block AppShell (breadcrumb, title, tab, content) nếu Host hỗ trợ.
- Trong content: hai vùng bên trái–phải. Mobile: danh sách bảng đổi thành panel chọn; viewer chiếm chiều rộng còn lại.

```text
AppShell > Hệ thống > Trình xem PostgreSQL                  [CHỈ ĐỌC]
─────────────────────────────────────────────────────────────────────
Danh sách bảng (tất cả schema) |  schema.table  —  xem dữ liệu
[Tìm schema / tên bảng]        |  Cấu trúc: column, type, nullable, PK
───────────────────────────────┼─────────────────────────────────────
▸ iam.iam_user_accounts        |  Trang 1 / pageSize 50
  foundation.fnd_modules       |  [dữ liệu theo cột và hàng, chỉ đọc]
  pg_catalog.pg_class          |  [Trước]  [Tiếp]  [Làm mới]
  ...                          |
─────────────────────────────────────────────────────────────────────
```

Các tên bảng trong wireframe là **ví dụ có trong mã nguồn/tên Postgres**, không chứng minh danh mục live.

## Các trạng thái UI

| Trạng thái | Hiển thị |
|---|---|
| LOADING | Loading catalog/rows, không gọi GET trùng |
| EMPTY | Không có bảng phù hợp từ khóa |
| TABLE_NOT_READABLE | Tên bảng/cấu trúc có thể hiện; phần giá trị báo không được role PostgreSQL cấp SELECT |
| RLS_PARTIAL | Nếu biết, cảnh báo dữ liệu có thể bị RLS lọc; không tự tuyên bố toàn bộ |
| 401 | Session hết hạn, xử lý theo AppShell |
| 403 | Không có quyền, không hiển thị nội dung |
| 409 | Catalog thay đổi, yêu cầu làm mới |
| 503/TIMEOUT | Thông báo truy vấn bị giới hạn, không retry liên tục |

- Không có nút Thêm / Sửa / Xóa / Duyệt / Import / Export / Run SQL / Grant.
- Text/cell hiển thị ở chế độ không chỉnh sửa; giá trị NULL, JSON, bytea, timestamp phân biệt theo loại.
- Chuyển bảng reset phân trang, tái xác minh identity và quyền từng request.

## B09/MIC04

MIC04 duy nhất Function `CATALOG` có route `/data-inspector`; `ROWS.READ` là API data action không xuất menu riêng. B09 phải có item tương ứng và chỉ IAM grant cho `admin`; không sửa AppShell/Foundation code. Trường hợp grant cấp nhầm có thể lộ menu dù API vẫn 403, xem VD-04.
