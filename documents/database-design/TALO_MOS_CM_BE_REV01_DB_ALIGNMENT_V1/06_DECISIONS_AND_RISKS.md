# Quyết định / rủi ro phải ghi rõ (không tự coi đã duyệt)

| ID | Đề xuất | Tác động / xử lý |
|---|---|---|
| D01 | Thêm 4 bảng, 3 cột, thay 1 CHECK và index Sale | Là migration mới, **không** tái chạy baseline R2 |
| D02 | Giữ `record_status_code` độc lập `customer_status_code` | Mọi khách R2 cũ chưa được backfill; SQL guard dừng nếu đã có customer |
| D03 | Role PRIMARY/SUPPORT; 1 PRIMARY + nhiều SUPPORT | Bổ sung partial unique; `assignment_role_code` tạo mới chỉ lúc INSERT, tránh sửa vai trò của lịch sử |
| D04 | 2 bước duyệt pháp lý MANAGEMENT rồi ACCOUNTING | Quy trình cụ thể trong Backend; owner phải duyệt rule không tự duyệt; cấm PATCH thông thường |
| D05 | 2 luồng bàn giao như hồ sơ Backend | Cần chốt nhánh khi Sale cũ nghỉ không còn khả năng xác nhận: ứng viên SQL có `current_ack_override_by_account_id` và `current_ack_override_reason`; quyền IAM `handover.override`, kiểm tra Sale cũ không còn khả năng ACK và audit là bắt buộc; cần chủ dự án duyệt quy tắc |
| D06 | Trạng thái document theo ngày | Ngưỡng cảnh báo 30 ngày *đề xuất*, chưa chốt; không cần thêm cột status |
| D07 | Upload PDF/JPG/PNG | Giới hạn file *đề xuất* 10 MB/file, cấu hình Backend; chưa phải quyết định owner |
| D08 | Audit Foundation/IAM/MIC thật | Gói SQL không tạo hệ audit toàn cục; bắt buộc đối chiếu repo/contract |
| D09 | GRANT thêm SELECT cho 4 bảng mới | SCC Data Inspector sẽ có thể xem thêm PII/đề nghị sửa pháp lý trên TEST; **chỉ dữ liệu giả lập**, chưa chấp thuận production |
| D10 | Existing TEST customer count = 0 theo execution report | Đối chiếu live; nếu >0, dừng migration và đưa backfill, không tự sửa dữ liệu |
| D11 | Phiên bản tài liệu = linked `supersedes_document_id` | Chỉ một successor trực tiếp; xử lý cycle/atomic storage trong Backend |
| D12 | MIC chức năng, endpoint/prefix, tenant/scope | Đọc contract thật; không tạo MIC bằng giả định từ tên nhóm chức năng |

**Chưa giải quyết bằng SQL:** Foundation Audit/Event thực tế, quyền quản lý theo cơ cấu nhân sự trong IAM, cơ chế lưu file dùng chung, hạn mức file, rule override bàn giao khi Sale nghỉ, workflow 2 cấp có phân người duyệt. Trạng thái là `DESIGN_PENDING_OWNER_APPROVAL`; không âm thầm mở thêm bảng.
