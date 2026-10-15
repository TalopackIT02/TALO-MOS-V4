# TALO-MOS-V4

## QUY CHẾ QUẢN TRỊ PHÁT TRIỂN PHẦN MỀM

Mã tài liệu: GOV-00

Phiên bản: 0.1

Trạng thái: DRAFT — CHỜ PHÊ DUYỆT

Ngày soạn: 15/10/2026

Phạm vi: Khung quy tắc phát triển phần mềm; không cấp quyền thực thi thay đổi code/database

Phân loại: các quy tắc được gắn nhãn ĐỀ XUẤT trong bộ tài liệu chưa trở thành quy định bắt buộc cho đến khi chủ hệ thống phê duyệt. IAM v0.3 và ranh giới CLAUDE.md đang có được kế thừa, không ghi đè.

## 1. Mục đích và hiệu lực

- Quy chuẩn áp dụng cho Foundation, IAM, Module, các hợp đồng tích hợp, Database, UI và toàn bộ công việc xây dựng TALO-MOS-V4.

- Bản v0.1 là DRAFT để chủ hệ thống rà soát; không mặc nhiên thay thế những quyết định IAM v0.3 đã chốt hoặc cấp quyền chỉnh sửa repository.

- Mỗi yêu cầu phải phân biệt: ĐÃ CHỐT / ĐỀ XUẤT / ĐÃ TRIỂN KHAI / ĐÃ KIỂM THỬ / CHƯA XÁC MINH.

## 2. Quy tắc quản trị bắt buộc

- GOV-01 | Không triển khai trước khi thống nhất phạm vi, đối tượng, kết quả nghiệm thu và file có thể sửa.

- GOV-02 | Không tự phát sinh Module, chi nhánh, schema, chức năng, role, quyền, workflow hoặc nguồn dữ liệu ngoài yêu cầu.

- GOV-03 | Mọi thay đổi protected scope, dependency, migration, seed, grant, push, merge, deploy phải xin duyệt cụ thể.

- GOV-04 | Khi tài liệu, code và DB khác nhau: ghi nhận sự khác biệt, không âm thầm đồng bộ.

- GOV-05 | Không gắn nhãn PASS nếu chưa có bằng chứng kiểm thử thực tế; báo NOT TESTED khi thiếu kiểm chứng.

- GOV-06 | Không sửa đè tài liệu người dùng trong documents/; bảo tồn nguồn yêu cầu.

## 3. Phân quyền quyết định

- Chủ hệ thống: phê duyệt phạm vi nghiệp vụ, ngoại lệ, mở rộng quyền, thay đổi cấu trúc dữ liệu.

- Người phân tích/kiến trúc: xác định hợp đồng, rủi ro, khuyến nghị và tác động; không tự phê duyệt.

- Claude Code/đơn vị thực thi: sửa đúng phạm vi, báo cáo file thay đổi, test đã chạy và điểm chưa kiểm tra.

## 4. Xử lý mâu thuẫn

- Quyết định mới được duyệt không xóa bỏ lịch sử quyết định cũ; phải có Change Record nêu phạm vi hiệu lực.

- Mã nguồn và DB thực tế là bằng chứng trạng thái triển khai; không thay thế văn bản phê duyệt.

- Các tài liệu lịch sử có thể lỗi thời; cần đối chiếu mã nguồn, Git HEAD và trạng thái DB theo chế độ chỉ đọc.

## 5. Quản lý phiên bản và ngoại lệ

- Mỗi tài liệu cần mã, version, trạng thái, ngày, người phê duyệt, nhật ký thay đổi và tài liệu liên quan.

- Ngoại lệ phải nêu nguyên nhân, biên tác động, phương án giảm thiểu, thời hạn và quyền phê duyệt.

- Trạng thái chuẩn: DRAFT → IN REVIEW → APPROVED → ACTIVE → SUPERSEDED/RETIRED.

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
