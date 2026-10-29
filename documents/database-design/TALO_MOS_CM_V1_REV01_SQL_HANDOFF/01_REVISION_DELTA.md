# 01 — Thay đổi từ 7 bảng / 76 cột

- Giữ **7 bảng nghiệp vụ** và các quan hệ bàn giao/hoạt động/nhóm cũ.
- `cm_customers`: 18 → **23** cột. **Bỏ trong thiết kế chưa triển khai:** `tax_number`, `province_name`, `sales_region`. **Thêm:** `legal_identifier_type_code`, `legal_identifier_normalized`, `address_line`, `province_code`, `ward_code`, `country_code`, `foreign_locality`, `foreign_state_province`.
- `customer_code` đổi `varchar(30)` thành `varchar(6)`; cấp từ sequence `cm.customer_code_seq`, 000001–999999, NO CYCLE. Backend chỉ hiển thị, không tự cấp bằng MAX+1. Cấu trúc và quyền đề nghị ghi `DEFAULT lpad(nextval(...)::text,6,'0')`.
- `customer_type_code` bỏ mặc định COMPANY để yêu cầu chọn tư cách pháp lý thực tế; vẫn cho PROSPECT với trường định danh còn thiếu.
- `legal_identifier_normalized` là **nguồn lưu duy nhất** cho MST/CCCD/định danh nước ngoài; `legal_identifier_type_code` phân loại. Không giữ bản trùng `tax_number`.
- `registered_address` là snapshot hiển thị/đã xác nhận từ các cột địa chỉ thành phần; Backend cập nhật đồng thời và không cho nhập/sửa độc lập.
- Checkbox 'foreign unregistered in VN' trên Frontend **được suy ra từ** `customer_type_code = FOREIGN_NO_VN_REG`, không lưu cờ boolean trùng nghĩa.
- `cm_customer_documents`: 11 → **14** cột; thêm `signed_date`, `effective_date`, `expiry_date`.
- **Thêm 4 bảng tra cứu địa lý:** `cm_ref_provinces`, `cm_ref_wards`, `cm_ref_economic_regions`, `cm_ref_province_region_map` (không tạo country, loại khách, loại tài liệu, nhóm ngành hay bảng legal riêng).
- **Tổng:** **11 bảng / 114 cột** (76 cột gốc - 3 cột bỏ + 8 cột Customer mới + 3 cột Document mới + 30 cột tra cứu).
- Không có migration chuyển dữ liệu thật vì 7 bảng cũ mới là **draft**, báo cáo Claude xác nhận chưa từng chạy. Khi phát hiện đã có bảng trên TEST thì DỪNG, không mặc định DROP/ALTER.

## Không mở rộng
Không thêm bảng khóa mã khách hàng: **chỉ thêm sequence**, một đối tượng kỹ thuật, không phải bảng. Không thêm sổ công nợ hoặc số dư vào `cm_customers`.

## Điểm cần owner xác nhận trước EXECUTION
1. Schema `cm`, owner `talo_cm_owner` (NOLOGIN) và việc tạo cluster-level role.
2. Quyền SCC Data Inspector đọc PII bằng `talo_app` — quyết định rủi ro trên TEST, không suy rộng PROD.
3. Xác nhận phép gán ba miền nội bộ: 2 vùng Bắc = NORTH, 2 vùng giữa = CENTRAL, 2 vùng Nam = SOUTH.
4. Phê duyệt bản nguồn seed hiện hành sau khi Claude kiểm tra thay đổi địa giới, luật thuế mới.
