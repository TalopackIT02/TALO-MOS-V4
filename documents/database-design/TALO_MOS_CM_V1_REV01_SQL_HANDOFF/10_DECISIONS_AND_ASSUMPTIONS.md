# 10 — Quyết định/bản quyền thay đổi

## Đề xuất được dùng để SOẠN SQL CANDIDATE (không phải owner-approved execution)
- 11 bảng/114 cột; 4 bảng địa lý thuộc schema CM ở V1 để giảm phức tạp.
- Mã KH 6 số do DB DEFAULT sequence, Backend nhận kết quả; chủ dự án đã yêu cầu sinh an toàn đồng thời.
- Định danh pháp lý một cột chuẩn hóa thay `tax_number`, kèm `legal_identifier_type_code`; UNIQUE ba trường khác NULL.
- Checkbox nước ngoài được biểu diễn bằng `customer_type_code`, không tạo cột bool trùng lặp.
- Trường miền/vùng là phép join từ mapping; không ghi copy vào customer.
- `registered_address` lưu snapshot do Backend đồng bộ trong cùng transaction với các thành phần.
- Chưa seed 8 nhóm ngành bao bì, chưa tạo bảng legal riêng/chi nhánh cha con.
- `cm_ref_province_region_map` là nơi duy nhất chứa ánh xạ vùng kinh tế + ba miền.

## Cần xác nhận rõ ở Gate EXECUTION
- Tạo owner NOLOGIN ở phạm vi cluster, schema `cm`, các quyền hiệu lực.
- Role `talo_app` SELECT PII đồng thời SCC Data Inspector xem được trên TEST (không áp dụng PROD).
- Ba miền là quy ước kinh doanh nội bộ; không coi là 3 vùng hành chính pháp định.
- Nguồn ward đầy đủ và các văn bản mới nhất; thuật toán checksum MST đã chứng minh theo văn bản kỹ thuật.

## KHÔNG cần kéo dài SQL authoring gate
Thiếu seed xã không phải lý do ngừng viết bảng, khóa, index và runbook. Những cột/chế độ đã rõ được phép soạn ngay. Không quyết định thay chủ dự án về DDL execution.
