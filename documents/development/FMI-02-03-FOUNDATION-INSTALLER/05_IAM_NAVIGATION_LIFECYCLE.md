# 05 — IAM / Navigation / Lifecycle contract

## IAM permission phụ thuộc version ACTIVE

`IamAdminRepository.createPermission()` hiện yêu cầu MIC-07 của version ACTIVE và hash-intact. Vì vậy không thể giả định provision permission trên Candidate DRAFT qua public API rồi chạy live IAM tests như một version đã ACTIVE.

Quy trình đúng:
1. FMI-02 kiểm tra MIC07 K05 bằng validator và role/permission *mô phỏng hoặc staging IAM*; kết quả không đồng nghĩa cấp quyền thực.
2. FMI-03 precheck quyền installer/admin để tạo permission; kiểm tra không có triple trùng và không vi phạm platform permission protections.
3. Sau ACTIVE, tạo/đối chiếu permission catalog idempotent theo MIC07 thông qua IAM service hợp lệ.
4. Chỉ gán tài khoản/role theo policy đã được phê duyệt; không tự ASSIGN `admin` cho mọi module.
5. Dữ liệu nhạy cảm như bảng Data Inspector và System Logs phải giữ điều kiện admin-only ở Backend; sidebar ẩn không thay được backend authorization.
6. Nếu thiếu quyền/role/DB grant: hiển thị quyền thiếu và hậu kiểm FAIL; không tự SQL GRANT hay bypass `notSelf`, root protection.

## B09 Navigation

- MIC04 là nguồn mô tả menu mong muốn, nhưng B09 là bảng lưu menu và thao tác CREATE/PATCH hiện tại chỉ cho phép title/order/visible, không cho DELETE hay đổi parent/function ID bằng PATCH.
- Installer phải lập plan theo IDs và natural identity để không nhân đôi menu; nếu cần thay parent/link phải thiết kế đường tạo mới + ẩn old với audit (không xóa) và kiểm tra child references.
- Chỉ thêm group/menu chức năng khi Function/Action có version ACTIVE hợp lệ; không tạo link vượt quyền.
- Giữ các nhóm Foundation, IAM, Develop, menu thật, và trạng thái Navigation Builder đang có. Không tự xóa B09 fixture chỉ vì tên lạ.
- Postcheck từ tài khoản admin và non-admin đã có quyền/không có quyền, không dùng UI display để chứng minh authorization.

## MIC10 và version locking

- Foundation schema cho `testEvidence` gồm name/result/reference; hiện gate chỉ cần mọi result PASS.
- FMI-02/03 phải thêm xác minh evidence nguồn server (packageHash + runId + reportHash + target), không lấy `PASS` từ MIC tự viết làm proof.
- B02 chỉ được tạo/submit sau READY; nếu DRAFT có sẵn, cho phép PUT hợp lệ trước SUBMIT và không thay code liên quan mà chưa rerun.
- APPROVED/ACTIVE không thay MIC/hash. Nếu prior versions locked, phải tạo candidate kế tiếp theo semver hợp lệ.
- Không đổi compatibility kind/fromVersion để né lỗi; phải đối chiếu lịch sử B02.

## Tình trạng hồi phục

- Upgrade ACTION canary: nếu quyền chưa sẵn sàng hoặc postcheck FAIL sau DB ACTIVATE, hệ thống ở trạng thái PARTIAL/RECOVERY_REQUIRED và chặn success; phải có operator flow, không tự chuyển RETIRED về ACTIVE qua SQL.
- Recovery path không có trong Foundation hiện hành; không tuyên bố one-click upgrade production-ready nếu chưa test được recovery.
