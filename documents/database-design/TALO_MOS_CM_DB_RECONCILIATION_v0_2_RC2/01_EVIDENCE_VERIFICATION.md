# Xác minh bằng chứng từ ZIP Claude Code

**Nguồn:** `CM_DB_PREFLIGHT_20261029-105936.zip` người dùng gửi ngày 2026-10-29. Đây là bằng chứng do Claude báo cáo và xuất metadata; ChatGPT không có quyền truy cập trực tiếp repo hoặc live DB của máy chủ dự án.

## Xác minh trực tiếp trong ZIP

| Nội dung | Thực chứng | Kết luận |
|---|---|---|
| Report | SHA-256 `ab01201f671587d45dfca68cd71a6f5fc5cc01b5c199cc912bdab0f66d7487d5` | Trùng dạng hash Claude công bố `ab01201f…87d5` |
| Bằng chứng | Báo cáo + 2 JSON + 2 script read-only | Có đủ |
| Q01 | DB `talo_mos_v4_test`, PG 18.6, `talo_app`, `tx_read_only=on` | TEST-only |
| Q02 | 5 schema gồm cả `public` | `public` tồn tại nhưng `talo_app` không USAGE |
| Q03 | 25 bảng: 14 `foundation`, 11 `iam` | Không tồn tại CM/Master hiện nay trong catalog chụp |
| Q14 | 0 bảng trùng pattern Customer/Master | 27 bảng ứng viên NEW trên TEST |
| Q09 | `talo_app` CREATE=false ở schema hiện có | Role runtime không dùng cho DDL |
| Q11/Q13 | 0 role membership / 0 default ACL | Cần thiết kế grants tường minh |
| Q16 | 0 trigger thấy qua information_schema đối với role khảo sát | **Không kết luận không có trigger ở mọi quyền**, vì visibility có giới hạn |

## Các kết luận lấy từ khảo sát source của Claude (chưa tự mở repo máy người dùng)
- `foundation.preflight.ts:381-397`: kiểm table + SELECT, không CREATE TABLE.
- `schema.prisma:18-21`: Prisma hiện map `iam`, Foundation dùng SQL trực tiếp.
- `foundation.fnd_*` PK `<entity>_id`, actor field `*_account_id` và không FK chéo IAM; đây là tiền lệ quan sát, không có nghĩa bắt buộc.
- Quy trình SQL độc lập theo FBE-01B: manifest/hash, guard, backup dump, rollback, pre/postcheck; phải kiểm lại phiên bản nguồn trước khi dùng.

## Giới hạn quan trọng
- Không xác minh DEV/PROD; không có snapshot DB before-after, không truy cập dữ liệu kinh doanh.
- Quyết định ownership Master Data và file storage vẫn chưa có.
- Không đánh đồng 'bảng chưa có' với 'cấu trúc đã sẵn sàng triển khai'.
