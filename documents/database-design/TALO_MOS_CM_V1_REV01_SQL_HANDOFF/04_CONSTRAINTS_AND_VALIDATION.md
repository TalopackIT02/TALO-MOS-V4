# 04 — Ràng buộc và validation V1

## A. DB: những ràng buộc bắt buộc
1. `cm_customers.customer_code varchar(6) NOT NULL UNIQUE`, CHECK `~ '^[0-9]{6}$'`; DB sequence `cm.customer_code_seq START 1 MINVALUE 1 MAXVALUE 999999 NO CYCLE`, cột DEFAULT `lpad(nextval(...))`. Không cho `talo_app` INSERT/UPDATE `customer_code`; `RETURNING customer_code` được phép. Không tái sử dụng mã; sequence có thể tạo lỗ khi rollback.
2. `cm_customers.legal_identifier_normalized` UNIQUE **có điều kiện khác NULL** theo `(country_code,legal_identifier_type_code,legal_identifier_normalized)`, không loại trừ bản ghi ẩn. Chỉ chuẩn hóa được theo loại/luật; Backend không được âm thầm đồng nhất hai mã 10 và 13 chữ số.
3. Khách hàng chưa hoàn thiện (`PROSPECT`) được để NULL định danh; trạng thái giao dịch chính thức (`NEW`, `ACTIVE`, `PAUSED`, `CLOSED`) bắt buộc `legal_name`, loại/mã định danh và địa chỉ theo chế độ đăng ký. Việc trạng thái `PAUSED/CLOSED` là khách cũ đã hoàn thiện, không phục vụ tạo mới.
4. `customer_type_code` phải do client xác định và theo contract 5 loại; `LEGAL_ID_TYPE`: `VN_TAX_ID`, `VN_PERSONAL_ID`, `FOREIGN_REG`. Với `FOREIGN_NO_VN_REG`, `country_code <> 'VN'`, `province_code/ward_code` NULL; nếu nước ngoài có MST Việt Nam thì không dùng loại này để né validation.
5. Địa chỉ trong nước dùng `province_code` và `ward_code` phù hợp, FK kép chặn xã sai tỉnh; khách chính thức tại Việt Nam cần tỉnh/xã. Địa chỉ `address_line` cần có theo nghiệp vụ; không sửa trực tiếp snapshot `registered_address` ngoài cùng giao dịch cập nhật trường thành phần.
6. Tài liệu `effective_date <= expiry_date` nếu cả hai có giá trị; không ép ngày ký trước ngày hiệu lực; `file_size >= 0`; file mới sinh bản ghi mới.
7. Hai partial UNIQUE baseline: liên hệ chính `(customer_id) WHERE is_primary AND is_active`; Sale hiện tại `(customer_id) WHERE ended_at IS NULL`.
8. CHECK baseline: contact có phone hoặc Zalo, group không tự trỏ cha, assignment ended_at >= assigned_at, documents file_size >= 0.
9. Mapping Province→EconomicRegion: một bản ghi hiện hành (`valid_to IS NULL`) mỗi tỉnh, `valid_to >= valid_from`, không khoảng trùng nhau theo phiên bản (validate ở seed/import); phép gán ba miền là quy ước ứng dụng được phê duyệt riêng.
10. Mọi FK ON DELETE RESTRICT, giữ lịch sử, không cascade xóa Customer. Group-members mới được DELETE với kiểm soát qua Backend/IAM.

## B. Backend validation — không cố gắng nhồi mọi luật vào CHECK SQL
- MST Việt Nam: mã 10 số hoặc 13 số (hiển thị 10-3). Định dạng/cấu trúc + checksum cho 10 chữ số theo thuật toán có **chứng cứ thẩm quyền được ghi trong SOURCES**, không tự giả định công thức. Với MST 13 số, xác thực phần gốc và hậu tố đúng luật; phân biệt với định danh cá nhân.
- VN personal ID: 12 chữ số, KHÔNG dùng kiểm tra MST Modulo 11; nếu kiểm chứng quốc gia qua API chưa có thì ghi 'chưa xác minh', không giả vờ xác minh thật.
- Foreign registration: kiểm tra quốc gia != VN, loại định danh, tên, độ dài và chống trùng theo quốc gia+loại+mã; không ép 10/13 số.
- Khi chuyển loại khách, tỉnh, nước ngoài/nội địa, yêu cầu xác nhận trước khi bỏ phần nhập không còn hợp lệ; chỉ commit thay đổi nguyên tử cùng snapshot; không tự xóa dữ liệu đã lưu khi chưa xác nhận.
- Tài liệu: NOT_EFFECTIVE / EFFECTIVE / EXPIRING / EXPIRED / UNKNOWN, trạng thái tính tại thời điểm hiển thị, không lưu cột status; đề xuất cảnh báo 30 ngày là cấu hình Backend/UI chưa được chốt.
- Bàn giao Sale: 1 transaction đóng assignment cũ, tạo mới, cập nhật công việc OPEN, tạo activity HANDOVER. Backend/ IAM xác thực quyền; không thay đổi người tạo lịch sử.

## C. Rủi ro cần kiểm tra, không được lờ
- DB-level GRANT không thực hiện row-level IAM. SCC Data Inspector nếu dùng chung role `talo_app` có thể thấy tên, liên hệ và định danh pháp lý. Không lén sửa SCC; owner duyệt rủi ro TEST hoặc thay chiến lược role ở giai đoạn khác.
- Sequence tạo tại DB, không yêu cầu hàm hay trigger; GRANT USAGE/SELECT tối thiểu cho runtime cần kiểm tra (DEFAULT nextval cần USAGE); tránh cho runtime quyền setval/ALTER sequence.
- Luật checksum cần nguồn đủ thẩm quyền; định dạng kiểm tra khác xác minh mã tồn tại thật.
