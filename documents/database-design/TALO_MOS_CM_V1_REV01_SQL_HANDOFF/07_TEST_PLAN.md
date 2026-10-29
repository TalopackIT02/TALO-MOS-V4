# 07 — Test plan, V1 (SQL+Backend acceptance)
| ID | Kiểm thử | Kỳ vọng / cấp |
|---|---|---|
| TC-01 | Tạo khách đầu tiên | `customer_code=000001` / DB |
| TC-02 | Hai giao dịch đồng thời | Không trùng customer_code, sequence NO CYCLE / DB |
| TC-03 | MST 10 số sai cấu trúc/checksum | Không tạo hồ sơ chính thức / Backend+DB |
| TC-04 | MST trùng kể cả khách ẩn | UNIQUE ngăn trùng / DB |
| TC-05 | MST 13 số | Chuẩn hóa, phần gốc & hậu tố phù hợp / Backend |
| TC-06 | VN personal ID 12 số | Không gọi validator checksum MST / Backend |
| TC-07 | Foreign no VN registration | Luồng quốc gia+địa chỉ nước ngoài, không bắt MST Việt Nam / Backend |
| TC-08 | Đổi tỉnh | Dropdown ward được lọc / API+UI |
| TC-09 | Cố ghi ward của tỉnh khác | Composite FK từ chối / DB |
| TC-10 | Chọn tỉnh | Trả đúng economic region & macro; foreign=N/A / API+DB |
| TC-11 | Contact không position_title | Hợp lệ / DB |
| TC-12 | Một customer nhiều group | Nhiều link, không nhân bản customer / DB |
| TC-13 | Tài liệu có expiry_date | Lưu và tính hạn / DB+Backend |
| TC-14 | Tài liệu hết hạn | EXPIRED; không lưu status trùng / Backend |
| TC-15 | Hai Sale hiện hành | Partial UNIQUE từ chối / DB |
| TC-16 | Sale cũ khóa IAM | Dữ liệu vẫn tồn tại, history không FK IAM / DB+IAM |
| TC-17 | Customer ẩn trùng legal ID | Từ chối / DB |
| TC-18 | Upload tài liệu mới | Insert record mới, không UPDATE bản cũ / Backend |
| TC-19 | Code 999999 giới hạn | Code hết, không vòng lại / DB |
| TC-20 | Tạo khách PERSON/HOUSEHOLD | Role app INSERT được customer_type_code / DB |
| TC-21 | 34 tỉnh, 6 vùng; full ward | Seed đúng nguồn, không orphan, mã giữ zero / DB seed |
| TC-22 | Chuyển foreign ↔ VN | Không mất dữ liệu trước khi người dùng xác nhận / Backend |
| TC-23 | Foreign đăng ký tại Việt Nam có MST | Không dùng FOREIGN_NO_VN_REG để bỏ validation / Backend |
| TC-24 | Check rollback migration | Không DROP dữ liệu người dùng; backup và rollback guard / DB Gate |

**Chưa có Backend/Frontend nên TC-03/05/06/07/08/10/14/16/18/22/23 chưa thể PASS ở gate Database.** Không ghi PASS giả. Chỉ TEST/clone khi có quyền thi hành riêng.
