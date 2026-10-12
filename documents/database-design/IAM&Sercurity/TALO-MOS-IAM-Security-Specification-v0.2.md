# TALO-MOS — IAM & Security
## Đặc tả nghiệp vụ và thiết kế PostgreSQL (Draft triển khai v0.2)

- **Ngày tổng hợp:** 12/10/2026
- **Cơ sở:** Yêu cầu người dùng đã trao đổi, giao diện thiết kế database v0.2 và sơ đồ khái quát được duyệt.
- **Phạm vi phê duyệt:** Chấp thuận **ý tưởng/mô hình v0.2** để chuyển sang bản thiết kế SQL. Không đồng nghĩa đã duyệt mọi ràng buộc kỹ thuật bổ sung hoặc cho phép chạy migration trên production.
- **Tệp đi kèm:** `TALO-MOS-IAM-Security-PostgreSQL-v0.2.sql`.

## 1. Mục tiêu và phạm vi

IAM & Security phục vụ doanh nghiệp quy mô trung bình, chưa cần vận hành mô hình tập đoàn, đa chi nhánh hay phân quyền tổ chức nhiều tầng. Tuy vậy, thiết kế giữ **điểm mở rộng** cho tổ chức, chi nhánh và tài nguyên nghiệp vụ thông qua External REF; chưa kích hoạt cơ chế phân quyền theo chi nhánh trong bản đầu.

Ưu tiên tính đơn giản, khả năng truy vết và quyền làm việc rõ ràng; tránh đưa quá sớm các thành phần IAM cấp tập đoàn, ABAC engine tổng quát, service-account platform, đa IdP hay chính sách bảo mật phức tạp.

## 2. Định nghĩa đã chốt ở mức nghiệp vụ

### 2.1. Membership — Định danh nhân sự

- Được tạo khi một người tham gia hệ thống nhân sự doanh nghiệp, **không phụ thuộc việc có tài khoản để đăng nhập phần mềm**.
- Mang mã nhân viên, trạng thái nhân sự và liên kết tới hồ sơ HR.
- Không bị xóa/tái sử dụng chỉ vì nhân sự nghỉ việc; trạng thái được cập nhật, lịch sử được giữ.
- Tách khỏi User Account: thay đổi vai trò hay dừng truy cập không làm mất định danh nhân sự.

### 2.2. User Account — Tài khoản người dùng

- IT tạo tài khoản và gắn với Membership đã tồn tại.
- `username` **được khởi tạo từ mã nhân viên**; không dùng mã nhân viên làm khóa chính. PK dùng `user_account_id` UUID.
- IT cấp mật khẩu tạm; lần đăng nhập đầu buộc phải thay mật khẩu trước khi tiếp cận nghiệp vụ.
- Có trạng thái vòng đời account độc lập với trạng thái nhân sự.
- Có thể cấp Role ngay khi tạo account, trước khi hoàn thành xác thực; hoặc cấp về sau.

### 2.3. Role — Gói quyền và chức năng

- Role là **pack** các Permission chuẩn của hệ thống, có thể gán nhiều Role cho một User Account.
- Ngoài Role, IT/người có thẩm quyền có thể cấp lẻ Permission vào User Account, hoặc DENY một Permission cụ thể.
- Việc được cấp quyền không tự động vượt giới hạn xác thực và không vượt quy tắc bảo mật hoặc quyền sở hữu dữ liệu.

## 3. Vòng đời cấp tài khoản và xác thực

1. HR/tổ chức ghi nhận người lao động và mã nhân viên → Membership tồn tại.
2. IT tạo User Account, gắn Membership, khởi tạo username từ mã nhân viên, cấp mật khẩu tạm.
3. IT có thể cấp Role/Permission tại thời điểm này. Account vẫn ở trạng thái `PROVISIONED` và chỉ được thực hiện luồng kích hoạt.
4. Lần đăng nhập đầu: xác minh mật khẩu tạm, **bắt buộc đổi mật khẩu**; khi đổi thành công và không có yếu tố khóa khác, tài khoản đạt **cấp 1** và có thể hoạt động theo quyền.
5. User liên kết, xác minh quyền kiểm soát email → đạt **cấp 2**. Một số chức năng nhạy cảm (ví dụ thay đổi tài khoản) có thể được chặn ở cấp 1 và yêu cầu cấp 2.
6. Tài khoản có thể bị khóa, vô hiệu hóa và thu hồi phiên; các Role/Permission đã cấp được giữ phục vụ truy vết.

**Phân biệt:** Hai cấp này là **mức assurance nội bộ TALO-MOS**. Email verified không phải MFA. Không coi email verified là bằng chứng xác thực hai yếu tố cho mỗi lần login.

### Quy tắc tính assurance

- `0`: chưa hoàn thành đổi mật khẩu tạm / chưa kích hoạt.
- `1`: đã hoàn tất đổi mật khẩu lần đầu và account đủ điều kiện hoạt động.
- `2`: cấp 1 **và** email liên kết đã được xác minh, bằng chứng chưa bị thu hồi.
- Mức assurance hiệu lực được **tính từ** `iam_credentials` và `iam_account_verifications`; không lưu cứng như một nguồn sự thật thứ hai trên `iam_user_accounts`.
- `iam_sessions.assurance_level_snapshot` chỉ là snapshot phục vụ theo dõi, **không** được dùng độc lập để cấp quyền lâu dài sau khi email bị thu hồi hoặc account bị khóa.

## 4. Quy tắc cấp quyền

1. Permission nguyên tử có mã cố định, ví dụ `sales.order.read`, `finance.payment.approve`.
2. Role–Permission xác định các Permission thuộc gói.
3. Account–Role xác định các gói User nhận được.
4. Account–Permission cấp quyền trực tiếp và DENY ngoại lệ.
5. Tính quyền theo tập hợp: `Effective Grants = (Role Grants ∪ Direct ALLOW) − Direct DENY`.
6. **DENY trực tiếp ưu tiên hơn ALLOW** từ Role và cấp lẻ (đây là quyết định kỹ thuật được đề xuất trong bản SQL, cần duyệt nếu muốn hành vi khác).
7. Khi sử dụng chức năng, backend vẫn kiểm tra account, Membership, `minimum_assurance_level` và quyền cụ thể. UI ẩn menu không được coi là biện pháp bảo mật.

## 5. Role Switching / Working Context

Mục tiêu giao diện: tránh phải mở đồng thời nhiều Role, menu và tập chức năng gây quá tải. **Một User Account có thể có nhiều Role; một phiên/tab làm việc chỉ kích hoạt một Role tại thời điểm cụ thể.**

- `iam_sessions.active_role_id` là Role đang sử dụng trong context của phiên.
- Role đang hoạt động phải là Role **đang được gán, còn hiệu lực, không bị thu hồi** cho chính `user_account_id` của phiên.
- Khi đổi Role, backend xác thực lại quan hệ đó và ghi Audit; không nhận Role ID từ client làm nguồn quyền đáng tin cậy.
- Các Direct Permission tiếp tục thuộc Account, không phải thuộc Role; cần định nghĩa rõ UI trình bày quyền cấp lẻ ra sao khi đang xem một Role.
- Nếu mở nhiều tab độc lập, cần tách session/context theo tab hoặc có `context_id` riêng. Bản v0.2 mới chỉ dùng `iam_sessions`, **chưa chốt** chiến lược cô lập browser tabs và không mặc định một cookie-session tương ứng một tab.

## 6. Danh sách bảng IAM trong SQL

| # | Bảng | Chức năng | Quan hệ trọng yếu |
|---:|---|---|---|
| 1 | `iam_memberships` | Định danh nhân sự, tồn tại trước account | `employee_id` REF HR |
| 2 | `iam_user_accounts` | Tài khoản IT cấp | `membership_id` → Membership |
| 3 | `iam_credentials` | Hash mật khẩu, buộc đổi lần đầu, trạng thái khóa tạm | `user_account_id` → Account |
| 4 | `iam_account_verifications` | Liên kết và xác minh email | `user_account_id` → Account |
| 5 | `iam_roles` | Danh mục Role | — |
| 6 | `iam_permissions` | Quyền nguyên tử; cấp assurance tối thiểu | — |
| 7 | `iam_role_permissions` | Pack quyền của Role | Role + Permission |
| 8 | `iam_user_roles` | Gán Role cho Account, giữ lịch sử thu hồi | Account + Role |
| 9 | `iam_user_permissions` | Quyền cấp lẻ / DENY, có hạn | Account + Permission |
| 10 | `iam_sessions` | Phiên truy cập và active Role | Account + Role |
| 11 | `iam_audit_logs` | Theo dõi hoạt động bảo mật/nghiệp vụ đã chọn | Account + Membership + Session + Role |

**PostgreSQL:** Bảng trong schema `iam`, UUID PK, FK nội bộ `ON DELETE RESTRICT`, `TIMESTAMPTZ`, ràng buộc `CHECK`, unique index, index tra cứu và `COMMENT ON` mô tả nghiệp vụ. Mật khẩu được lưu bằng hash an toàn (ưu tiên Argon2id ở tầng ứng dụng), không lưu plaintext.

## 7. External REF — Không tạo bảng nguồn trong IAM

| Thực thể logic | Khóa tượng trưng | Chủ sở hữu dự kiến | Tác dụng |
|---|---|---|---|
| `ref_employees` | `employee_id` | HR / Organization Management | Đối chiếu Membership với nhân sự |
| `ref_organizations` | `organization_id` | Organization Management | Chuẩn bị phạm vi tổ chức |
| `ref_branches` | `branch_id` | Organization Management | Chuẩn bị khả năng mở rộng theo chi nhánh |
| `ref_business_objects` | `object_id` | Module nghiệp vụ | Tương lai: scope dữ liệu từng record |

Các `ref_*` trong tài liệu là **giao diện khai báo hợp đồng tích hợp**, không phải bảng mà script DDL được quyền tạo. Trước khi thực thi hệ thống hoàn chỉnh, phải chốt ID nguồn, cách đồng bộ/đối chiếu và chính sách khi nhân sự/tổ chức bị thay đổi.

## 8. Ràng buộc và giả định kỹ thuật cần lưu ý

- **Quan hệ Account–Membership:** SQL v0.2 triển khai **mỗi Account thuộc một Membership; một Membership có tối đa một Account chưa vô hiệu hóa**, bằng partial unique index `WHERE disabled_at IS NULL`. Có thể giữ nhiều account lịch sử đã vô hiệu hóa. Đây là lựa chọn triển khai tạm thời dựa trên sơ đồ đã duyệt; cần xác nhận nếu nghiệp vụ cho phép nhiều tài khoản hoạt động đồng thời trên một Membership.
- **Thao tác disable:** phải cập nhật `account_status = 'DISABLED'`, `disabled_at`, thu hồi tất cả session một cách nhất quán trong transaction. Unique index dựa vào `disabled_at` nên không tự bảo đảm đồng bộ trạng thái.
- **Đăng nhập:** `username` khởi tạo từ `employee_code` nhưng có thể được quản lý tách biệt; quy tắc đổi employee code/username cần quyết định.
- **Membership HR:** nếu hệ thống nhân sự đã sở hữu định danh, tránh tạo hai nguồn dữ liệu khác biệt; `iam_memberships` lúc này là lớp ánh xạ hoặc read model.
- **Cấp Role / quyền cấp lẻ:** SQL giữ bản ghi thu hồi bằng `revoked_at`, nhưng logic xác định grant còn hiệu lực phải tính thời gian hiện tại và trạng thái account.
- **`minimum_assurance_level`:** mặc định 1, có thể nâng lên 2 cho chức năng nhạy cảm; cấp 2 chỉ là điều kiện cần, không tự cấp thêm Permission.
- **Email verification:** token lưu dạng hash, một lần sử dụng; xử lý hết hạn và rate-limit trong service. Nếu sử dụng địa chỉ email để recovery/thay đổi account, phải bảo vệ quy trình cập nhật tránh tự nâng assurance trái phép.
- **Session:** chỉ lưu hash token; thiết lập thời hạn và thu hồi; không dùng raw token để ghi log. Chiến lược refresh/rotation có thể bổ sung sau.
- **Audit:** giảm thu thập dữ liệu nhạy cảm, không ghi password, token hoặc toàn bộ PII vào JSONB. Phân quyền xem log và retention phải được quản trị riêng.
- **Branch/Organization Scope:** là điểm dự phòng, hiện chưa có policy enforcement theo chi nhánh.

## 9. Các giới hạn SQL chưa tự giải quyết

Các kiểm tra cần triển khai bằng service code, stored procedure hoặc trigger được thiết kế riêng:

1. Account chỉ có thể kích hoạt sau hoàn tất first-password change.
2. Quyền Role đang chọn trong session thực sự thuộc Account đó, chưa bị thu hồi.
3. Role active, Account active, Membership đủ điều kiện làm việc.
4. Quy tắc DENY và minimum-assurance được thực thi trên API.
5. Quyền hạn, trạng thái assurance và hiệu lực email được kiểm tra tại thời điểm request, không dựa vào snapshot cũ.
6. Event audit ghi nhận đầy đủ tác nhân, đối tượng, kết quả cho các hành động quan trọng.
7. Ánh xạ External REF phải đúng nguồn sở hữu dữ liệu.

## 10. Những gì cố ý chưa đưa vào MVP

MFA/TOTP/WebAuthn; OIDC/SAML; Service Accounts; nhiều Security Policy table; engine ABAC động; hệ thống Access Scope theo chi nhánh; Device Registry độc lập; refresh-token family rotation; hierarchy tổ chức/tập đoàn; nhiều loại audit log tách biệt.

Những tính năng này không bị loại bỏ vĩnh viễn, chỉ **hoãn** để IAM ban đầu đúng quy mô doanh nghiệp và dễ kiểm thử.

## 11. Phê duyệt và bước triển khai

**Đã duyệt ở tầng ý tưởng:** Membership độc lập với Account; IT cấp tài khoản; mật khẩu tạm và đổi lần đầu; email xác minh thành cấp 2; Role là pack quyền; có Direct Permission; có Working Context một Role đang hoạt động; External REF là phần chờ phát triển.

**Cần xác nhận khi xây dựng implementation plan:** Cardinality lịch sử Account–Membership, cơ chế tab-isolation, quy tắc chuyển Role và tác động của Direct Permission, khóa/thu hồi, nguồn HR, quy tắc uniqueness khi nhân viên quay lại.

**Validation:** File SQL được dựng từ design v0.2 và rà soát tĩnh bằng kiểm tra cấu trúc; **chưa chạy thực tế trên PostgreSQL** trong lượt này. Không đánh dấu migration `PASSED` trước khi chạy trên database test, kiểm tra insert/update/revoke/rollback và migration upgrade.
