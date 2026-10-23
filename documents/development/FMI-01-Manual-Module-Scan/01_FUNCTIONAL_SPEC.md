# FMI-01 — Đặc tả chức năng

## 1. Mục tiêu

Biến thao tác **Quét Module** thành bước đầu tiên của quy trình mới:

`Chép folder → Nhấn Quét Module → Xem lỗi tĩnh → Sửa folder → Quét lại → Candidate đủ điều kiện sang FMI-02`.

Không có thao tác nhập MIC thủ công. Foundation đọc package để đánh giá; không tự đăng ký hay tự kích hoạt ở FMI-01.

## 2. Người dùng và quyền

- Người vận hành: người có đồng thời IAM effective `foundation.module_registry.read` và `foundation.module_registry.create` (minimum assurance của định nghĩa hiện có).
- Người chỉ có quyền READ: vẫn sử dụng màn hình Registry hiện tại, không thấy nút Quét Module.
- Người chưa xác thực hoặc thiếu quyền: Backend từ chối; không dựa vào ẩn nút UI làm kiểm soát truy cập.

## 3. Trigger duy nhất

`POST /api/foundation/module-packages/scan` chỉ được gọi khi người dùng kích hoạt **Quét Module** (hoặc kiểm thử API chủ động có xác thực). Không gọi tự động từ `useEffect`, mounted component, route navigation, login, app startup, refresh, filesystem watcher hay timer.

## 4. Phạm vi I/O

- Nguồn filesystem: `repoRoot/modules/` xác định từ đường dẫn repo được cấu hình đáng tin cậy phía server.
- Nguồn database: chỉ SELECT các module và version hiện hữu để đối chiếu.
- Đầu ra: snapshot scan trong RAM với TTL; response gồm aggregate và danh sách per-folder.
- Không ghi filesystem trừ output build/test của quy trình lập trình **ngoài Scanner API** (đánh giá scanner phải thuần đọc).

## 5. Các bước scan

1. Xác minh Session, quyền IAM, Origin/CSRF và body rỗng `{}`.
2. Kiểm tra scan-lock process-local, trả 409 nếu có scan đang hoạt động.
3. Resolve root an toàn, xác nhận tồn tại/directory/truy cập được.
4. Đọc danh sách child folder cấp một theo thứ tự ổn định. Không bỏ qua folder lỗi chỉ vì thiếu `module.json`.
5. Thu thập path/file hợp lệ, lstat không theo symlink/junction, giới hạn số folder/file/byte.
6. Parse `module.json`, gọi lại validator `validateManifest()` với các điều chỉnh để kiểm tra không phát sinh side effect; không dùng `syncModules()` làm scanner.
7. Đọc MIC JSON data-only, parse schema `micSchema` và `validateMic()` cùng context lấy từ Registry (hoặc đánh dấu Registry unavailable).
8. Đối chiếu route/ModuleKey giữa các folder và bản đã đăng ký (phân biệt cùng module nâng cấp với module khác).
9. Tính package SHA-256 canonical; khi file bị thay đổi trong scan phải trả `PACKAGE_CHANGED_DURING_SCAN`, không cấp hash PASS.
10. Tổng hợp checks/issues/classification, lưu snapshot in-memory có giới hạn, trả response.

## 6. Hai trục trạng thái độc lập

### Scan status (tính đúng một nhóm cho mỗi folder)

- `FAIL`: có ít nhất một lỗi chặn.
- `UNAVAILABLE`: không thể xác minh điều kiện bắt buộc do lỗi dịch vụ/nguồn dữ liệu mà không có FAIL chắc chắn.
- `WARN`: không có FAIL/UNAVAILABLE nhưng có cảnh báo.
- `PASS`: tất cả static blocking checks PASS, có thể có Runtime NOT_TESTED vì chưa thuộc phạm vi scan.

Thứ tự ưu tiên tổng hợp: `FAIL > UNAVAILABLE > WARN > PASS`. Thống kê báo cáo đếm theo **scanStatus**; không tính một folder vào nhiều thanh.

### Classification (đối chiếu Registry)

- `NEW_MODULE`: moduleKey chưa đăng ký.
- `UPGRADE_CANDIDATE`: version folder lớn hơn version cao nhất đã đăng ký.
- `EXISTING_VERSION`: moduleKey và version đã tồn tại, kèm status B02 để user nhìn thấy trạng thái khóa.
- `OLDER_PACKAGE`: version folder thấp hơn highest registered.
- `INVALID_PACKAGE`: không đọc được identity hợp lệ.
- `REGISTRY_UNKNOWN`: không thể truy vấn registry; không suy đoán module mới.

Nếu version trùng bản APPROVED/ACTIVE/RETIRED, không xem local folder là chỉnh sửa được; `eligibleForPreflight=false` cho hướng publish cùng version. Riêng nếu folder cùng version nhưng chưa có package hash baseline, trình bày `INTEGRITY_UNVERIFIED` thay vì suy đoán bằng nhau.

## 7. Sự khác biệt giữa SCAN và PREFLIGHT

- SCAN: parse files/MIC, kiểm tra đối chiếu, không import/compile/run code, không tạo version.
- FMI-02 PREFLIGHT: typecheck, build, test API, DB, IAM, regression, MIC10 verified; chỉ chạy trong môi trường TEST cô lập.
- FMI-03 INSTALL: khởi tạo registry/version, IAM/NAV, publish và activate theo các gate; không có trong FMI-01.

`eligibleForPreflight` **không** đồng nghĩa `READY_TO_ACTIVATE`.

## 8. Ngoài phạm vi

Không tự tạo MIC, không sửa code module, không chạy AI, không chạy command từ web, không tự sửa grant, không migration DB, không PUT manifest/SUBMIT/APPROVE/ACTIVATE, không thay đổi giao diện module khác, không triển khai đến production.

## 9. DONE

Nút quét có trong AppShell; Quét thủ công hoạt động; lỗi hiển thị đúng file/field; báo cáo không làm sai trạng thái module; chặn candidate chưa duyệt tự overwrite installed runtime; regression Foundation/IAM/Host vẫn PASS; không có DB write từ authorized scan; tài liệu và test evidence đầy đủ.
