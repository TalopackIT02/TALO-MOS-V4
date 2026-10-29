# Contract Foundation – SQL Database Gate

## Bản chất kết nối

- SQL DDL nghiệp vụ không được chạy bởi Foundation Installer. Cần gói SQL độc lập, quyền owner/admin phù hợp và Gate được duyệt.
- Foundation kiểm tra `MIC-06` tài nguyên DB đã tồn tại và vai trò runtime `talo_app` có SELECT.
- Cấu trúc Database phải có trước khi phát triển Backend/Frontend MIC.
- Role `talo_app` không có CREATE/USAGE trên public hiện tại; không mở `public` chỉ để cài CM.
- Quyền DB role `talo_app` và IAM application permission hoàn toàn khác nhau.

## Thứ tự sau phê duyệt (KHÔNG THỰC HIỆN TRONG GÓI NÀY)

1. Chủ dự án phê duyệt owner/schema của Master & Customer, chốt data dictionary và chính sách seed.
2. Claude Code tạo SQL nháp riêng ngoài repo, kèm preflight guard, checksum, backup runbook, rollback đề xuất, verification read-only.
3. Chủ dự án kiểm gói rồi ra lệnh triển khai TEST trong Gate mới; không chạm DEV/PROD.
4. Operator có thẩm quyền chạy theo runbook, tạo schema/roles nếu đã được duyệt; kiểm metadata và grants.
5. Backend/MIC và Frontend/MIC được xây dựa trên DB đã nghiệm thu; Foundation chỉ installer sau khi dependency có thật.

## Các điều cấm

Không `prisma db push/migrate`, không sửa schema IAM/Foundation, không CREATE/GRANT bằng `talo_app`, không tự triển khai xuống TEST, không push/merge/deploy và không tự thêm object ngoài baseline được duyệt.
