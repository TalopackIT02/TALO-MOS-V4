# TALO-MOS-V4

## DANH MỤC THAM CHIẾU NGHIỆP VỤ TỪ TÀI LIỆU GỐC

Mã tài liệu: REF-08

Phiên bản: 0.1

Trạng thái: DRAFT — CHỜ PHÊ DUYỆT

Ngày soạn: 15/10/2026

Phạm vi: Khung quy tắc phát triển phần mềm; không cấp quyền thực thi thay đổi code/database

Phân loại: các quy tắc được gắn nhãn ĐỀ XUẤT trong bộ tài liệu chưa trở thành quy định bắt buộc cho đến khi chủ hệ thống phê duyệt. IAM v0.3 và ranh giới CLAUDE.md đang có được kế thừa, không ghi đè.

## 1. Trạng thái tham chiếu

- Tài liệu này lưu yêu cầu nghiệp vụ ban đầu từ TaloMOS.docx; không áp thành quy chuẩn Foundation cho mọi Module.

- Những quy trình CRM/Sản phẩm được mô tả là đầu vào phân tích, chưa mặc nhiên hoàn thành kỹ thuật hoặc được phê duyệt implementation.

## 2. Ưu tiên nghiệp vụ

- Định hướng luồng đầu: Kinh doanh → Kho → Kế toán, phục vụ theo dõi nợ phải thu và nợ phải chi.

- Sản xuất giai đoạn đầu được mô tả thiên về ghi nhận vật tư đầu vào/thành phẩm đầu ra; chưa chi tiết hóa thành hợp đồng liên Module.

## 3. CRM / Khách hàng

- Các nhóm trạng thái khách hàng: tiềm năng, mới, đang hợp tác, tạm ngưng, ngừng hợp tác; trigger theo sự kiện có kiểm chứng.

- Hoạt động: liên hệ, khảo sát, thông số, tư vấn, báo giá, đàm phán, hợp đồng, thiết kế, đơn hàng, chăm sóc.

- Màn hình chi tiết khách hàng theo 4 Block; Block 4 gồm thông tin cố định trái và tab nội dung phía phải, lịch sử hoạt động dạng timeline.

- Thao tác sửa, ẩn, xóa cần xem xét vai trò, tình trạng, thời điểm và duyệt theo nghiệp vụ.

## 4. Sản phẩm và dạng sản phẩm

- Product có dashboard, danh sách, tạo mới, dạng sản phẩm; Dynamic Specification và lưu tài liệu đính kèm.

- Dạng sản phẩm: chưa có sản phẩm sử dụng mới được xóa; đã dùng thì ẩn và giữ khả năng bỏ ẩn; các bước duyệt phải được đặc tả.

- Thay đổi danh mục thông số sản phẩm có ảnh hưởng cấu trúc dữ liệu, không giao người dùng sửa tùy ý.

## 5. Cách tái sử dụng tham chiếu

- Khi triển khai Module Sales/Product, trích yêu cầu chi tiết từ tài liệu nguồn rồi lập đặc tả chính thức riêng.

- Không dùng ví dụ quy trình Product để áp vào kho, kế toán, nhân sự nếu chưa có quyết định nghiệp vụ.

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
