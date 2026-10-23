# 16 — DECISION REGISTER & NO-REASK CONTRACT

## Quyết định đã chốt, Claude không hỏi lại

| Key | Quyết định |
|---|---|
| D01 | Quét module **thủ công** bằng nút; không watcher, không automatic startup scan |
| D02 | Package gồm MIC; Foundation tự đọc; không paste MIC trong luồng chính |
| D03 | Candidate sửa/test bao nhiêu lần cũng được trước READY, không tăng version vì lỗi Preflight |
| D04 | Chỉ khóa B02 khi đúng điều kiện phát hành; không sửa version đã locked |
| D05 | UI giữ AppShell / 4 blocks / theme trước; hai màn module + một Navigation Builder riêng |
| D06 | Drawer cho xem/sửa entity/log/check; popup xác nhận; workspace cho nhiều bước |
| D07 | Duy trì hệ thống IAM/Foundation, B01–B14 và audit; không tự đổi schema |
| D08 | Test/installer phải kiểm tra hash; evidence server, không fake PASS |
| D09 | Chỉ TEST `talo_mos_v4_test`, bảo vệ SYSTEM_TEST 1.1.1 & DATA_INSPECTOR 0.1.0 đang ACTIVE theo baseline user |
| D10 | Không dùng Claude Code để cài mỗi module; Claude trong REV-01 chỉ hoàn thiện Foundation chung |
| D11 | Giữ source local làm primary, GitHub reference không ghi đè |
| D12 | Không tự push, deploy, merge, sửa DB grants, auto IAM role assignment |
| D13 | Nút Installer chỉ được kích hoạt khi plan không blocker; preflight READY không có nghĩa ACTIVE |
| D14 | Không xóa dữ liệu FBET/B09 thử nghiệm hàng loạt theo nhãn; chỉ containment, cleanup sau verified identity |

## Quyết định **chưa có phê duyệt**, không được tự chế

| ID | Protected decision | Default an toàn | Owner cần duyệt điều gì |
|---|---|---|---|
| Q01 | Recovery RETIRED→ACTIVE hoặc reversible cutover khi upgrade ACTIVE | Giữ block `UPGRADE_RECOVERY_UNAVAILABLE`, implement prepare only | Phương án lifecycle service, rollback test, audit, scope DB nếu có |
| Q02 | Tự động restart Backend/Frontend từ giao diện | `AWAITING_RESTART` + Continue manual, không command injection | Chấp thuận fixed supervisor/tool integration và RBAC/audit |
| Q03 | IAM cấp quyền mặc định cho admin hoặc role khác | Chỉ tạo catalogue, không assignment | Policy/principal cụ thể và bằng chứng deny/allow |
| Q04 | Dọn vật lý 1.914 FBET/menu Khóa MVC lịch sử | Không DELETE, mặc định lọc/hide | Danh sách IDs proven fixture, dependency/backup/restore |
| Q05 | DB migration, schema/Prisma, grant | Không chạy | Schema diff/SQL/grant chính xác, migration gate |

**No-reask behavior:** với D01–D14 Claude cứ triển khai. Với Q01–Q05 Claude không hỏi rải rác trong phiên; ghi blocker quyết định rõ, hoàn tất các phần độc lập, nêu một bản decision request cuối cùng. Nếu Q01 chưa được duyệt, không được ghi DONE cho upgrade ACTIVE.

## Các nhận định cần kiểm tra, không được cố định

- SYSTEM_TEST 1.2.0 có thể đã DRAFT/READY theo ảnh ngày 23/10/2026; phải re-read local.
- SHA preflight 463ddd... có thể không còn đúng sau file edit.
- 1.914 FBET theo ảnh lịch sử, số thực tại thời điểm run chưa biết.
- Frontend/Backend port và `NODE_ENV` local có thể khác; không hardcode.
- Server có `supervisor: NONE` ở source tham chiếu; local có thể mới hơn.
