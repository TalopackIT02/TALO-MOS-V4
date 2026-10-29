# MASTER DATA DÙNG CHUNG — 6 BẢNG v0.2-RC2 (ứng viên giữ nguyên từ RC1)

> **CHƯA DUYỆT.** Theo tóm tắt tiền kiểm, cả 6 bảng NEW trên TEST. Đó **không** phải phê duyệt để Customer sở hữu chúng hoặc tự tạo schema. Chưa chọn owner. Thiết kế Master Data là một track DDL riêng với quyền và dữ liệu seed độc lập.

> Trường PK `id` trong `ref_admin_units` và `ref_business_regions` được *đề xuất* đổi tên để tương thích naming. Các bảng mã tự nhiên (`country_code`, `bank_code`, `currency_code`) và bảng liên kết composite giữ nguyên tới khi phê duyệt.


## MD-01 — `ref_countries`

| Cột | Kiểu PostgreSQL | NULL | Khóa / FK | Ghi chú |
|---|---|---|---|---|
| country_code | char(2) | Không | PK |  |
| country_name | varchar(150) | Không | Tên |  |
| is_active | boolean | Không | DEFAULT TRUE |  |


## MD-02 — `ref_admin_units`

| Cột | Kiểu PostgreSQL | NULL | Khóa / FK | Ghi chú |
|---|---|---|---|---|
| admin_unit_id | uuid | Không | PK | [PENDING] rename id |
| country_code | char(2) | Không | FK → ref_countries.country_code |  |
| admin_code | varchar(30) | Không | Mã hành chính |  |
| admin_name | varchar(200) | Không | Tên |  |
| admin_level | varchar(30) | Không | Cấp hành chính |  |
| parent_id | uuid | Có | FK → ref_admin_units.admin_unit_id |  |
| valid_from | date | Có | Hiệu lực từ |  |
| valid_to | date | Có | Hiệu lực đến |  |
| is_active | boolean | Không | DEFAULT TRUE |  |


## MD-03 — `ref_business_regions`

| Cột | Kiểu PostgreSQL | NULL | Khóa / FK | Ghi chú |
|---|---|---|---|---|
| region_id | uuid | Không | PK | [PENDING] rename id |
| region_code | varchar(30) | Không | UNIQUE |  |
| region_name | varchar(150) | Không | Tên |  |
| parent_region_id | uuid | Có | FK → ref_business_regions.region_id |  |
| description | text | Có | Mô tả |  |
| is_active | boolean | Không | DEFAULT TRUE |  |


## MD-04 — `ref_region_members`

| Cột | Kiểu PostgreSQL | NULL | Khóa / FK | Ghi chú |
|---|---|---|---|---|
| region_id | uuid | Không | PK(composite), FK → ref_business_regions.region_id |  |
| admin_unit_id | uuid | Không | PK(composite), FK → ref_admin_units.admin_unit_id |  |


## MD-05 — `ref_banks`

| Cột | Kiểu PostgreSQL | NULL | Khóa / FK | Ghi chú |
|---|---|---|---|---|
| bank_code | varchar(30) | Không | PK |  |
| bank_name | varchar(255) | Không | Tên ngân hàng |  |
| short_name | varchar(100) | Có | Tên ngắn |  |
| is_active | boolean | Không | DEFAULT TRUE |  |


## MD-06 — `ref_currencies`

| Cột | Kiểu PostgreSQL | NULL | Khóa / FK | Ghi chú |
|---|---|---|---|---|
| currency_code | char(3) | Không | PK |  |
| currency_name | varchar(100) | Không | Tên tiền tệ |  |
| decimal_places | smallint | Không | CHECK >= 0 |  |
| is_active | boolean | Không | DEFAULT TRUE |  |
