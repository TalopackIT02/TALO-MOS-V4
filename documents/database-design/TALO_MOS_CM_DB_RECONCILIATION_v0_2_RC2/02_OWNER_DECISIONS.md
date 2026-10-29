# Ma trận quyết định D-CM-01 đến D-CM-15

**Tất cả trạng thái: CHƯA PHÊ DUYỆT.** Đây là khuyến nghị từ bằng chứng, không thay lời quyết định chủ dự án.

| ID | Nội dung | Phương án ChatGPT đề xuất | Tình trạng |
|---|---|---|---|
| D-CM-01 | Schema và owner cho 21 bảng CM | Đề xuất schema `cm`, owner NOLOGIN `talo_cm_owner`; không dùng public | BLOCKER — cần chủ dự án phê duyệt và kiểm tra quyền tạo role/schema |
| D-CM-02 | Phương thức tạo bảng | Gói SQL ngoài Foundation theo mẫu FBE-01B, chỉ triển khai sau DB Gate riêng | BLOCKER — cần chủ dự án phê duyệt |
| D-CM-03 | Actor IAM | `uuid` theo `iam.iam_user_accounts.user_account_id`, tên `*_account_id`, KHÔNG FK chéo IAM | BLOCKER — duyệt tên cột + nullability + phạm vi sử dụng |
| D-CM-04 | Tên PK/FK | Ứng viên PK `<entity>_id`, ngoại lệ 10 `code` PK, khóa tự nhiên 3 master, khóa kép ở membership | HIGH — duyệt danh sách ngoại lệ |
| D-CM-05 | Metadata/concurrency | Không tự thêm `row_version`, `created_by`, `updated_by`; giữ các cột rõ trong dictionary; CAS/locking ở backend sẽ thiết kế sau | HIGH — chốt có/không `updated_at` và `retired_at` từng bảng |
| D-CM-06 | Lifecycle và DELETE | `status_code` = quan hệ; `is_hidden` = hiển thị; `is_active` = chọn được; `retired_at` = ngừng sử dụng. Hạn chế DELETE tài khoản ứng dụng | HIGH — chốt quyền xóa bản ghi chưa tham chiếu |
| D-CM-07 | Owner 6 Master Data | Đề xuất schema `master_data`, NOLOGIN `talo_master_owner`; giữ 6 bảng chung, không gắn ownership cho module Customer | BLOCKER — duyệt owner và DB Gate riêng trước CM |
| D-CM-08 | GRANT và quyền IAM | Chỉ đề xuất SELECT/USAGE tối thiểu cho MIC-06 khi triển khai; INSERT/UPDATE cột sẽ chốt theo API thực tế | HIGH — không tự cấp DML rộng |
| D-CM-09 | Backend DB access | Khuyến nghị SQL thuần theo pattern Foundation, không chỉnh Prisma schema IAM trong giai đoạn DB | MEDIUM — backend quyết sau, không cản DDL nếu tách bạch |
| D-CM-10 | `source_module_code` 50 vs module_key 80 | Nếu lưu đúng `foundation.fnd_modules.module_key`, đề nghị tăng từ varchar(50) lên varchar(80) | HIGH — thay đổi kiểu DDL, CHƯA ÁP DỤNG |
| D-CM-11 | Sinh customer_code | Khuyến nghị Backend/service cấp mã và DB UNIQUE, không tự thêm sequence/trigger | MEDIUM — quy tắc cấp mã chưa quyết |
| D-CM-12 | Bảo vệ PII/file metadata | Chỉ giữ metadata `storage_key`, không lưu PDF trong DB; chính sách upload/masking chưa quyết | MEDIUM — không tự mở file storage |
| D-CM-13 | Seed và DML | Chỉ seed mã đã được ghi rõ và được duyệt; Master cần nguồn dữ liệu chuẩn, không seed tự phát | HIGH — seed là Gate DML riêng |
| D-CM-14 | Môi trường | Chỉ TEST (`talo_mos_v4_test`) là môi trường kiểm chứng; gói nháp không chạy nơi nào | HIGH — DEV/PROD cấm trong phạm vi hiện tại |
| D-CM-15 | Index | PK/UQ/FK/index đảm bảo ràng buộc + các index ứng viên trong dictionary; không tạo thêm index hiệu năng tự phát | LOW — cần duyệt trước triển khai |

## Các vấn đề từ danh sách quyết định v0.1 chưa được đóng

- **D05:** Mã số thuế: vẫn kiểm trùng, chưa UNIQUE tuyệt đối; chỉ tạo index/validation theo quyết định.
- **D09:** PROSPECT có thể thiếu hồ sơ thuế; giao dịch thực tế phải đạt yêu cầu validation khi Sales Order được xây dựng.
- **D11:** Bảng N–N `cm_customer_group_members` có PK kép; muốn gỡ nhóm và gán lại cần định rõ DELETE, `retired_at`, hoặc cơ chế khác. Không tự thêm cột.
- **D12:** UNIQUE cho external activity cần event contract, không tự áp constraint.
- **D14:** Địa chỉ giữ snapshot, không cố định 3 cấp hành chính.
- **D15:** Giữ bảng hồ sơ thanh toán như V1 đã thống nhất.
- **D16:** Tên module nguồn phải tương thích mã module thực tế, xem D-CM-10.
- **D17:** Lưu file ngoài DB và quyền truy cập tài liệu chốt khi phát triển backend.
- **D18:** SELECT trong UI là quyền DB role `talo_app`, không là quyền IAM user.

## Rủi ro bắt buộc ghi vào phê duyệt

1. D-CM-10: loại dữ liệu hiện tại `varchar(50)` có thể không chứa toàn bộ `module_key varchar(80)`; cần quyết nếu cùng semantics.
2. D11: Không thể đồng thời cấm DELETE mọi dòng và dùng PK kép mà vẫn cho phép ghi lịch sử gỡ-gán lại nếu không có cập nhật/trường hiệu lực phù hợp.
3. `currency_code DEFAULT VND` phụ thuộc seed `ref_currencies` có VND; nếu không seed thì chỉ tạo DDL chưa thể insert thanh toán hợp lệ.
4. Những role NOLOGIN và schema mới đều là **đề xuất**, không tồn tại trong TEST đã kiểm chứng.
