# TALO-MOS-V4 — FOUNDATION DATABASE DESIGN BASELINE v1.0
**Phê duyệt:** 16/10/2026. **Phạm vi:** 14 bảng / 125 trường, 30 quyết định, K01–K12. **Gate hiện tại:** DDL REVIEW-ONLY; không có quyền chạy SQL.
**LƯU Ý:** Đây là bản phê duyệt thiết kế từ cuộc trao đổi với chủ dự án, không phải chứng cứ PostgreSQL đã tạo bảng. 11 bảng IAM v0.3 giữ nguyên. Governance v0.1 còn DRAFT và là tài liệu tham khảo, không thay thế quyết định mới được duyệt.

## Phạm vi khóa
- Chỉ 14 bảng dưới schema `foundation`, đúng 125 trường, không thêm bảng/cột/trigger/index/enum/function/service mà chưa duyệt.
- B01, B02 giữ nguyên đã khóa; B12 dùng `version_action_id` (không dùng `action_id`); B08 `module_id` có thể NULL (K06).
- Mọi PK/FK/UNIQUE/CHECK và ràng buộc liên bảng theo phần dưới là căn cứ review. Nếu không thể thi hành chính xác mà không tự thêm cấu trúc: BLOCKED.
- Không sửa IAM v0.3, Auth, dev/test DB hoặc dữ liệu.

## Inventory
| # | Table | Số trường | Trạng thái |
|---|---|---:|---|
| 01 | `fnd_modules` | 9 | ĐÃ KHÓA |
| 02 | `fnd_module_versions` | 12 | ĐÃ KHÓA |
| 03 | `fnd_functions` | 6 | ĐÃ DUYỆT DATA DICTIONARY |
| 04 | `fnd_actions` | 5 | ĐÃ DUYỆT DATA DICTIONARY |
| 05 | `fnd_version_functions` | 7 | ĐÃ DUYỆT DATA DICTIONARY |
| 06 | `fnd_version_actions` | 7 | ĐÃ DUYỆT DATA DICTIONARY |
| 07 | `fnd_module_events` | 9 | ĐÃ DUYỆT DATA DICTIONARY |
| 08 | `fnd_audit_logs` | 15 | ĐÃ DUYỆT DATA DICTIONARY |
| 09 | `fnd_navigation_items` | 8 | ĐÃ DUYỆT DATA DICTIONARY |
| 10 | `fnd_data_contracts` | 11 | ĐÃ DUYỆT DATA DICTIONARY |
| 11 | `fnd_data_fields` | 9 | ĐÃ DUYỆT DATA DICTIONARY |
| 12 | `fnd_data_access_rules` | 8 | ĐÃ DUYỆT DATA DICTIONARY |
| 13 | `fnd_compatibility_checks` | 9 | ĐÃ DUYỆT DATA DICTIONARY |
| 14 | `fnd_compatibility_changes` | 10 | ĐÃ DUYỆT DATA DICTIONARY |

## Data Dictionary — chính xác 125 trường
### B01 `foundation.fnd_modules`
Danh tính và bật/tắt Module; định danh tồn tại xuyên mọi phiên bản.

| Field | Type | Required | Key/Default | Description |
|---|---|---|---|---|
| `module_id` | UUID | Có | PK; tự sinh | Mã Module nội bộ, bất biến |
| `module_key` | VARCHAR(80) | Có | UQ; không phân biệt hoa/thường | Mã nghiệp vụ cố định |
| `module_name` | VARCHAR(150) | Có | Không mặc định | Tên Module |
| `description` | TEXT | Không | NULL | Mô tả Module |
| `module_type` | VARCHAR(20) | Có | INTERNAL / EXTERNAL | Loại Module |
| `is_enabled` | BOOLEAN | Có | FALSE | Cho phép bật/tắt, phải kiểm tra MIC |
| `created_at` | TIMESTAMPTZ | Có | NOW() | Thời điểm tạo |
| `updated_at` | TIMESTAMPTZ | Có | NOW() khi tạo | Backend cập nhật khi thay đổi |
| `created_by_account_id` | UUID | Không | NULL; tham chiếu logic IAM | Tài khoản đăng ký |

**Ràng buộc / quy tắc:**
- Không được sửa module_key hoặc module_type sau đăng ký.
- Không xóa vật lý; đăng ký mới mặc định tắt.
- IAM v0.3 không có FK mới từ bảng IAM.

### B02 `foundation.fnd_module_versions`
Mỗi bản V1/V2 có hồ sơ MIC, thời gian xét duyệt và trạng thái riêng.

| Field | Type | Required | Key/Default | Description |
|---|---|---|---|---|
| `version_id` | UUID | Có | PK; tự sinh | Định danh phiên bản |
| `module_id` | UUID | Có | FK → B01 | Module chủ quản |
| `module_version` | VARCHAR(40) | Có | UQ với module_id | Mã phiên bản, ví dụ 2.0.1 |
| `contract_version` | VARCHAR(40) | Có | Không mặc định | Phiên bản chuẩn MIC |
| `status` | VARCHAR(20) | Có | DRAFT | DRAFT, IN_REVIEW, APPROVED, ACTIVE, RETIRED, REJECTED |
| `manifest_json` | JSONB | Điều kiện | NULL khi DRAFT | MIC đầy đủ trước IN_REVIEW |
| `manifest_hash` | CHAR(64) | Điều kiện | NULL khi DRAFT | SHA-256 của MIC đã chuẩn hóa |
| `submitted_by_account_id` | UUID | Không | NULL; tham chiếu logic IAM | Người nộp |
| `created_at` | TIMESTAMPTZ | Có | NOW() | Lúc đăng ký phiên bản |
| `reviewed_by_account_id` | UUID | Điều kiện | NULL trước quyết định | Người phê duyệt/từ chối có quyền IAM |
| `reviewed_at` | TIMESTAMPTZ | Điều kiện | NULL trước quyết định | Thời điểm APPROVED/REJECTED |
| `activated_at` | TIMESTAMPTZ | Điều kiện | NULL trước khi ACTIVE | Thời điểm kích hoạt đầu tiên |

**Ràng buộc / quy tắc:**
- UQ(module_id,module_version). Tối đa một ACTIVE mỗi Module.
- Khóa MIC từ IN_REVIEW; thay đổi phải nộp phiên bản mới, không ghi đè.
- V1 ACTIVE → RETIRED và V2 → ACTIVE trong một giao dịch.
- Phải xử lý BLOCK và kiểm tra lại trước kích hoạt; rollback chỉ sau kiểm tra tương thích.

### B03 `foundation.fnd_functions`
Định danh Function bền vững qua V1/V2; chức năng thuộc một Module.

| Field | Type | Required | Key/Default | Description |
|---|---|---|---|---|
| `function_id` | UUID | Có | PK; tự sinh | Định danh Function |
| `module_id` | UUID | Có | FK → B01 | Module sở hữu |
| `function_key` | VARCHAR(100) | Có | UQ với module_id | Mã chức năng ổn định |
| `created_at` | TIMESTAMPTZ | Có | NOW() | Ngày ghi nhận |
| `retired_at` | TIMESTAMPTZ | Không | NULL | Ngày định danh chính thức ngừng hỗ trợ |
| `replaces_function_id` | UUID | Không | FK tự tham chiếu B03 | Function được thay thế |

**Ràng buộc / quy tắc:**
- UQ(module_id,function_key), chuẩn hóa K01.
- Function thay thế phải cùng Module, không tạo vòng quan hệ.
- Đổi tên không đổi key; đổi bản chất phải dùng key mới.
- Không xóa lịch sử Function.

### B04 `foundation.fnd_actions`
Định danh Action bền vững; mỗi Action thuộc duy nhất một Function.

| Field | Type | Required | Key/Default | Description |
|---|---|---|---|---|
| `action_id` | UUID | Có | PK; tự sinh | Định danh Action |
| `function_id` | UUID | Có | FK → B03 | Function sở hữu |
| `action_key` | VARCHAR(30) | Có | UQ với function_id | Mã Action: VIEW, CREATE, UPDATE, ... |
| `created_at` | TIMESTAMPTZ | Có | NOW() | Thời gian ghi nhận |
| `retired_at` | TIMESTAMPTZ | Không | NULL | Ngừng hỗ trợ định danh |

**Ràng buộc / quy tắc:**
- UQ(function_id,action_key); không tự chuyển Function.
- Đổi ý nghĩa Action phải tạo mã mới; không tự cấp quyền IAM.
- Không xóa Action lịch sử.

### B05 `foundation.fnd_version_functions`
Gắn Function vào từng phiên bản; định nghĩa hiển thị có thể khác nhau.

| Field | Type | Required | Key/Default | Description |
|---|---|---|---|---|
| `version_function_id` | UUID | Có | PK; tự sinh | Mã liên kết phiên bản/Function |
| `version_id` | UUID | Có | FK → B02 | Phiên bản được công bố |
| `function_id` | UUID | Có | FK → B03 | Function được công bố |
| `display_name` | VARCHAR(150) | Có | Không mặc định | Tên hiển thị phiên bản này |
| `route_key` | VARCHAR(200) | Không | NULL | Route/screen đề nghị |
| `definition_hash` | CHAR(64) | Điều kiện | NULL khi chưa hoàn thiện | Hash định nghĩa Function |
| `is_deprecated` | BOOLEAN | Có | FALSE | Đánh dấu sắp ngừng hỗ trợ |

**Ràng buộc / quy tắc:**
- UQ(version_id,function_id); Function và Version phải cùng Module.
- Định nghĩa bị khóa cùng MIC từ IN_REVIEW.
- Route không tự cấp quyền hiển thị.

### B06 `foundation.fnd_version_actions`
Gắn Action đúng Function, đúng phiên bản và định nghĩa hành vi.

| Field | Type | Required | Key/Default | Description |
|---|---|---|---|---|
| `version_action_id` | UUID | Có | PK; tự sinh | Mã liên kết phiên bản/Action |
| `version_function_id` | UUID | Có | FK → B05 | Function của phiên bản |
| `action_id` | UUID | Có | FK → B04 | Action được công bố |
| `description` | TEXT | Không | NULL | Mô tả Action ở phiên bản này |
| `action_spec` | JSONB | Điều kiện | NULL khi chưa hoàn thiện | Định nghĩa thao tác |
| `definition_hash` | CHAR(64) | Điều kiện | NULL khi chưa hoàn thiện | Hash định nghĩa Action |
| `is_deprecated` | BOOLEAN | Có | FALSE | Đánh dấu sắp ngừng hỗ trợ |

**Ràng buộc / quy tắc:**
- UQ(version_function_id,action_id); Action phải thuộc đúng Function.
- Action mới không tự thừa kế quyền.
- Khóa khai báo theo phiên bản từ IN_REVIEW.

### B07 `foundation.fnd_module_events`
Nhật ký vòng đời, đăng ký, bật/tắt, duyệt và nâng cấp Module.

| Field | Type | Required | Key/Default | Description |
|---|---|---|---|---|
| `event_id` | UUID | Có | PK; tự sinh | Mã sự kiện vòng đời |
| `module_id` | UUID | Có | FK → B01 | Module liên quan |
| `version_id` | UUID | Không | FK → B02 | Phiên bản nếu có |
| `event_type` | VARCHAR(40) | Có | Mã sự kiện chuẩn | REGISTER, SUBMIT, APPROVE, ... |
| `actor_account_id` | UUID | Không | NULL; IAM logical ref | Người thực hiện |
| `before_state` | JSONB | Không | NULL | Trạng thái trước |
| `after_state` | JSONB | Không | NULL | Trạng thái sau |
| `occurred_at` | TIMESTAMPTZ | Có | NOW() | Thời điểm |
| `correlation_id` | VARCHAR(100) | Không | NULL | Mã truy vết yêu cầu |

**Ràng buộc / quy tắc:**
- Chỉ thêm, không sửa hoặc xóa log.
- Version nếu có phải thuộc Module được ghi.
- Không ghi dữ liệu nhạy cảm không cần thiết.

### B08 `foundation.fnd_audit_logs`
Nhật ký thao tác ứng dụng dùng chung cho Foundation và Module; IAM Audit giữ nguyên.

| Field | Type | Required | Key/Default | Description |
|---|---|---|---|---|
| `audit_id` | UUID | Có | PK; tự sinh | Khóa chính bản audit |
| `event_id` | UUID | Có | UQ; định danh sự kiện | Dùng để chống ghi trùng |
| `module_id` | UUID | Không | FK → B01; NULL cho Foundation | Nguồn Module, có thể không thuộc Module |
| `version_id` | UUID | Không | FK → B02 | Phiên bản nếu có |
| `actor_account_id` | UUID | Không | NULL; IAM logical ref | Người thực hiện |
| `session_id` | UUID | Không | NULL; IAM logical ref | Phiên đăng nhập |
| `action_code` | VARCHAR(120) | Có | Mã Audit K07 | Thao tác đã thực hiện |
| `target_type` | VARCHAR(100) | Có | Không mặc định | Loại đối tượng tác động |
| `target_id` | VARCHAR(160) | Không | NULL | Mã đối tượng |
| `outcome` | VARCHAR(20) | Có | SUCCESS/FAILURE/DENIED | Kết quả do backend xác định |
| `occurred_at` | TIMESTAMPTZ | Có | Thời gian phát sinh | Thời điểm sự kiện nguồn |
| `recorded_at` | TIMESTAMPTZ | Có | NOW() | Thời điểm nhận bản audit |
| `correlation_id` | VARCHAR(100) | Không | NULL | Liên kết request |
| `source_service` | VARCHAR(120) | Có | Không mặc định | Backend/service phát sinh |
| `metadata` | JSONB | Không | NULL | Chi tiết được phép ghi |

**Ràng buộc / quy tắc:**
- K06: module_id có thể NULL cho thao tác toàn Foundation.
- event_id UNIQUE; audit chỉ ghi thêm, không UPDATE/DELETE.
- Backend xác định actor/outcome; không tin frontend.
- Không được báo thao tác quan trọng thành công khi chưa bảo đảm audit.
- Nếu module_id và version_id có giá trị phải đồng nhất.

### B09 `foundation.fnd_navigation_items`
Cây Sidebar, nhóm menu và liên kết Function.

| Field | Type | Required | Key/Default | Description |
|---|---|---|---|---|
| `navigation_id` | UUID | Có | PK; tự sinh | Định danh menu |
| `parent_id` | UUID | Không | FK tự tham chiếu B09 | Menu cha |
| `module_id` | UUID | Không | FK → B01 | Module nếu là menu Module |
| `function_id` | UUID | Không | FK → B03 | Function nếu là menu mở màn hình |
| `menu_title` | VARCHAR(150) | Có | Không mặc định | Tiêu đề trên menu |
| `sort_order` | INTEGER | Có | 0 | Thứ tự menu |
| `is_visible` | BOOLEAN | Có | TRUE | Cấu hình hiển thị |
| `created_at` | TIMESTAMPTZ | Có | NOW() | Ngày tạo |

**Ràng buộc / quy tắc:**
- Chống quan hệ parent vòng/cycle.
- Nếu menu trỏ Function, phải cùng Module.
- Menu hệ thống/menu cha có thể NULL module_id/function_id.
- UI chỉ hiện Function của ACTIVE Module và có IAM grants.

### B10 `foundation.fnd_data_contracts`
Tài nguyên dữ liệu Module công bố theo từng phiên bản.

| Field | Type | Required | Key/Default | Description |
|---|---|---|---|---|
| `data_contract_id` | UUID | Có | PK; tự sinh | Mã hợp đồng dữ liệu |
| `version_id` | UUID | Có | FK → B02 | Phiên bản Module |
| `resource_key` | VARCHAR(120) | Có | UQ cùng version_id | Mã tài nguyên |
| `data_owner_key` | VARCHAR(80) | Có | Không mặc định | Đơn vị/Module sở hữu |
| `interface_kind` | VARCHAR(20) | Có | API/VIEW/EVENT/DIRECT_DB | Cách truy cập dữ liệu |
| `schema_name` | VARCHAR(100) | Không | NULL | Schema vật lý nếu có |
| `table_name` | VARCHAR(100) | Không | NULL | Table vật lý nếu có |
| `schema_version` | VARCHAR(40) | Có | Không mặc định | Phiên bản Data Contract |
| `contract_spec` | JSONB | Có | Không mặc định | Định nghĩa hợp đồng dữ liệu |
| `contract_hash` | CHAR(64) | Có | SHA-256 | Dấu kiểm tra hợp đồng |
| `created_at` | TIMESTAMPTZ | Có | NOW() | Ngày khai báo |

**Ràng buộc / quy tắc:**
- UQ(version_id,resource_key).
- DIRECT_DB phải qua duyệt riêng; không tự cấp GRANT.
- Không tự tạo bảng/column từ contract_spec.

### B11 `foundation.fnd_data_fields`
Các trường dữ liệu mong đợi để đối chiếu thay đổi schema V1/V2.

| Field | Type | Required | Key/Default | Description |
|---|---|---|---|---|
| `field_id` | UUID | Có | PK; tự sinh | Khóa trường |
| `data_contract_id` | UUID | Có | FK → B10 | Hợp đồng dữ liệu |
| `field_name` | VARCHAR(100) | Có | UQ trong contract | Tên trường |
| `field_type` | VARCHAR(100) | Có | Không mặc định | Kiểu dữ liệu dự kiến |
| `is_required` | BOOLEAN | Có | FALSE | Trường bắt buộc khi nghiệp vụ ghi dữ liệu |
| `default_expression` | TEXT | Không | NULL | Biểu thức mặc định mô tả |
| `is_primary_key` | BOOLEAN | Có | FALSE | Thành phần PK khai báo |
| `references_target` | VARCHAR(250) | Không | NULL; schema.table.column | Đích liên kết dữ liệu |
| `description` | TEXT | Không | NULL | Mô tả |

**Ràng buộc / quy tắc:**
- UQ(data_contract_id,field_name).
- K10: references_target nếu có chuẩn schema.table.column.
- Đây chỉ là mô tả, không tự chạy DDL theo field_type/default_expression.

### B12 `foundation.fnd_data_access_rules`
Khai báo Action cụ thể của phiên bản tác động tài nguyên dữ liệu.

| Field | Type | Required | Key/Default | Description |
|---|---|---|---|---|
| `access_rule_id` | UUID | Có | PK; tự sinh | Mã quy tắc |
| `data_contract_id` | UUID | Có | FK → B10 | Hợp đồng dữ liệu |
| `version_action_id` | UUID | Có | FK → B06 (thay action_id) | Action theo phiên bản |
| `data_operation` | VARCHAR(20) | Có | SELECT/INSERT/UPDATE/DELETE | Thao tác dữ liệu |
| `approval_mode` | VARCHAR(20) | Có | UNSPECIFIED | REQUIRED/NOT_REQUIRED/UNSPECIFIED |
| `workflow_key` | VARCHAR(120) | Không | NULL | Mã quy trình duyệt |
| `is_enabled` | BOOLEAN | Có | FALSE | Trạng thái quy tắc đã chấp thuận |
| `created_at` | TIMESTAMPTZ | Có | NOW() | Ngày đăng ký |

**Ràng buộc / quy tắc:**
- UQ(data_contract_id,version_action_id,data_operation).
- Version Action và Data Contract phải thuộc cùng Version.
- UNSPECIFIED không tự được phép bỏ duyệt; approval REQUIRED cần workflow hợp lệ.
- Không tự tạo Permission/GRANT.

### B13 `foundation.fnd_compatibility_checks`
Một lần kiểm tra tương thích giữa phiên bản mới/cũ và môi trường.

| Field | Type | Required | Key/Default | Description |
|---|---|---|---|---|
| `check_id` | UUID | Có | PK; tự sinh | Khóa lần kiểm tra |
| `module_id` | UUID | Có | FK → B01 | Module liên quan |
| `from_version_id` | UUID | Không | FK → B02 | Phiên bản cũ, NULL nếu lần đầu |
| `to_version_id` | UUID | Có | FK → B02 | Phiên bản mới |
| `environment` | VARCHAR(20) | Có | DEV/TEST/PROD | Môi trường được kiểm tra |
| `check_result` | VARCHAR(20) | Có | PENDING | PASS/WARN/BLOCK/FAILED/PENDING |
| `database_fingerprint` | CHAR(64) | Không | NULL | Dấu kiểm tra metadata DB |
| `started_at` | TIMESTAMPTZ | Có | NOW() | Bắt đầu |
| `completed_at` | TIMESTAMPTZ | Không | NULL | Kết thúc |

**Ràng buộc / quy tắc:**
- Phiên bản nguồn/đích phải thuộc cùng Module.
- Nguồn và đích khác nhau nếu nguồn có giá trị.
- BLOCK không cho kích hoạt.

### B14 `foundation.fnd_compatibility_changes`
Các sai khác chi tiết: thêm, mất, sửa, thiếu; kết quả xử lý.

| Field | Type | Required | Key/Default | Description |
|---|---|---|---|---|
| `change_id` | UUID | Có | PK; tự sinh | Khóa sai khác |
| `check_id` | UUID | Có | FK → B13 | Thuộc lần kiểm tra |
| `change_area` | VARCHAR(30) | Có | FUNCTION/ACTION/DATA/API | Miền sai khác |
| `object_key` | VARCHAR(250) | Có | Không mặc định | Định danh đối tượng sai khác |
| `change_type` | VARCHAR(30) | Có | ADDED/REMOVED/MODIFIED/MISSING | Loại sai khác |
| `severity` | VARCHAR(20) | Có | INFO/WARNING/BLOCKING | Mức ảnh hưởng |
| `previous_value` | JSONB | Không | NULL | Hiện trạng cũ |
| `proposed_value` | JSONB | Không | NULL | Bản đề xuất |
| `resolution_status` | VARCHAR(20) | Có | OPEN | Tình trạng xử lý |
| `details` | TEXT | Không | NULL | Giải thích chênh lệch |

**Ràng buộc / quy tắc:**
- Mọi khác biệt thuộc một lần check.
- BLOCKING phải giải quyết và kiểm tra lại; không đơn thuần đổi resolution_status.
- Không tự chạy sửa database hoặc cấp quyền.

## 30 quyết định nguyên tắc
### A — Danh tính, chức năng, phiên bản
01. Một Function thuộc duy nhất một Module; danh tính xuyên phiên bản.
02. Đổi tên chức năng nhưng không đổi bản chất: giữ function_key.
03. Đổi bản chất Function: mã mới, có tham chiếu thay thế.
04. Action thuộc Function; mã ổn định giữa V1/V2.
05. Action đổi ý nghĩa phải dùng mã mới.
06. Ngừng công bố Function/Action trong V2 nhưng giữ bản ghi lịch sử.
### B — IAM, menu
07. Đối chiếu quyền với IAM.module_code/resource_code/operation; không thêm FK vào IAM.
08. Action mới không có quyền hiệu lực trước khi IAM cấp đúng quy trình.
09. Foundation quản lý cây menu, Module khai báo function và route.
10. Chỉ hiện chức năng thuộc phiên bản ACTIVE.
11. Module tắt: ẩn menu và chặn API; không xóa IAM grants.
### C — MIC, kết nối
12. MIC-01 đến MIC-10 đều phải được khai báo.
13. Xác minh nguồn gửi tin cậy và Module đã đăng ký.
14. SHA-256 trên nội dung chuẩn hóa bằng một quy tắc duy nhất.
15. Không đáp ứng Audit: chặn kích hoạt.
16. V2 khác V1: luôn báo cáo khác biệt và duyệt trước kích hoạt.
### D — Data Contract
17. Ưu tiên API của Module sở hữu dữ liệu; DIRECT_DB phải duyệt riêng.
18. Module nghiệp vụ chịu trách nhiệm dữ liệu; Foundation ghi nhận hợp đồng.
19. Data Contract gắn với phiên bản Module.
20. Rule tác động dữ liệu liên kết Version Action.
21. Schema drift V2: báo cáo, migration phải được duyệt riêng.
22. IAM xác thực quyền; Module thực thi quy trình phê duyệt.
### E — Audit
23. Application Audit chuẩn dùng chung; IAM Audit giữ nguyên.
24. Backend ghi Audit qua hợp đồng, không tin frontend.
25. Ghi thao tác quan trọng, ghi dữ liệu và từ chối quyền.
26. Không báo thành công nếu không bảo đảm audit cho thao tác quan trọng.
27. Module không sửa/xóa lịch sử Audit.
### F — Nâng cấp & khóa schema
28. V2 tạo bảng: kiểm tra khóa, dữ liệu cũ và kế hoạch triển khai.
29. Rollback phải kiểm tra tương thích API và dữ liệu.
30. Chỉ qua Gate SQL khi Data Dictionary, quan hệ, status và MIC đã khóa.

## 15 quyết định phiên bản B02
01. V1/V2/V3 tồn tại lịch sử, không ghi đè/xóa phiên bản.
02. Tối đa một ACTIVE / Module.
03. DRAFT → IN_REVIEW → APPROVED → ACTIVE → RETIRED, có REJECTED.
04. MIC đầy đủ theo phiên bản, không sửa hồ sơ đã APPROVED.
05. Hồ sơ thay đổi phải nộp phiên bản/bản sửa đổi mới.
06. Phê duyệt yêu cầu quyền IAM được xác thực ở backend.
07. Trước ACTIVE phải có báo cáo khác biệt và hết BLOCK.
08. Rollback chỉ sau kiểm tra tương thích dữ liệu và API.
09. REJECTED bất biến; nộp phiên bản mới để xét lại.
10. Kích hoạt V2 và RETIRED V1 cùng transaction; lỗi thì không đổi cả hai.
11. DRAFT có thể thiếu MIC; phải đủ trước IN_REVIEW.
12. Mỗi bản sửa đổi tăng mã phiên bản, ví dụ 2.0.1.
13. MIC khóa từ IN_REVIEW; muốn sửa cần phiên bản mới.
14. Kích hoạt/swap trạng thái trong transaction nguyên tử.
15. reviewed_by/reviewed_at ghi khi APPROVED/REJECTED; activated_at ghi lần ACTIVE đầu tiên.

## Quyết định kỹ thuật K01–K12
- **K01:** Mã Module/Function/Action dùng chữ hoa, số và _; kiểm tra trùng không phân biệt hoa/thường.
- **K02:** Không DELETE vật lý Module, Version, Function, Action, Audit, Event đã lưu lịch sử; kiểm soát bằng DB/backend.
- **K03:** Backend cập nhật fnd_modules.updated_at; không tự tạo trigger.
- **K04:** MIC và các khai báo Function/Action/Data Contract của version không được sửa từ IN_REVIEW.
- **K05:** IAM matching: module_key ↔ module_code, function_key ↔ resource_code, action_key ↔ operation; không sửa IAM.
- **K06:** fnd_audit_logs.module_id có thể NULL với sự kiện thuộc toàn Foundation.
- **K07:** Mã Audit được chuẩn hóa riêng; không bắt buộc ghép mã dài vượt VARCHAR(120).
- **K08:** Menu cha/hệ thống có thể không có Function; Module menu phải kiểm tra ACTIVE và IAM.
- **K09:** retired_at chỉ ghi khi định danh chính thức ngừng hỗ trợ, không phải chỉ vắng mặt một phiên bản.
- **K10:** references_target có định dạng schema.table.column khi trỏ dữ liệu vật lý.
- **K11:** BLOCK phải được xử lý và kiểm tra lại, không chỉ đánh dấu RESOLVED.
- **K12:** Chỉ backend/service được tin cậy ghi Audit; cấm sửa/xóa log.

## Hồ sơ MIC Module gửi Foundation
- **MIC-01:** Danh tính: module_key, tên, version, chuẩn MIC
- **MIC-02:** Danh sách Function, định danh và ý nghĩa
- **MIC-03:** Danh sách Action và bản chất thao tác
- **MIC-04:** Route/screen/menu dự kiến
- **MIC-05:** API endpoints, request/response, lỗi
- **MIC-06:** Tài nguyên dữ liệu, schema/bảng/cột/quan hệ nếu có
- **MIC-07:** Ánh xạ quyền IAM, không cấp quyền
- **MIC-08:** Mã sự kiện và chuẩn Audit
- **MIC-09:** Khác biệt/compatibility với V1; lần đầu khai báo INITIAL_REGISTRATION
- **MIC-10:** Phiên bản hồ sơ, hash và bằng chứng kiểm thử

## Foundation trả kết quả
- **FND-01:** Kết quả tiếp nhận: hợp lệ/thiếu/sai định dạng
- **FND-02:** Module ID, Version ID đã đăng ký
- **FND-03:** Đối chiếu Function/Action
- **FND-04:** Đối chiếu quyền IAM có/thiếu
- **FND-05:** Kết quả khác biệt Data Contract/Schema
- **FND-06:** Audit conformance
- **FND-07:** Diff phiên bản V1/V2
- **FND-08:** Trạng thái quyết định xét duyệt
- **FND-09:** Chuẩn MIC và hash đã chấp thuận

## Chưa được tự quyết định / cần nêu GAP
- MIC JSON Schema chuẩn chi tiết, canonicalization & SHA-256, xác thực nguồn phát hành Module chưa có đặc tả triển khai đầy đủ.
- Permission IAM cụ thể cho thao tác phê duyệt Module và API effective grants chưa chốt; IAM v0.3 không được tự sửa.
- Chính sách quyền DB/schema owner, grants, role runtime/provisioner, target database chưa duyệt.
- Các ràng buộc xuyên bảng/cấm UPDATE hoặc DELETE/khóa MIC có thể đòi hỏi cơ chế backend hoặc privilege; không tự thêm trigger/procedure ngoài 14 bảng.
- Những danh mục enum/check đầy đủ (đặc biệt resolution_status, event_type, action code) phải được liệt kê đầy đủ trước khi ràng buộc vật lý.
- Chi tiết rollback từ RETIRED về ACTIVE và kiểm tra sau nâng cấp chưa có API/workflow đã duyệt.
- Đối chiếu IAM physical: PostgreSQL v0.3 có các varchar tự do; Foundation mapping là quy ước, không phải FK từ IAM.
- Phạm vi read-only introspection đã xác định IAM 11 bảng, Foundation 0; DB dev và test cùng cấu trúc IAM theo báo cáo DB-INSPECT-01, chưa tái kiểm chứng lượt này.

## Quy tắc khi chuyển thành DDL
- Gate 2: Chỉ đọc, soạn DDL draft để review; KHÔNG thực thi SQL, migration, seed, GRANT, prisma db push hoặc thao tác ghi.
- Nếu DDL yêu cầu thêm cột/bảng/triggers/indexes/policy/permission ngoài phê duyệt: không thêm; nêu rõ conflict, tác động, chờ người dùng.
- IAM v0.3 và schema hiện tại không thay đổi; authorization ở backend vẫn là yêu cầu độc lập.
- Gate 3 cần phê duyệt mới kèm DB đích, schema owner, quyền runtime, SQL được duyệt, test và phương án rollback.
