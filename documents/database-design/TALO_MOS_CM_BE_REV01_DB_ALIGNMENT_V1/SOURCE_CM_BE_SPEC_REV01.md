# TALO-MOS — CRM V1 BACKEND SPECIFICATION

**Mã hồ sơ:** CM-BE-SPEC-REV01  
**Ngày:** 29/10/2026  
**Phân hệ:** Kinh doanh  
**Module:** Customer Management — CRM  
**Trạng thái:** BUSINESS REQUIREMENTS REVIEWED / CONTRACT PENDING  
**Phạm vi:** Backend nghiệp vụ, API, phân quyền, kiểm thử và tích hợp Foundation/IAM.

## I. Cơ sở thiết kế

Backend CRM phải tuân thủ những nguyên tắc:

1. CRM là Business Module độc lập thuộc phân hệ Kinh doanh.
2. Foundation & IAM quản lý đăng ký module, danh tính, quyền hiệu lực, điều hướng và cơ chế tích hợp.
3. CRM chịu trách nhiệm xử lý quy tắc nghiệp vụ và dữ liệu khách hàng thuộc phạm vi của mình.
4. Quyền thao tác và phạm vi dữ liệu là hai điều kiện độc lập, đều phải được kiểm tra tại Backend.
5. Các module nghiệp vụ khác không được vượt qua cơ chế kiểm soát Foundation/IAM để tùy ý sửa dữ liệu CRM.
6. Backend phải tương thích với SQL Contract được phê duyệt. Không tự thay đổi cấu trúc database.
7. Phần Frontend chỉ trình bày và gửi yêu cầu; không được là nơi duy nhất thực thi quy tắc bảo vệ dữ liệu.

**Lưu ý kiến trúc:** Yêu cầu Foundation quản lý và giám sát truy cập database được hiểu là nguyên tắc kiểm soát tập trung. Session Backend phải đối chiếu Module Contract và cơ chế hiện có để xác định đường thực thi thực tế. Không được tự giả định rằng mọi SQL đều đi qua một database proxy riêng của Foundation.

---

# II. BUSINESS RULES CONTRACT

## BR-01 — Phạm vi xem khách hàng

**Nguồn:** BE01, BE09

Một khách hàng được phép có:

- Một Sale chính.
- Nhiều Sale hỗ trợ.
- Nhiều bản ghi phân công trong lịch sử, nhưng tối đa một Sale chính đang hiệu lực tại một thời điểm.

Sale chính và Sale hỗ trợ đang được phân công có cùng phạm vi xem hồ sơ khách hàng.

Tuy nhiên, cùng nhìn thấy dữ liệu không đồng nghĩa với cùng được sửa, xóa, bàn giao hay xuất dữ liệu. Các thao tác đó tiếp tục phụ thuộc quyền IAM.

Phạm vi truy cập đề xuất:

| Đối tượng | Phạm vi nhìn thấy |
|---|---|
| Sale chính | Khách hàng được phân công |
| Sale hỗ trợ | Khách hàng được phân công hỗ trợ |
| Quản lý | Toàn bộ khách hàng trong phạm vi quản lý được IAM cấp |
| Kế toán | Các khách hàng được quyền truy cập theo nhiệm vụ |
| Quản trị hệ thống | Theo quyền quản trị hiệu lực do Foundation/IAM xác định |

**Tác động SQL:** Phải kiểm tra `cm_customer_assignments` có cho phép nhiều phân công cùng hiệu lực và phân biệt Sale chính/Sale hỗ trợ hay không. Nếu không, phải đưa yêu cầu điều chỉnh vào đợt duyệt SQL, không tự sửa.

## BR-02 — Quyền tạo khách hàng

**Nguồn:** BE02

Không cố định điều kiện tạo khách hàng theo tên vai trò, ví dụ chỉ kiểm tra chuỗi `MANAGER` hoặc `SALES`.

Backend phải kiểm tra quyền chức năng được Foundation/IAM cấp cho tài khoản.

Đề xuất quyền logic: `crm.customer.create`.

Quyền thực tế phải được khai báo trong Module Contract và ánh xạ với hệ thống IAM đang triển khai.

Backend không được tự tạo cơ sở phân quyền riêng ngoài IAM.

## BR-03 — Thay đổi thông tin định danh pháp lý

**Nguồn:** BE03

Các trường có ảnh hưởng pháp lý cần kiểm soát riêng, tối thiểu:

- Mã số thuế/mã định danh pháp lý.
- Tên pháp lý đăng ký.
- Loại hình pháp lý khi thay đổi làm ảnh hưởng đến cách xác thực định danh.

Đối với MST, yêu cầu thay đổi là nghiệp vụ ngoại lệ, không phải chức năng chỉnh sửa thông thường.

Quy trình:

1. Người có quyền khởi tạo yêu cầu thay đổi.
2. Cung cấp lý do và chứng từ hợp pháp.
3. Backend ghi nhận đề xuất, chưa thay thế dữ liệu hiện hành.
4. Chuyển người có thẩm quyền quản lý xem xét.
5. Chuyển người có quyền duyệt kế toán kiểm tra.
6. Chỉ cập nhật hồ sơ khi các điều kiện phê duyệt đã đạt.
7. Giữ thông tin cũ, thông tin mới, chứng từ, người duyệt và thời điểm thay đổi trong lịch sử.

**Quy tắc quan trọng:**

- Quyền tạo yêu cầu và quyền duyệt là hai quyền độc lập.
- Không cho người không được ủy quyền thực hiện thay đổi trực tiếp qua PATCH thông thường.
- Không coi MST là thông tin có thể tùy ý sửa chỉ vì có quyền cập nhật khách hàng.
- Số lượng và thứ tự người phê duyệt chưa được chốt, cần thiết kế workflow có thể cấu hình trong phạm vi các năng lực hiện có.
- Nếu chưa có cơ chế approval phù hợp trong CRM/Foundation, đây là hạng mục phải hoàn thành trước khi bật chức năng thay đổi MST.

## BR-04 — Tích hợp liên Module

**Nguồn:** BE04

Các module như Đơn hàng, Sản phẩm, Kế toán sử dụng định danh nội bộ `customer_id` để tham chiếu khách hàng.

Nguyên tắc:

- CRM là module chịu trách nhiệm quản lý chính dữ liệu khách hàng.
- Module khác được đọc thông tin khi có quyền tích hợp hợp lệ.
- Mọi thao tác qua giao diện tích hợp phải mang ngữ cảnh người dùng hoặc danh tính dịch vụ, quyền hiệu lực và mã truy vết.
- Module khác không được ghi trực tiếp vào dữ liệu CRM nếu chưa có hợp đồng cho phép.
- Các sự kiện liên Module phải có khả năng liên kết với lịch sử khách hàng.

Không triển khai trước các API cho những module nghiệp vụ chưa tồn tại.

## BR-05 — Khách hàng DRAFT và khách hàng chính thức

**Nguồn:** BE05

Cho phép tạo hồ sơ khách hàng chưa đầy đủ thông tin thuế để phục vụ tìm kiếm và liên hệ ban đầu.

Đề xuất phân biệt trạng thái hoàn thiện hồ sơ:

| Trạng thái hồ sơ | Ý nghĩa |
|---|---|
| DRAFT | Hồ sơ chưa hoàn thành thông tin định danh pháp lý |
| VERIFIED | Hồ sơ đủ điều kiện pháp lý và dữ liệu bắt buộc theo quy tắc CRM |

Đây là trạng thái hoàn thiện hồ sơ, **không thay thế** các trạng thái quan hệ khách hàng như Tiềm năng, Khách hàng mới hoặc Đang hợp tác.

Khách hàng DRAFT được phép:

- Lưu thông tin định danh sơ bộ và liên hệ.
- Ghi nhận hoạt động tìm kiếm, liên hệ, chăm sóc.
- Phân công Sale nếu có quyền.

Khách hàng DRAFT không được sử dụng trong quy trình tạo đơn hàng chính thức hoặc các nghiệp vụ yêu cầu định danh đã xác minh.

Khi chuyển sang VERIFIED, Backend phải kiểm tra đầy đủ những trường pháp lý bắt buộc, kể cả các trường của khách hàng nước ngoài theo quy tắc tương ứng.

**Chưa chốt:** Bộ trường tối thiểu để lưu DRAFT và bộ điều kiện chuyển VERIFIED cần được xác nhận từ Data Dictionary cuối cùng.

## BR-06 — Kiểm tra khách hàng trùng

**Nguồn:** BE06

Mã định danh pháp lý là căn cứ chính để kiểm tra trùng.

- Định danh chuẩn hóa trùng trong cùng phạm vi định danh: chặn tạo mới.
- Tên pháp lý giống hoặc tương tự nhưng định danh khác: cảnh báo, cho phép tiếp tục.
- Hồ sơ đã ẩn vẫn thuộc phạm vi kiểm tra trùng.
- DRAFT chưa có định danh được phép cảnh báo trùng theo tên/điện thoại, không tự coi là trùng pháp lý.

Không dùng duy nhất tên doanh nghiệp làm khóa nhận diện.

Cần sử dụng cả Backend validation và constraint/index PostgreSQL phù hợp.

## BR-07 — Quan hệ doanh nghiệp mẹ và chi nhánh

**Nguồn:** BE07

**Phase 2:** Tạo hồ sơ chi nhánh riêng và liên kết về đơn vị mẹ.

V1 cần giữ khả năng mở rộng trong API và cấu trúc dữ liệu, nhưng không triển khai quy trình quản lý sơ đồ doanh nghiệp mẹ–chi nhánh nếu chưa cần.

Không tự tạo thêm bảng quan hệ công ty mẹ trong V1.

Nếu SQL đã có sẵn trường liên kết phù hợp thì được giữ, nhưng không phát triển tính năng ngoài phạm vi.

## BR-08 — Danh mục địa giới hành chính

**Nguồn:** BE08

Địa chỉ đăng ký là dữ liệu bắt buộc đối với hồ sơ chính thức.

Đối với địa chỉ Việt Nam:

- Chọn Tỉnh/Thành.
- Chọn Phường/Xã/Đặc khu tương ứng.
- Nhập số nhà, tên đường.
- Backend kiểm tra mã đơn vị hành chính và quan hệ tỉnh–xã.

Không áp dụng điều kiện danh mục hành chính Việt Nam đối với khách hàng nước ngoài thuộc luồng nhập địa chỉ nước ngoài.

**Chưa chốt:** Chính sách khi danh mục hành chính thiếu dữ liệu.

Khuyến nghị kỹ thuật: Không đưa CRM vào sử dụng chính thức khi thiếu dữ liệu địa giới bắt buộc. Nếu dữ liệu chưa seed đủ, giữ trạng thái blocker cho hạng mục đó thay vì tự động cho nhập tay và bỏ qua chuẩn hóa.

## BR-09 — Phân công Sale chính và Sale hỗ trợ

**Nguồn:** BE09

Hệ thống cần hỗ trợ:

- Tạo phân công Sale chính.
- Thêm Sale hỗ trợ.
- Kết thúc hoặc thay thế phân công.
- Lưu lịch sử phân công.

Phải kiểm tra trùng phân công cùng vai trò và cùng thời kỳ theo quy tắc được duyệt.

Không được có hai Sale chính đồng thời cho cùng một khách hàng.

Các Sale hỗ trợ được xem cùng nội dung khách hàng, nhưng quyền thực thi thao tác phụ thuộc IAM.

**Chưa chốt:** Sale hỗ trợ có thể tự thêm hoạt động, tạo yêu cầu bàn giao hoặc chỉ người có quyền được chỉ định mới được thực hiện.

## BR-10 — Quy trình bàn giao khách hàng

**Nguồn:** BE10 chưa chọn; BE11 có mô tả nghiệp vụ.

Đề xuất hai luồng.

### Luồng A — Quản lý yêu cầu bàn giao

`Quản lý tạo yêu cầu → Sale hiện tại xác nhận → Sale nhận xác nhận → Hoàn thành bàn giao`

### Luồng B — Sale hiện tại đề nghị bàn giao

`Sale gửi đề nghị → Quản lý duyệt → Sale nhận xác nhận → Hoàn thành bàn giao`

Chỉ sau khi hoàn thành tất cả bước bắt buộc, Backend mới cập nhật phân công hiệu lực.

Tại mỗi bước cần ghi nhận:

- Người yêu cầu.
- Người duyệt/xác nhận.
- Thời điểm.
- Trạng thái.
- Ghi chú.
- Lý do từ chối nếu có.

Đề xuất trạng thái workflow:

`PENDING_APPROVAL`, `PENDING_CURRENT_ACK`, `PENDING_RECEIVER_ACK`, `COMPLETED`, `REJECTED`, `CANCELLED`.

Các mã này chỉ là đề xuất; cần đối chiếu trạng thái đã có trong SQL để tái sử dụng hoặc lập yêu cầu bổ sung.

## BR-11 — Chuyển công việc khi bàn giao

**Nguồn:** BE11

Khi bàn giao hoàn tất, các công việc đang mở thuộc trách nhiệm Sale rời vị trí phụ trách được chuyển sang Sale tiếp nhận.

Lịch sử công việc trước đó không bị thay đổi.

Đề xuất giới hạn chuyển tự động đối với công việc thực sự thuộc người bàn giao, tránh chuyển nhầm công việc do Sale hỗ trợ khác đang đảm nhiệm.

Các thao tác cập nhật phân công và chuyển chủ sở hữu công việc cần được thực hiện trong một transaction nếu cùng thuộc phạm vi database và hợp đồng được phép.

**Chưa chốt:** Khi thay Sale chính có đồng thời giữ hay xóa vai trò Sale hỗ trợ của người cũ; cách xử lý công việc có nhiều người tham gia.

## BR-12 — Nhật ký thao tác toàn hệ thống

**Nguồn:** BE12, BE19

Phải ghi nhận các thay đổi dữ liệu CRM và sự kiện liên quan từ các module khác theo quy ước Audit/Event Contract của Foundation.

Dữ liệu tối thiểu cần truy vết:

| Thuộc tính | Ý nghĩa |
|---|---|
| Event ID | Định danh sự kiện |
| Request/Correlation ID | Liên kết một chuỗi thao tác |
| Actor | Tài khoản hoặc dịch vụ thực hiện |
| Source Module | Module phát sinh |
| Target Module | Module bị tác động hoặc liên quan |
| Function/Action | Chức năng và thao tác |
| Entity Type/ID | Đối tượng dữ liệu |
| Timestamp | Thời điểm |
| Result | Thành công/thất bại |
| Change Summary | Tóm tắt thay đổi |
| Before/After | Giá trị thay đổi được phép lưu |

Không ghi mật khẩu, token, nội dung nhạy cảm hoặc toàn bộ tài liệu không cần thiết vào log.

Cần phân biệt:

- **Audit Log:** Bằng chứng thao tác và thay đổi dữ liệu.
- **Business Activity:** Nhật ký nghiệp vụ để Sale theo dõi khách hàng.
- **Access Log:** Truy vết truy cập và yêu cầu kỹ thuật.

Không mặc định một bản ghi Audit sẽ trở thành nội dung hiển thị trên Timeline khách hàng. Chỉ những sự kiện có ý nghĩa nghiệp vụ mới được trình bày ở Timeline.

Session Backend phải kiểm tra Foundation hiện cung cấp cơ chế nào, không tự xây một hệ thống Audit toàn cục mới.

## BR-13 — Quản lý nhóm ngành khách hàng

**Nguồn:** BE13

Baseline có bảng danh mục nhóm và bảng liên kết khách hàng với nhóm.

Yêu cầu bổ sung trong ghi chú:

- Có màn hình xem danh mục nhóm ngành.
- Cho phép tạo nhóm.
- Cho phép sửa nhóm.
- Cho phép lựa chọn nhiều nhóm cho một khách hàng.

**Phạm vi chưa chốt vì lựa chọn và ghi chú mâu thuẫn.**

Phương án đề xuất: Triển khai CRUD danh mục nhóm ngành mức tối thiểu trong V1, tái sử dụng hai bảng nhóm hiện tại. Không triển khai phân tích ngành nâng cao.

Chức năng tạo/sửa nhóm phải có quyền IAM độc lập với quyền gán nhóm cho khách hàng.

## BR-14 — File đính kèm

**Nguồn:** BE14

Định dạng cho phép:

- PDF.
- JPG/JPEG.
- PNG.

Giới hạn dung lượng do cấu hình quyết định, chưa chốt mức MB.

Backend phải:

- Kiểm tra loại file và nội dung file, không chỉ đuôi.
- Giới hạn dung lượng.
- Lưu file theo khóa định danh an toàn.
- Lưu metadata vào database.
- Kiểm soát quyền tải/xem.
- Xử lý nhất quán khi lưu file hoặc metadata thất bại.

Không cho phép người dùng cung cấp đường dẫn máy chủ tùy ý.

## BR-15 — Cảnh báo hết hạn tài liệu

**Nguồn:** BE15

Backend cung cấp thông tin:

- Ngày ký.
- Ngày hiệu lực.
- Ngày hết hạn.
- Trạng thái hiệu lực.
- Số ngày còn lại (nếu có hạn).

V1 chỉ yêu cầu hiển thị trạng thái và cảnh báo trên màn hình.

Không bắt buộc gửi email, tạo tác vụ định kỳ hay thông báo đẩy.

Ngưỡng cảnh báo trước hạn chưa chốt.

## BR-16 — Phiên bản tài liệu

**Nguồn:** BE16

Khi tài liệu được cập nhật:

- Tạo phiên bản/bản ghi tài liệu mới.
- Giữ file và metadata cũ.
- Giữ lịch sử người cập nhật.
- Cho phép xác định tài liệu hiện hành nếu có quy tắc thay thế.

Không ghi đè tài liệu lịch sử.

Nếu SQL hiện chưa hỗ trợ mối quan hệ phiên bản, phải đưa vào báo cáo chênh lệch schema trước khi xây dựng.

## BR-17 — Tìm kiếm và phân trang

**Nguồn:** BE17

Backend thực hiện tìm kiếm, lọc, sắp xếp và phân trang.

Mặc định:

- `page = 1`
- `pageSize = 20`

Bộ lọc dự kiến:

- Mã khách hàng.
- Tên thường gọi/tên pháp lý.
- MST/định danh.
- Loại khách hàng.
- Trạng thái.
- Tỉnh/thành.
- Sale chính/Sale hỗ trợ.
- Nhóm khách hàng nếu đã triển khai.

Tất cả kết quả phải được lọc quyền truy cập dữ liệu trước khi phân trang và tính tổng số bản ghi.

Sắp xếp phải ổn định để hạn chế trùng/bỏ sót dòng khi chuyển trang.

## BR-18 — Xuất dữ liệu

**Nguồn:** BE18

Chức năng xuất có quyền riêng, không mặc định đi theo quyền xem.

- Chỉ xuất trường dữ liệu được phép.
- Chỉ xuất khách hàng nằm trong phạm vi truy cập.
- Áp dụng bộ lọc và điều kiện xuất đã khai báo.
- Ghi nhận thao tác xuất dữ liệu vào Audit.
- Không cho thay đổi tham số để bỏ qua giới hạn quyền.

Định dạng xuất ưu tiên CSV trong V1 nếu chưa có yêu cầu Excel chính thức.

## BR-19 — Audit Log

**Nguồn:** BE19

Các thao tác tạo, sửa, ẩn, thay đổi phân công, thay đổi người liên hệ, thay đổi tài liệu, phê duyệt và xuất dữ liệu phải có khả năng truy vết.

Yêu cầu log trước/sau đối với trường được phép lưu; dữ liệu nhạy cảm cần che hoặc loại trừ.

Không coi việc log thất bại là có thể bỏ qua đối với các thay đổi pháp lý quan trọng. Session triển khai phải xác định cơ chế bảo đảm ghi nhận phù hợp với hạ tầng hiện có.

## BR-20 — Nghiệm thu Backend một lần

**Nguồn:** BE20

Quy trình:

1. Hoàn thành Backend CRM V1 theo contract đã duyệt.
2. Hoàn thiện kiểm thử tự động.
3. Triển khai trên TEST theo phê duyệt.
4. Chạy một bộ kiểm thử tổng hợp.
5. Xuất báo cáo PASS/FAIL.
6. Chủ dự án xem xét kết quả và quyết định nghiệm thu.

Không chia nhỏ thành nhiều lần yêu cầu chủ dự án nghiệm thu từng service.

Không dùng phương án kiểm thử một lần để bỏ qua unit test hoặc bỏ qua đối chiếu SQL trước khi triển khai.

---

# III. API CONTRACT — ĐỀ XUẤT

Các endpoint dưới đây là phương án API mức thiết kế, chưa phải routes đã được đăng ký.

Prefix tạm sử dụng: `/api/cm`

Đường dẫn chính thức, authentication middleware và API envelope phải đối chiếu quy ước Backend/Module Host hiện tại.

## 1. API khách hàng

| Method | Endpoint | Chức năng | Quyền logic |
|---|---|---|---|
| GET | `/customers` | Danh sách, tìm kiếm, phân trang | customer.read |
| GET | `/customers/:id` | Hồ sơ chi tiết | customer.read |
| POST | `/customers` | Tạo hồ sơ DRAFT/chính thức | customer.create |
| PATCH | `/customers/:id` | Sửa thông tin thông thường | customer.update |
| POST | `/customers/:id/verify` | Hoàn thiện/xác minh hồ sơ | customer.verify |
| POST | `/customers/:id/hide` | Ẩn hồ sơ | customer.hide |
| GET | `/customers/check-identity` | Kiểm tra định danh trùng | customer.create/update |
| POST | `/customers/:id/legal-changes` | Tạo yêu cầu sửa pháp lý | legal.change.request |
| GET | `/customers/:id/legal-changes` | Danh sách yêu cầu sửa | legal.change.read |

Các thao tác duyệt pháp lý cần API riêng và workflow rõ ràng, không sử dụng PATCH thông thường để vượt quy trình.

## 2. API người liên hệ

| Method | Endpoint | Chức năng |
|---|---|---|
| GET | `/customers/:id/contacts` | Danh sách liên hệ |
| POST | `/customers/:id/contacts` | Thêm liên hệ |
| PATCH | `/customers/:id/contacts/:contactId` | Sửa liên hệ |
| POST | `/customers/:id/contacts/:contactId/deactivate` | Ngừng sử dụng liên hệ |

## 3. API phân công và bàn giao

| Method | Endpoint | Chức năng |
|---|---|---|
| GET | `/customers/:id/assignments` | Xem Sale chính, hỗ trợ và lịch sử |
| POST | `/customers/:id/assignments` | Gán Sale theo quyền |
| POST | `/customers/:id/handovers` | Tạo yêu cầu bàn giao |
| GET | `/handovers` | Danh sách yêu cầu theo quyền |
| GET | `/handovers/:id` | Chi tiết yêu cầu |
| POST | `/handovers/:id/approve` | Quản lý duyệt |
| POST | `/handovers/:id/acknowledge` | Người liên quan xác nhận |
| POST | `/handovers/:id/reject` | Từ chối |

API phải dựa vào trạng thái và người thực hiện để xác định thao tác hợp lệ. Không được cho phép gửi trực tiếp trạng thái `COMPLETED` nếu chưa đi qua các điều kiện bắt buộc.

## 4. API hoạt động

| Method | Endpoint | Chức năng |
|---|---|---|
| GET | `/customers/:id/activities` | Nhật ký công việc |
| POST | `/customers/:id/activities` | Tạo hoạt động |
| PATCH | `/activities/:id` | Cập nhật công việc |
| POST | `/activities/:id/complete` | Hoàn thành |
| GET | `/customers/:id/timeline` | Timeline khách hàng từ các nguồn được tích hợp |

Timeline chỉ tổng hợp nguồn sự kiện đã có hợp đồng và quyền truy cập hợp lệ.

## 5. API hồ sơ và tài liệu

| Method | Endpoint | Chức năng |
|---|---|---|
| GET | `/customers/:id/documents` | Danh sách tài liệu |
| POST | `/customers/:id/documents` | Upload tài liệu |
| GET | `/documents/:id/download` | Tải file theo quyền |
| POST | `/documents/:id/versions` | Upload bản thay thế |
| PATCH | `/documents/:id/metadata` | Cập nhật metadata được phép |
| GET | `/documents/expiring` | Danh sách tài liệu sắp hết hạn theo quyền |

## 6. API danh mục

| Method | Endpoint | Chức năng |
|---|---|---|
| GET | `/references/provinces` | Danh sách tỉnh/thành |
| GET | `/references/wards?provinceCode=...` | Xã/phường theo tỉnh |
| GET | `/references/regions` | Vùng kinh tế/miền |
| GET | `/references/customer-types` | Loại khách hàng |
| GET | `/groups` | Danh mục nhóm ngành |
| POST | `/groups` | Tạo nhóm ngành (nếu V1 chốt có UI) |
| PATCH | `/groups/:id` | Sửa nhóm ngành |
| PUT | `/customers/:id/groups` | Cập nhật nhiều nhóm của khách hàng |

Nếu danh mục tỉnh/xã được quản lý ở một Master Data Module dùng chung, CRM phải sử dụng hợp đồng tích hợp tương ứng thay vì tạo API và dữ liệu nguồn thứ hai.

## 7. Quy ước request/response

Đề xuất một envelope thống nhất với quy chuẩn API hiện tại của dự án.

### Ví dụ tạo khách hàng

```json
{
  "customerType": "COMPANY",
  "recordStatus": "DRAFT",
  "displayName": "Khach hang A",
  "legalName": "Cong ty A",
  "taxNumber": null,
  "provinceCode": "MA_TINH",
  "wardCode": "MA_XA",
  "addressLine": "So nha, ten duong"
}
```

Các tên field trên là **tên minh họa**, không phải cột SQL đã chốt. `MA_TINH` và `MA_XA` là placeholder, không phải mã đơn vị hành chính thật.

Ví dụ response khi tạo thành công:

```json
{
  "data": {
    "customerId": "UUID",
    "customerCode": "000001",
    "recordStatus": "DRAFT"
  }
}
```

Ví dụ lỗi:

```json
{
  "error": {
    "code": "CM_IDENTITY_DUPLICATE",
    "message": "Dinh danh phap ly da ton tai.",
    "requestId": "REQUEST_ID"
  }
}
```

## 8. Mã lỗi nghiệp vụ tối thiểu

| Mã lỗi đề xuất | HTTP | Ý nghĩa |
|---|---|---|
| CM_VALIDATION_FAILED | 422 | Dữ liệu không hợp lệ |
| CM_IDENTITY_DUPLICATE | 409 | Định danh bị trùng |
| CM_CUSTOMER_NOT_FOUND | 404 | Không tìm thấy hoặc không được phép tiết lộ hồ sơ |
| CM_PERMISSION_DENIED | 403 | Không có quyền thực hiện |
| CM_INVALID_PROVINCE_WARD | 422 | Xã/phường không thuộc tỉnh |
| CM_REFERENCE_UNAVAILABLE | 503 | Danh mục bắt buộc chưa khả dụng |
| CM_DRAFT_NOT_ELIGIBLE | 409 | Hồ sơ chưa đủ điều kiện nghiệp vụ |
| CM_APPROVAL_REQUIRED | 409 | Thay đổi bắt buộc phải duyệt |
| CM_HANDOVER_INVALID_STATE | 409 | Trạng thái bàn giao không hợp lệ |
| CM_CONCURRENT_UPDATE | 409 | Dữ liệu đã thay đổi bởi giao dịch khác |
| CM_FILE_INVALID | 422 | Loại hoặc dung lượng file không hợp lệ |

Mã lỗi cần đăng ký nhất quán với chuẩn error handler hiện tại. Không tự tạo cấu trúc response trái với Foundation/Backend contract.

---

# IV. IAM PERMISSION MATRIX

## 1. Nguyên tắc phân quyền

Không đưa các vai trò như Sale, Quản lý, Kế toán vào điều kiện hardcode phân quyền Backend.

Mỗi chức năng được khai báo thành capability/function có mã ổn định và đăng ký với Foundation.

IAM quyết định tài khoản được cấp những quyền nào.

CRM Backend kiểm tra đồng thời:

`Quyền chức năng hiệu lực` + `Phạm vi dữ liệu hợp lệ` + `Điều kiện nghiệp vụ`

Ba điều kiện đều phải thỏa mãn.

## 2. Danh mục quyền đề xuất

| Mã quyền logic | Ý nghĩa | Phạm vi dữ liệu |
|---|---|---|
| customer.read | Xem hồ sơ | Theo phân công hoặc phạm vi quản lý |
| customer.create | Tạo khách hàng | Theo quyền IAM |
| customer.update | Sửa thông tin thường | Khách hàng được phép sửa |
| customer.verify | Xác minh hồ sơ chính thức | Theo quyền IAM |
| customer.hide | Ẩn khách hàng | Theo quyền IAM |
| legal.change.request | Đề nghị sửa định danh pháp lý | Theo quyền IAM |
| legal.change.approve.management | Duyệt cấp quản lý | Yêu cầu được phân quyền |
| legal.change.approve.accounting | Duyệt cấp kế toán | Yêu cầu được phân quyền |
| contact.manage | Quản lý liên hệ | Khách hàng được phép thao tác |
| assignment.manage | Quản lý phân công | Theo quyền IAM |
| handover.request | Yêu cầu bàn giao | Theo quyền IAM |
| handover.approve | Duyệt bàn giao | Theo quyền IAM |
| handover.acknowledge | Xác nhận bàn giao | Người tham gia hợp lệ |
| activity.create | Tạo hoạt động | Khách hàng được phân quyền |
| activity.update | Cập nhật công việc | Công việc được phép thao tác |
| document.read | Xem/tải tài liệu | Theo quyền đối tượng/tài liệu |
| document.manage | Upload, cập nhật metadata | Theo quyền IAM |
| group.manage | Tạo/sửa danh mục ngành | Theo quyền IAM |
| group.assign | Gán nhóm cho khách hàng | Khách hàng được phân quyền |
| customer.export | Xuất dữ liệu | Chỉ dữ liệu được quyền xem |

Đây là mã logic đề xuất. Session triển khai phải đối chiếu naming convention và khai báo chức năng Module hiện hành để xác định mã chính thức.

## 3. Ma trận cấp quyền ban đầu đề xuất

Ký hiệu:

- `R`: Xem trong phạm vi được cấp.
- `W`: Thao tác nếu có quyền chức năng tương ứng.
- `A`: Có thể được IAM cấp quyền phê duyệt.
- `—`: Không mặc định cấp.

| Chức năng | Sale chính | Sale hỗ trợ | Quản lý | Kế toán |
|---|---|---|---|---|
| Xem hồ sơ được phân công | R | R | R | R theo quyền |
| Tạo khách hàng | W | W | W | — |
| Sửa thông tin thông thường | W | W | W | — |
| Đề nghị sửa pháp lý | W theo quyền | W theo quyền | W | W theo quyền |
| Duyệt pháp lý cấp quản lý | — | — | A | — |
| Duyệt pháp lý cấp kế toán | — | — | — | A |
| Quản lý liên hệ | W | W | W | — |
| Phân công Sale | — | — | W | — |
| Đề nghị bàn giao | W | Theo quyền | W | — |
| Duyệt bàn giao | — | — | A | — |
| Tạo hoạt động | W | W | W | Theo quyền |
| Upload tài liệu | W | W | W | Theo quyền |
| Quản lý danh mục ngành | — | — | Theo quyền | — |
| Xuất dữ liệu | Theo quyền | Theo quyền | Theo quyền | Theo quyền |

**Đây không phải bảng phân quyền cố định.** Nó là cấu hình gợi ý để IAM cấp quyền. Nếu người dùng có vai trò khác nhưng được cấp quyền hợp lệ thì Backend vẫn phải áp dụng theo quyền hiệu lực và ngữ cảnh đối tượng.

Quyền quản trị tối cao của TALO-MOS tiếp tục tuân theo cơ chế IAM hiện hữu, không tạo ngoại lệ riêng trong CRM.

## 4. Quy tắc ngăn bỏ qua kiểm soát

- Frontend ẩn nút không thay thế Backend authorization.
- Người biết URL API không được vượt qua quyền.
- Sale hỗ trợ không được quyền xem khách hàng ngoài phân công.
- Thao tác bàn giao cần kiểm tra cả quyền lẫn trạng thái workflow.
- Người không có quyền duyệt không thể tự ghi trạng thái APPROVED.
- Người có quyền xem không mặc nhiên có quyền xuất.
- Module tích hợp phải có danh tính và quyền hiệu lực hợp lệ.

---

# V. BACKEND TEST MATRIX

## 1. Phương pháp nghiệm thu

Chạy một đợt nghiệm thu tổng hợp trên PostgreSQL TEST, sử dụng dữ liệu kiểm thử và các tài khoản IAM được phân quyền cụ thể.

**Không nghiệm thu bằng mock API đơn thuần.**

Trước khi chạy cần xác định:

- SQL schema/version thực tế.
- Danh mục địa giới đã seed.
- Phiên bản Module Contract.
- Backend revision/commit.
- Database backup và rollback plan.
- Bộ tài khoản kiểm thử.
- Các module tích hợp đã có thể cung cấp sự kiện.

## 2. Test case khách hàng

| ID | Test case | Kết quả kỳ vọng |
|---|---|---|
| TC-01 | Tạo hồ sơ DRAFT không có MST | PASS nếu đủ trường tối thiểu DRAFT |
| TC-02 | DRAFT gọi API tạo đơn hàng qua module có tích hợp | Bị chặn do chưa VERIFIED |
| TC-03 | Chuyển DRAFT sang VERIFIED, thiếu pháp lý | Bị chặn và chỉ rõ lỗi |
| TC-04 | Chuyển DRAFT sang VERIFIED, đủ dữ liệu | Thành công |
| TC-05 | Tạo hai khách hàng đồng thời | Hai mã KH khác nhau, không trùng định danh |
| TC-06 | Mã định danh đã tồn tại | Trả 409, không tạo thêm |
| TC-07 | Tên gần giống, định danh khác | Cảnh báo, cho tạo theo quyền |
| TC-08 | Nhập sai cấu trúc MST | Trả validation error |
| TC-09 | Phường/xã không thuộc tỉnh | Trả lỗi, không ghi sai dữ liệu |
| TC-10 | Khách nước ngoài không có MST VN | Theo đúng quy tắc định danh nước ngoài |

## 3. Test case IAM và phạm vi dữ liệu

| ID | Test case | Kết quả kỳ vọng |
|---|---|---|
| TC-11 | Sale chính mở hồ sơ được phân công | PASS |
| TC-12 | Sale hỗ trợ mở cùng hồ sơ | Cùng phạm vi nội dung xem như Sale chính |
| TC-13 | Sale không được phân công truy cập API trực tiếp | Không lộ thông tin khách hàng |
| TC-14 | Quản lý xem khách theo phạm vi IAM | PASS |
| TC-15 | Sale có quyền xem nhưng không có quyền sửa | PATCH bị từ chối |
| TC-16 | Tài khoản không có quyền CREATE | POST bị từ chối |
| TC-17 | Tài khoản có READ nhưng không có EXPORT | Không xuất được |
| TC-18 | Sale xuất danh sách | Chỉ xuất dữ liệu thuộc phạm vi được xem |

## 4. Test case pháp lý và phê duyệt

| ID | Test case | Kết quả kỳ vọng |
|---|---|---|
| TC-19 | PATCH trực tiếp MST khi không qua approval | Bị chặn |
| TC-20 | Tạo yêu cầu đổi MST không có chứng từ bắt buộc | Bị chặn |
| TC-21 | Quản lý duyệt, kế toán chưa duyệt | Dữ liệu pháp lý chưa đổi |
| TC-22 | Hoàn thành đầy đủ duyệt hợp lệ | Cập nhật đúng, giữ lịch sử |
| TC-23 | Người không có quyền duyệt gọi API approve | Bị từ chối |
| TC-24 | Hai yêu cầu thay đổi pháp lý xung đột | Không ghi đè ngoài kiểm soát |

## 5. Test case phân công và bàn giao

| ID | Test case | Kết quả kỳ vọng |
|---|---|---|
| TC-25 | Một khách có một Sale chính và nhiều Sale hỗ trợ | PASS |
| TC-26 | Gán Sale chính thứ hai cùng hiệu lực trái quy tắc | Bị chặn |
| TC-27 | Quản lý tạo yêu cầu bàn giao | Đi đúng workflow A |
| TC-28 | Sale yêu cầu bàn giao | Đi đúng workflow B |
| TC-29 | Người nhận chưa xác nhận | Chưa hoàn thành bàn giao |
| TC-30 | Bàn giao hoàn tất | Sale chính được cập nhật đúng |
| TC-31 | Có công việc chưa hoàn tất của Sale bàn giao | Chuyển đúng công việc, giữ lịch sử |
| TC-32 | Hai giao dịch bàn giao đồng thời | Không tạo trạng thái phân công sai |
| TC-33 | Bàn giao thất bại giữa transaction | Không cập nhật nửa chừng |

## 6. Test case hoạt động và tài liệu

| ID | Test case | Kết quả kỳ vọng |
|---|---|---|
| TC-34 | Tạo hoạt động Sale | Lưu và hiển thị trong nhật ký |
| TC-35 | Thay đổi phân công | Có Audit và Timeline theo quy tắc |
| TC-36 | Module khác phát sinh sự kiện có contract | CRM nhận/hiển thị đúng theo tích hợp |
| TC-37 | Upload PDF/JPG/PNG hợp lệ | PASS |
| TC-38 | Upload file sai định dạng hoặc vượt giới hạn | Bị chặn |
| TC-39 | Tải tài liệu khi không có quyền | Không truy xuất được file |
| TC-40 | Tài liệu hết hạn | Trạng thái hiển thị đúng |
| TC-41 | Upload phiên bản tài liệu mới | Bản cũ còn nguyên |
| TC-42 | Upload file thành công nhưng lưu metadata thất bại | Không để hệ thống ở trạng thái sai hoặc file mồ côi không kiểm soát |

## 7. Test case tích hợp và truy vết

| ID | Test case | Kết quả kỳ vọng |
|---|---|---|
| TC-43 | Module khác đọc khách theo customer_id | Kiểm tra quyền và contract |
| TC-44 | Module không có quyền truy cập | Bị từ chối |
| TC-45 | CRM thay đổi dữ liệu | Audit có actor, action, module, timestamp và thông tin liên quan |
| TC-46 | Yêu cầu từ module A tác động CRM | Truy vết được module nguồn và đích |
| TC-47 | API lỗi validation | Trả lỗi chuẩn, không ghi dữ liệu |
| TC-48 | Truy vấn phân trang và lọc quyền | Không lộ khách ngoài phạm vi và số lượng thống kê |
| TC-49 | Export CSV chứa giá trị bắt đầu bằng ký tự công thức | Xuất an toàn, không tạo công thức khi mở bảng tính |
| TC-50 | Chạy toàn bộ regression sau khi cài Backend | Không làm hỏng Foundation/IAM và module đã có |

## 8. Kết quả nghiệm thu bắt buộc

Báo cáo cuối cùng phải thể hiện:

| Hạng mục | Yêu cầu |
|---|---|
| Tổng test | 50 case theo danh sách trên, cộng test biên nếu cần |
| PASS | Thống kê theo mã test |
| FAIL | Lỗi, ảnh hưởng, nguyên nhân và hướng xử lý |
| BLOCKED | Chỉ rõ phụ thuộc chưa hoàn thành |
| NOT TESTED | Không được tính là PASS |
| Bằng chứng | API request/response, log, truy vấn DB, thông tin phiên bản |
| Ảnh hưởng nền tảng | Kết quả regression Foundation/IAM |
| Kết luận | READY_FOR_FRONTEND hoặc NOT_READY |

Một test case phụ thuộc module chưa tồn tại không được báo PASS giả định. Phải đánh dấu BLOCKED hoặc NOT_TESTED và giải thích.

**READY_FOR_FRONTEND** chỉ được cấp khi toàn bộ chức năng CRM V1 bắt buộc đã vượt qua kiểm thử, không còn lỗi nghiêm trọng, và các phụ thuộc bắt buộc đã được hoàn thành.

---

# VI. DANH SÁCH QUYẾT ĐỊNH CHƯA CHỐT

| ID | Vấn đề | Đề xuất xử lý | Ảnh hưởng |
|---|---|---|---|
| OPEN-01 | Số bước duyệt thay đổi pháp lý và nguyên tắc không tự duyệt | Duyệt quản lý + kế toán, tách người đề nghị khỏi người duyệt nếu chính sách yêu cầu | Workflow, IAM |
| OPEN-02 | Xử lý thiếu danh mục xã/phường | Chặn nghiệm thu chính thức cho đến khi seed đầy đủ | Reference Data |
| OPEN-03 | Phân nhóm ngành V1 có xây UI không | Đề nghị xây CRUD tối thiểu | API, UI, IAM |
| OPEN-04 | Bộ trường tối thiểu DRAFT | Chốt theo Data Dictionary | Validation |
| OPEN-05 | Hành vi Sale hỗ trợ | Cùng quyền xem, thao tác tùy quyền IAM | IAM, Assignment |
| OPEN-06 | Trình tự và trạng thái bàn giao | Áp dụng hai luồng theo BE11, cần duyệt chính thức | Workflow, SQL |
| OPEN-07 | Chuyển công việc khi bàn giao | Chỉ chuyển việc của người bàn giao, giữ lịch sử | Activity, Transaction |
| OPEN-08 | Schema hỗ trợ nhiều Sale đang hiệu lực | Rà soát và đưa ra SQL Change Request nếu thiếu | SQL |
| OPEN-09 | Cơ chế Audit/Event Foundation thực tế | Đối chiếu contract và tái sử dụng | Integration |
| OPEN-10 | Dung lượng file và thời gian cảnh báo hết hạn | Để cấu hình, chốt giá trị mặc định trước TEST | Config |
| OPEN-11 | Schema phục vụ thay đổi pháp lý, phê duyệt và phiên bản tài liệu | Rà soát baseline, đề xuất thay đổi nếu thiếu | SQL |
| OPEN-12 | Quyền truy cập từ module khác tới CRM | Đối chiếu cơ chế cấp quyền liên Module hiện hữu | Module Contract |

---

# VII. YÊU CẦU CHO SESSION TRIỂN KHAI BACKEND

Session Backend phải thực hiện theo thứ tự:

**Bước 1 — Đối chiếu:**

Đọc SQL Schema/Dictionary đã được phê duyệt cùng Module Contract, IAM và Backend hiện tại.

**Bước 2 — Gap Analysis:**

Lập bảng:

`Business Rule | API | Bảng/cột SQL cần dùng | Permission | Hiện trạng hỗ trợ | Thiếu gì`

Nếu thiếu cấu trúc database, tạo yêu cầu điều chỉnh SQL, không tự ý thay đổi.

**Bước 3 — Đóng khung:**

Chốt API Contract, IAM Function Matrix, request/response schema, error catalog và workflow.

**Bước 4 — Phát triển:**

Viết Backend CRM V1 theo một module nghiệp vụ độc lập, không sửa logic Foundation/IAM ngoài phạm vi được phê duyệt.

**Bước 5 — Kiểm thử:**

Chạy một đợt kiểm thử tổng hợp trên TEST với Test Matrix có bằng chứng và regression.

**Bước 6 — Bàn giao:**

Xuất báo cáo nghiệm thu, danh sách API, kết quả TEST và các giới hạn còn lại để Frontend sử dụng.

## Trạng thái kết luận

**`BUSINESS_RULES_REVIEWED / BACKEND_CONTRACT_PENDING`**

Chưa đạt `READY_FOR_IMPLEMENTATION` vì phải đối chiếu SQL thực tế, cơ chế quyền tích hợp và các quyết định còn mở.

Tuy nhiên, hồ sơ đã đủ để khởi động công việc Backend Gap Analysis và xây dựng bản hợp đồng API chi tiết.

**Không cho phép tự ý sửa SQL, Foundation/IAM hoặc triển khai production.**