# TALO-MOS-V4

## TIÊU CHUẨN WORKFLOW VÀ BUSINESS RULES

Mã tài liệu: WFL-06

Phiên bản: 0.1

Trạng thái: DRAFT — CHỜ PHÊ DUYỆT

Ngày soạn: 15/10/2026

Phạm vi: Khung quy tắc phát triển phần mềm; không cấp quyền thực thi thay đổi code/database

Phân loại: các quy tắc được gắn nhãn ĐỀ XUẤT trong bộ tài liệu chưa trở thành quy định bắt buộc cho đến khi chủ hệ thống phê duyệt. IAM v0.3 và ranh giới CLAUDE.md đang có được kế thừa, không ghi đè.

## 1. Nguyên tắc lõi

- IAM quyết định có quyền yêu cầu thao tác; Module quyết định dữ liệu hiện tại có đáp ứng điều kiện thực thi.

- Foundation có thể cung cấp công cụ cấu hình/điều phối; không chứa điều kiện nghiệp vụ tùy biến vô kiểm soát.

- Quy trình duyệt nhiều bước là phần mở rộng theo khả năng module công bố, chưa mặc định phải có workflow engine tổng quát.

## 2. Mini Setting được phép quản lý

- Định nghĩa trạng thái, bước duyệt, nhóm người duyệt, điều kiện gửi duyệt, phân tách người tạo/người duyệt.

- Các tham số được Module khai báo có type, default, validation, version và giới hạn cấu hình.

- Không cho phép Admin nạp JS/SQL để tùy ý chạy trong tiến trình nền tảng.

## 3. Hợp đồng rule/workflow đề xuất

- workflow_key, version, states, transitions, required_action, required_assurance, condition_rule_keys.

- rule_key phải bền vững và được backend Module thực thi; Foundation không tự hiểu ý nghĩa ngầm của trạng thái.

- Mỗi transition cần kiểm tra actor, action, trạng thái hiện tại và điều kiện tại thời điểm commit.

## 4. Ví dụ từ tài liệu gốc

- Dạng sản phẩm chưa từng sử dụng có thể được xóa; đã sử dụng thì ưu tiên ẩn và giữ lịch sử.

- Một số thao tác tạo, ẩn, xóa dạng sản phẩm có yêu cầu duyệt nhiều cấp; ngoại lệ xóa bản mới tạo cần đặc tả rõ.

- Đây là quy tắc Product module, không áp dụng cho toàn bộ resource trên hệ thống.

## 5. An toàn và Audit

- WF-01 | Không mặc định người có APPROVE được duyệt mọi bước.

- WF-02 | Workflow phải ngăn race condition/double approval theo thiết kế transaction.

- WF-03 | Mọi quyết định duyệt, từ chối, hủy và thay đổi cấu hình đều cần audit.

- WF-04 | Quy trình không hợp lệ hoặc rule engine lỗi phải từ chối an toàn.

## Nguồn tham chiếu và giới hạn

- TaloMOS.docx: Tài liệu ý tưởng do chủ hệ thống cung cấp, 19 trang; mục A.1–A.2, quy ước UI 4 Block, CRM và Sản phẩm.

- GitHub / CLAUDE.md: https://github.com/TalopackIT02/TALO-MOS-V4/blob/main/CLAUDE.md

- GitHub / IAM Decision Record v0.3: https://github.com/TalopackIT02/TALO-MOS-V4/blob/main/documents/database-design/IAM%26Sercurity/TALO-MOS-IAM-v0.3-Decision-Record.md

- GitHub / IAM Prisma mapping: https://github.com/TalopackIT02/TALO-MOS-V4/blob/main/database/prisma/schema.prisma

- GitHub / AUTH Context: https://github.com/TalopackIT02/TALO-MOS-V4/blob/main/AUTH-CONTEXT/00-START-HERE.md

Chưa xác minh trạng thái database local/production hoặc kiểm thử lại. Mọi khác biệt cần kiểm tra trên môi trường đích bằng thao tác chỉ đọc trước khi áp dụng.

## Phê duyệt tài liệu

| Người phê duyệt | ____________________________ |

| --- | --- |

| Ngày phê duyệt | ____________________________ |

| Quyết định | ☐ Phê duyệt  ☐ Yêu cầu sửa  ☐ Chưa phê duyệt |
