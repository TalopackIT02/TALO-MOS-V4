# TEST & acceptance — phần Database/Backend phụ thuộc

## Clone tests trước TEST

1. Baseline clone khớp `11 tables / 114 cols / 25 indexes`, role/schema/GRANT đúng như TEST.
2. Migration chạy transaction thành công; 15 tables, 3 cột mở rộng, index assignment cũ biến mất; index mới có vị từ đúng.
3. DB DRAFT và VERIFIED độc lập quan hệ PROSPECT/ACTIVE; VERIFIED thiếu pháp lý/địa chỉ phải bị CHECK; DRAFT vẫn tạo được.
4. Gán 1 PRIMARY và >=2 SUPPORT cho cùng KH PASS; thêm PRIMARY thứ hai bị unique index chặn; thêm cùng Sale lần hai bị chặn.
5. Legal request tạo với document cùng KH PASS; document KH khác bị FK chặn. Không sửa snapshot yêu cầu qua `talo_app`; chỉ cập nhật cột trạng thái.
6. Cùng request chỉ có tối đa một quyết định cấp MANAGEMENT và ACCOUNTING; trạng thái workflow và thứ tự duyệt thuộc Backend test.
7. Hai yêu cầu pháp lý PENDING cho cùng KH bị chặn; hủy/áp dụng rồi mở lại được.
8. Hai handover PENDING cho cùng KH bị chặn; approval/ack đúng nhánh, không được hoàn tất khi thiếu xác nhận (Backend test); quản lý override Sale cũ phải có actor + reason và IAM permission.
9. Chuyển activity của cùng KH PASS, activity KH khác bị FK chặn; chuyển một activity hai lần trong cùng handover bị UNIQUE chặn.
10. Document revision cùng KH PASS, khác KH FK chặn; hai bản mới cùng supersede một bản cũ bị chặn; bản cũ vẫn truy cập được.
11. `talo_app` chỉ có quyền cột được cấp; không UPDATE file_name/storage_path, không DELETE business history, không ALTER/CREATE.
12. Không tạo/sửa IAM, Foundation, SCC, Prisma; fingerprint trước = sau.
13. Ràng buộc mới không làm hỏng seed tỉnh/xã/vùng/mã KH; thử 2 transaction cấp mã đồng thời nếu an toàn trên clone.
14. Chạy `ROLLBACK` transaction thử và kiểm tra migration không để drift; rollback chính thức phải được Claude thiết kế và test riêng trên clone, không tự xóa dữ liệu.

## Backend E2E cần làm sau MIC

- Kiểm tra toàn bộ BR/API của hồ sơ; gồm 50 TC trong `SOURCE_CM_BE_SPEC_REV01.md` (phụ thuộc module khác ghi BLOCKED/NOT_TESTED, không báo PASS giả).
- IAM/function/scope truy cập qua API trực tiếp; không chỉ ẩn nút UI.
- Handover transaction cạnh tranh và fail halfway; lịch sử actor.
- Legal change approval + no-direct-PATCH + concurrent update + audit.
- Export scope, CSV injection, upload file an toàn và không mồ côi.
- SCC Data Inspector lộ PII hiện là rủi ro đã biết: **TEST chỉ được dùng dữ liệu giả lập**. Không coi migration xử lý lỗ hổng này.

Không cấp `READY_FOR_BACKEND`/`READY_FOR_FRONTEND` nếu test thuộc bắt buộc còn fail hoặc thiếu bằng chứng, nhưng không yêu cầu module Sales Order chưa tồn tại phải PASS để duyệt riêng CRM.
