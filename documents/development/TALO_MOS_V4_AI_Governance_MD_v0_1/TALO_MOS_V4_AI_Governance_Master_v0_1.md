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


---

# FILE: ARC-01.md

# TALO-MOS-V4

## TIÊU CHUẨN KIẾN TRÚC FOUNDATION — MODULE — DATABASE

Mã tài liệu: ARC-01

Phiên bản: 0.1

Trạng thái: DRAFT — CHỜ PHÊ DUYỆT

Ngày soạn: 15/10/2026

Phạm vi: Khung quy tắc phát triển phần mềm; không cấp quyền thực thi thay đổi code/database

Phân loại: các quy tắc được gắn nhãn ĐỀ XUẤT trong bộ tài liệu chưa trở thành quy định bắt buộc cho đến khi chủ hệ thống phê duyệt. IAM v0.3 và ranh giới CLAUDE.md đang có được kế thừa, không ghi đè.

## 1. Mô hình ba miền trách nhiệm

- Foundation / Control Plane: quản trị môi trường vận hành, đăng ký Module, danh mục chức năng, IAM, AppShell, dịch vụ chung và governance.

- Module / Business Plane: triển khai nghiệp vụ, workflow đặc thù, validation, dữ liệu thuộc quyền sở hữu.

- Database / Data Plane: lưu trữ, bảo vệ, ràng buộc toàn vẹn và giao dịch; độc lập về trách nhiệm nhưng không nhất thiết là cơ sở dữ liệu tách riêng.

## 2. Ranh giới bắt buộc

- ARC-01 | Foundation không chứa logic nghiệp vụ chuyên ngành chỉ vì module cần dùng chung giao diện.

- ARC-02 | Module không tự thay đổi bảng IAM, chính sách xác thực hoặc quyền của Module khác.

- ARC-03 | Foundation không phải proxy bắt buộc cho mọi truy vấn SQL.

- ARC-04 | Quyền người dùng, quyền service và SQL GRANT là các tầng riêng.

- ARC-05 | Tích hợp xuyên miền phải đi qua hợp đồng thống nhất; mặc định không có quyền.

## 3. Ví dụ triển khai

- Kinh doanh sở hữu nghiệp vụ Đơn hàng. Kế toán muốn ghi nhận thông tin đối chiếu cần một API hoặc Data Contract được chủ sở hữu chấp thuận.

- Foundation kiểm tra quyền cập nhật theo IAM; Module kiểm tra đơn có trạng thái phù hợp; database đảm bảo ràng buộc và transaction.

- Đối với các mẫu CRM và sản phẩm trong tài liệu nguồn, trạng thái và điều kiện xóa là chính sách nghiệp vụ của Module, không phải quy định DELETE chung.

## 4. Điểm chưa chốt

- Thiết kế triển khai registry vật lý, DB schemas của các Module và cơ chế tích hợp đồng bộ/bất đồng bộ sẽ được thiết kế riêng.

- Organization Management là nguồn dữ liệu cơ cấu tổ chức được đề xuất, không tự suy ra có đa công ty hoặc giao diện chọn chi nhánh.

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


---

# FILE: DAT-05.md

# TALO-MOS-V4

## TIÊU CHUẨN DATABASE GOVERNANCE VÀ DATA CONTRACT

Mã tài liệu: DAT-05

Phiên bản: 0.1

Trạng thái: DRAFT — CHỜ PHÊ DUYỆT

Ngày soạn: 15/10/2026

Phạm vi: Khung quy tắc phát triển phần mềm; không cấp quyền thực thi thay đổi code/database

Phân loại: các quy tắc được gắn nhãn ĐỀ XUẤT trong bộ tài liệu chưa trở thành quy định bắt buộc cho đến khi chủ hệ thống phê duyệt. IAM v0.3 và ranh giới CLAUDE.md đang có được kế thừa, không ghi đè.

## 1. Vai trò dữ liệu

- Database là hạ tầng lưu trữ chung; Foundation quản trị đăng ký/kiểm soát truy cập; chủ sở hữu dữ liệu của từng Module chịu trách nhiệm schema nghiệp vụ.

- Một DB PostgreSQL dùng chung giai đoạn đầu là định hướng đề xuất, không bắt buộc mọi Module dùng một schema.

- IAM v0.3 và Prisma mapping hiện tại là baseline không được tự động migration.

## 2. Phân định quyền

- Quyền UI/Role của User không chuyển thành SQL GRANT của DB User.

- Service runtime và provisioning dùng quyền kỹ thuật có giới hạn; không mở quyền cross-schema mặc định.

- Module không cập nhật trực tiếp bảng Module khác, trừ khi có hợp đồng ghi rõ bảng/cột/phạm vi và cơ chế thực thi được duyệt.

## 3. Data Contract tối thiểu

- data_owner, resource_key, schema_version, consumer_modules, access_mode (read/write), interface (API/event/view), data_schema.

- Định nghĩa validation, khóa định danh, quy tắc nhất quán, xử lý lỗi, versioning, thời hạn lưu và audit policy.

- Không tự mặc định dữ liệu sao chép được phép đồng bộ hai chiều.

## 4. Thay đổi schema và migration

- DAT-01 | Thay đổi cần migration plan, impact analysis, backup/rollback và phép duyệt riêng.

- DAT-02 | Không chạy db push/migrate/seed trên môi trường thực khi chưa duyệt.

- DAT-03 | Thay phiên bản module không tự đổi cấu trúc DB hoặc xóa dữ liệu.

- DAT-04 | Giao dịch quan trọng phải bảo toàn atomicity và constraints.

- DAT-05 | Dữ liệu nhạy cảm không được ghi vào audit theo kiểu plaintext.

## 5. Audit truy vết dữ liệu

- Ghi nhận actor, action, module, resource, target ID, timestamp, result, request/correlation ID.

- Giá trị trước/sau chỉ lưu khi mục đích audit yêu cầu, có chính sách che dữ liệu và retention; không ghi passwords/token.

- Không cam kết mọi bảng đều có thể tự động tái tạo chi tiết nội dung thay đổi nếu chưa thiết kế audit hoặc CDC tương ứng.

## 6. Ca sử dụng liên Module

- Kế toán cần cập nhật trạng thái liên quan Đơn hàng: khuyến nghị API của Sales hoặc bounded write contract đã phê duyệt.

- Nếu Sales thay schema, phải duy trì compatibility hoặc chuyển đổi version Data Contract có kế hoạch rõ ràng.

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


---

# FILE: DEV-07.md

# TALO-MOS-V4

## QUY TRÌNH TRIỂN KHAI, KIỂM THỬ VÀ NGHIỆM THU

Mã tài liệu: DEV-07

Phiên bản: 0.1

Trạng thái: DRAFT — CHỜ PHÊ DUYỆT

Ngày soạn: 15/10/2026

Phạm vi: Khung quy tắc phát triển phần mềm; không cấp quyền thực thi thay đổi code/database

Phân loại: các quy tắc được gắn nhãn ĐỀ XUẤT trong bộ tài liệu chưa trở thành quy định bắt buộc cho đến khi chủ hệ thống phê duyệt. IAM v0.3 và ranh giới CLAUDE.md đang có được kế thừa, không ghi đè.

## 1. Bảy cổng triển khai

- GATE 1 Business Scope: business flow, actor, case bình thường/ngoại lệ, tiêu chí thành công.

- GATE 2 Architecture Review: Foundation/IAM/Module/DB owners, khả năng tái dùng, tác động.

- GATE 3 UI Specification: AppShell, 4 Block, mockup hoặc HTML prototype được duyệt.

- GATE 4 Contract Design: API/Capability/Authorization/Data/Workflow, validation, audit.

- GATE 5 Approval: file scope, dependencies, DB changes, rollback, test plan.

- GATE 6 Development & Tests: thực hiện trong scope, test security/business/regression.

- GATE 7 Acceptance & Handoff: nghiệm thu với bằng chứng, bàn giao, tồn đọng.

## 2. Đầu vào bắt buộc của task Claude Code

- Mục tiêu và out-of-scope, danh sách file được phép chỉnh, liên kết quyết định/contract, điều kiện test, quyền thao tác DB, rollback.

- Không nhầm plan với phê duyệt triển khai. Một yêu cầu đọc GitHub không cho phép sửa repository.

- Cần xác nhận Git branch/HEAD, trạng thái worktree, cấu hình môi trường và database mục tiêu trước khi thực thi tác vụ có side effect.

## 3. Tiêu chí kiểm thử

- Kiểm tra quyền deny override, role aggregation, trạng thái Account, Module disable và feature registration.

- Kiểm tra điều kiện nghiệp vụ, transaction, workflow, audit, migration compatibility.

- Kiểm tra AppShell responsive, sidebar, accessibility, 4 Block và visual consistency.

- Kiểm tra local/test tách production, không tuyên bố production-ready từ kết quả local.

## 4. Mẫu báo cáo nghiệm thu

- Mã task/version/commit; phạm vi đã làm; file sửa; test và lệnh thực chạy; PASS/FAIL/NOT TESTED; ảnh hưởng DB; vấn đề mở.

- Ghi rõ bằng chứng đã xác minh trực tiếp và thông tin chỉ trích từ báo cáo trước.

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


---

# FILE: FND-02.md

# TALO-MOS-V4

## TIÊU CHUẨN FOUNDATION, APPSHELL VÀ UI/UX

Mã tài liệu: FND-02

Phiên bản: 0.1

Trạng thái: DRAFT — CHỜ PHÊ DUYỆT

Ngày soạn: 15/10/2026

Phạm vi: Khung quy tắc phát triển phần mềm; không cấp quyền thực thi thay đổi code/database

Phân loại: các quy tắc được gắn nhãn ĐỀ XUẤT trong bộ tài liệu chưa trở thành quy định bắt buộc cho đến khi chủ hệ thống phê duyệt. IAM v0.3 và ranh giới CLAUDE.md đang có được kế thừa, không ghi đè.

## 1. Các năng lực nền tảng

- AppShell: Topbar, Sidebar, Workspace, ngữ cảnh đăng nhập.

- Navigation & Routing: điều hướng phân hệ/màn hình dựa trên module đã đăng ký và quyền hiệu lực.

- Registry, IAM, Shared Services, System Configuration và Integration Layer phải tách trách nhiệm.

## 2. Chuẩn giao diện màn hình

- UI-01 | Block 1: Breadcrumb chỉ vị trí điều hướng.

- UI-02 | Block 2: tên màn hình và mô tả.

- UI-03 | Block 3: các chức năng trong màn hình đang mở.

- UI-04 | Block 4: nội dung tương ứng chức năng được chọn.

- UI-05 | Sidebar dùng để điều hướng Module/Màn hình, không đồng nhất với Block 3.

- UI-06 | Sidebar mở rộng/thu gọn phải tái phân phối chiều rộng Workspace; flyout thu gọn chỉ hiện một menu khi hover.

## 3. Quy tắc hành vi chung

- Màn hình và thao tác chỉ được hiển thị phù hợp với quyền hiệu lực, nhưng backend vẫn phải xác nhận quyền cho mọi request.

- Không tự tạo menu chọn chi nhánh hoặc chọn công ty; tên công ty có thể chỉ là thông tin hiển thị.

- Dashboard là một màn hình nghiệp vụ độc lập, không phải điều kiện để AppShell hoạt động.

## 4. Vòng đời giao diện

- Trước xây nhiều Module phải chốt mẫu AppShell/4 Block và thiết lập mẫu màn hình nghiệp vụ.

- Demo HTML sử dụng dữ liệu mô phỏng phải ghi rõ và không được xem là API/backend đã hoàn thành.

- Thay đổi UI dùng chung phải kiểm tra ảnh hưởng đến responsive, điều hướng, truy cập bằng bàn phím và module đã tích hợp.

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


---

# FILE: GOV-00.md

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


---

# FILE: IAM-04.md

# TALO-MOS-V4

## TIÊU CHUẨN ĐỊNH DANH, XÁC THỰC VÀ PHÂN QUYỀN

Mã tài liệu: IAM-04

Phiên bản: 0.1

Trạng thái: DRAFT — CHỜ PHÊ DUYỆT

Ngày soạn: 15/10/2026

Phạm vi: Khung quy tắc phát triển phần mềm; không cấp quyền thực thi thay đổi code/database

Phân loại: các quy tắc được gắn nhãn ĐỀ XUẤT trong bộ tài liệu chưa trở thành quy định bắt buộc cho đến khi chủ hệ thống phê duyệt. IAM v0.3 và ranh giới CLAUDE.md đang có được kế thừa, không ghi đè.

## 1. Baseline đã được quyết định

- IAM v0.3: mỗi Membership tối đa một Account hiện hành; giữ lịch sử Account disabled.

- Một Account nhận nhiều Role; Role là gói quyền, không có Switch Role hoặc Switch Account.

- Effective Grants = (permissions từ các Role hiệu lực ∪ Direct ALLOW) − Direct DENY; có kiểm tra trạng thái tài khoản, thời gian và assurance.

## 2. Tích hợp Capability

- Permission phải định vị chính xác module_code, resource_code/function_key, operation/action_key.

- Foundation nhận khai báo Capability; IAM lưu grants; Module không tự cập nhật cấp quyền.

- Ma trận quyền chia theo Module, dòng là chức năng, cột là Action có hỗ trợ; phân biệt Role grants, Direct ALLOW, Direct DENY và quyền hiệu lực.

## 3. Authentication hiện có và giới hạn

- Login, first-change, GET session, logout đã có mã nguồn; màn hình Welcome hiện chưa phải AppShell.

- 5 lần sai khóa 15 phút; activation 15 phút; authenticated session tối đa 10 giờ, idle 60 phút; các giá trị này không mặc định cho Admin chỉnh trên UI.

- Password recovery tự phục vụ, MFA, email assurance Level 2 và account-management UI không thuộc phạm vi AUTH-API v1 đã hoàn thiện.

## 4. Quy tắc an toàn

- IAM-01 | Mọi endpoint nghiệp vụ xác thực và kiểm tra quyền ở backend.

- IAM-02 | Quyền APPROVE không đủ để duyệt mọi bản ghi hoặc mọi bước.

- IAM-03 | Thu hồi role/permission và disable Account phải được xử lý nhất quán với session, audit và effective permissions.

- IAM-04 | Không tự cấp quyền AccountManager tương đương Admin.

- IAM-05 | Các yêu cầu chỉnh IAM schema v0.3 cần đề xuất và phê duyệt độc lập.

## 5. Các điểm còn mở

- Thiết kế màn hình quản trị Account/Role/Permission, quản lý nhiều bước duyệt, reissue/revoke cấp quản trị và MFA cần đặc tả riêng.

- Không tuyên bố các cơ chế Security Policy động đã tồn tại chỉ vì backend đang có constants.

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


---

# FILE: MOD-03.md

# TALO-MOS-V4

## HỢP ĐỒNG MODULE CAPABILITY VÀ QUẢN LÝ VÒNG ĐỜI

Mã tài liệu: MOD-03

Phiên bản: 0.1

Trạng thái: DRAFT — CHỜ PHÊ DUYỆT

Ngày soạn: 15/10/2026

Phạm vi: Khung quy tắc phát triển phần mềm; không cấp quyền thực thi thay đổi code/database

Phân loại: các quy tắc được gắn nhãn ĐỀ XUẤT trong bộ tài liệu chưa trở thành quy định bắt buộc cho đến khi chủ hệ thống phê duyệt. IAM v0.3 và ranh giới CLAUDE.md đang có được kế thừa, không ghi đè.

## 1. Mô hình chuẩn

- Ba tầng catalog: MODULE → FUNCTION → ACTION; không tự đồng nhất Menu, Route, Screen với Permission.

- Module công bố danh sách chức năng và hành động hỗ trợ; Foundation đăng ký và xác minh compatibility; IAM thực hiện cấp quyền cho Role/Account.

- Workflow và Data Contract là khai báo mở rộng, không phải tầng cấp quyền thứ tư.

## 2. Manifest v1 — trường bắt buộc đề xuất

- contract_version, module_key, module_name, module_version.

- functions[].function_key, name, route_key, actions[].action_key.

- Tùy chọn: workflow_key, rule_keys, data_contract_refs, deprecated_in, replaces.

- Định danh bất biến; đổi tên hiển thị không được làm mất quyền. Danh sách module phải được kiểm tra xung đột khóa và phiên bản.

## 3. Quy tắc tích hợp

- MOD-01 | Module chỉ đăng ký khả năng, không tự cấp quyền hay mở khóa truy cập.

- MOD-02 | Capability chưa được định nghĩa thì không được hiện nút cấp quyền.

- MOD-03 | Action mới mặc định chưa cấp cho tài khoản nào.

- MOD-04 | Module upgrade phải trình bản so sánh chức năng/Action thêm, đổi, bỏ và migration plan nếu có.

- MOD-05 | Module disable/uninstall không tự xóa dữ liệu, audit hoặc quyền lịch sử.

- MOD-06 | Mỗi manifest cần validation và approval trước khi active.

## 4. Ví dụ module Kinh doanh

- SALES.ORDER có thể đăng ký VIEW, CREATE, UPDATE, DELETE, SUBMIT, APPROVE.

- SALES.PRODUCT có thể đăng ký VIEW, CREATE, UPDATE, HIDE.

- Các ví dụ chỉ để xác minh cấu trúc hợp đồng; không phải quyền đã được cấp hoặc chức năng đã triển khai.

## 5. Kiểm thử hợp đồng

- Kiểm tra module_key trùng, function_key trùng, action không hợp lệ, route không tồn tại, contract_version không tương thích.

- Kiểm tra update có đổi key, xóa capability đang có grants, thăng quyền ngầm, disable module nhưng session còn hiệu lực.

- Đầu ra chuẩn: manifest validated, diff phiên bản, tác động IAM, dữ liệu và kế hoạch rollback.

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


---

# FILE: REF-08.md

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


---

# FILE: WFL-06.md

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
