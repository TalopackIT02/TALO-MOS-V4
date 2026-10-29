# Delta và điểm cần giải quyết trước khi khóa thiết kế

## Chứng cứ mới so với RC1

1. Đã nhận toàn văn preflight báo cáo; SHA-256 đối chiếu chính xác.
2. Đã đọc trực tiếp JSON metadata Q01–Q21 và script đọc; 27/27 NEW trên TEST được củng cố bởi Q03 (25 bảng) và Q14 (0 bảng Customer).
3. Báo cáo §7 có đủ D-CM-01…15; không còn lý do "thiếu report" trong bản RC1.
4. Vẫn chưa có quyết định chủ dự án cho schema CM, owner 6 Master, actor và các quyết định tác động DDL.

## Các phần giữ nguyên

- 11 Business + 10 CM catalog + 6 Master; tên 27 bảng theo thiết kế ứng viên.
- Không thêm EAV, JSONB metadata động, bảng audit riêng, plugin/module mới, hoặc kho file nhúng DB.
- Không kéo dữ liệu công nợ, giao hàng, doanh thu vào Customer V1.

## Điểm RC1 chưa thể coi là FINAL

- Schema `cm` và `master_data`, owner `talo_cm_owner`/`talo_master_owner`: tên gợi ý, không tồn tại hiện trạng.
- `<entity>_id` và khóa `code` ngoại lệ là ứng viên chưa được duyệt.
- Common metadata: quyết định `updated_at`, `retired_at`, các trường actor phải khóa cụ thể từng bảng; không tự thêm `row_version`.
- `source_module_code`: quyết định varchar(50) hay varchar(80) chưa có.
- Group memberships lifecycle và `currency_code` seed: còn vướng logic/constraint.
- Foreign key Master Data yêu cầu tạo và cấp quyền trước các bảng Customer phụ thuộc.
- Không có chính sách tài liệu/file PDF hoặc ownership Master hiện hành.

**Khuyến nghị:** Chốt một văn bản approval rõ ràng theo `10_APPROVAL_FORM.md`, sau đó mới giao Claude tạo SQL nháp. Phê duyệt DDL dựa trên bản nào phải thể hiện trong manifest.
