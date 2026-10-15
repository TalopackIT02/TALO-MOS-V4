# TALO-MOS-V4 — AI GOVERNANCE REFERENCE

> **DRAFT v0.1 — CHƯA ĐƯỢC PHÊ DUYỆT.** Đây là phiên bản Markdown chuyển từ bộ tài liệu DOCX để AI đọc. Không tự nhận tài liệu này là quy định đã ACTIVE và không coi việc đọc tài liệu là phê duyệt viết code, migration, GRANT, commit hoặc deploy.

## Mục đích và ranh giới
- Chuẩn hóa làm việc giữa Foundation, IAM, Module và Database.
- Foundation quản lý nền tảng/đăng ký module/quyền và cơ chế kiểm soát; Module sở hữu logic nghiệp vụ; Database quản lý lưu trữ/ràng buộc và quyền kỹ thuật.
- Module công bố danh sách `Module → Function → Action`; đăng ký không đồng nghĩa được kích hoạt hoặc cấp quyền.
- **IAM v0.3** là baseline hiện hành; một membership có tối đa một account hiện hành; account có nhiều role; **không switch role/account**; quyền hiệu lực = (quyền từ các role hiệu lực ∪ direct ALLOW) − direct DENY, còn phụ thuộc các điều kiện trạng thái/assurance.
- Quyền người dùng khác quyền dịch vụ và SQL GRANT. Module kiểm tra điều kiện nghiệp vụ; backend kiểm tra quyền.
- Không tạo thêm cấu trúc DB hoặc chạy migration nếu chưa được duyệt cụ thể.

## Cách đọc
1. Đọc `GOV-00.md` và `ARC-01.md` để xác định thẩm quyền, ranh giới.
2. Đọc `IAM-04.md`, `MOD-03.md`, `DAT-05.md` trước mọi thay đổi liên quan chức năng/quyền/dữ liệu.
3. Đọc `FND-02.md` cho UI/AppShell; `WFL-06.md` cho quy trình duyệt; `DEV-07.md` cho triển khai/kiểm thử.
4. `REF-08.md` chứa **ví dụ nghiệp vụ tham chiếu**, không tự nâng thành quy tắc chung.

## Nguồn kiểm chứng và xử lý xung đột
- Tài liệu gốc của chủ dự án: `TaloMOS.docx`.
- Source code và quyết định repo: `https://github.com/TalopackIT02/TALO-MOS-V4` — đọc `CLAUDE.md`, `AUTH-CONTEXT/00-START-HERE.md`, IAM v0.3 Decision Record, SQL/Prisma schema, rồi đối chiếu thực tế nhánh/commit/local DB trước khi kết luận.
- Tài liệu snapshot có thể lỗi thời; không được lấy tài liệu handoff cũ làm bằng chứng đã triển khai. Mâu thuẫn giữa tài liệu và hệ thống: **ghi nhận, báo chủ dự án, không tự sửa để đồng bộ.**
- Quyết định đã phê duyệt của chủ dự án và bảo vệ an toàn dữ liệu có ưu tiên hơn đề xuất trong bộ tài liệu DRAFT này.

## Giao thức bắt buộc cho AI trong mỗi task
1. **VERIFY**: đọc đúng phần tài liệu liên quan, kiểm tra trạng thái Git và mã nguồn hiện có; nêu điều đã xác nhận và chưa xác nhận.
2. **SCOPE**: nêu mục tiêu, thành phần và file sẽ tác động, rủi ro IAM/DB, các quyết định cần duyệt.
3. **DESIGN**: nếu liên quan UI, đặc tả 4 Block; nếu liên quan Module, khai báo capability/version; nếu liên quan dữ liệu, chuẩn data contract/owner/migration.
4. **APPROVAL**: dừng nếu cần quyền sửa protected scope, migrations, dữ liệu, dependency, secret, grants hoặc deploy. Không suy ra phê duyệt từ việc user yêu cầu phân tích.
5. **IMPLEMENT**: chỉ thay đổi phần được phê duyệt. Không mở rộng sang module khác.
6. **TEST**: unit/integration/E2E phù hợp, quyền hiệu lực, ràng buộc dữ liệu, hồi quy Login; báo test thực chạy; không tự ghi PASS nếu chưa chạy.
7. **REPORT**: file đổi, hành vi đổi, trạng thái PASSED/FAILED/NOT_TESTED, rủi ro và vấn đề đang mở.

## Điều không được làm
- Không tự thay đổi IAM v0.3, schema/migration, SQL baseline, DB development, protected `documents/`.
- Không tự thêm chức năng quản lý chi nhánh/chọn công ty; không tự xây Switch Role/Account.
- Không cho người dùng trực tiếp quyền SQL dựa trên checkbox màn hình.
- Không cho mini setting chạy SQL hoặc mã tùy ý.
- Không đồng nhất việc Module khai báo quyền với được cấp quyền cho User.

## Bộ tài liệu chi tiết
- [ARC-01](ARC-01.md)
- [DAT-05](DAT-05.md)
- [DEV-07](DEV-07.md)
- [FND-02](FND-02.md)
- [GOV-00](GOV-00.md)
- [IAM-04](IAM-04.md)
- [MOD-03](MOD-03.md)
- [REF-08](REF-08.md)
- [WFL-06](WFL-06.md)

## Trạng thái và chấp thuận
DRAFT v0.1: dùng làm đầu vào thảo luận/rà soát. Sau khi chủ dự án phê duyệt rõ ràng, cần phát hành phiên bản ACTIVE có changelog và mã phiên bản, không tự sửa trạng thái tài liệu cũ.
