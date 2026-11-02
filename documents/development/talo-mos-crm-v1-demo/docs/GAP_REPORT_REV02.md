# CRM V1 REV02 — Gap Report trước tích hợp thật

**Ngày:** 29/10/2026 · **Loại:** SOURCE / CONTRACT GAPS (không phải migration request được duyệt)

## Nguyên tắc áp dụng

- Baseline PostgreSQL TEST theo tài liệu: **11 bảng / 114 cột**. Không kết nối kiểm chứng DB live.
- Target ứng viên Backend REV01: **15 bảng / 173 cột**. Chưa có bằng chứng đã chạy migration trên TEST.
- REV02 không thêm bất kỳ **bảng/cột database** nào; Data Dictionary gốc giữ nguyên và **40 đường API REV01** vẫn được bảo toàn.
- Những trường diễn giải trong `src/workflows/adapter.ts` chỉ là **format văn bản demo**, không phải DDL, không phải cấu trúc được phê duyệt cho môi trường thật.

| ID | Nhu cầu handoff | Có trong schema/API hiện tại | Xử lý demo | Gap khi tích hợp thật / đề xuất quyết định |
|---|---|---|---|---|
| G-01 | Lịch hẹn riêng với ngày/giờ | `cm_customer_activities.activity_type_code=MEETING`, `occurred_at` | Calendar ngày/tuần/tháng dùng activity chung | Cần phê duyệt ranh giới lịch hẹn trong nghiệp vụ và request `occurred_at` cho POST/PATCH |
| G-02 | Địa điểm, nội dung dự kiến | Chỉ `description` chung | Marker `[CRM_DEMO_APPOINTMENT_V1]`, văn bản có nhãn | Cần hợp đồng cấu trúc dữ liệu địa điểm/nội dung; không mặc định cột mới |
| G-03 | Nhắc lịch | Không có reminder field/service hợp đồng | Khi mở ứng dụng, so sánh thời gian với demo clock (10:00 theo ngày giả lập); hiện nhãn | Cần thiết kế reminder preference/notification lifecycle nếu triển khai thật; không mặc định email/push/background |
| G-04 | Hủy lịch | Activity dictionary có CANCELLED nhưng PATCH contract chưa chốt cập nhật status | PATCH existing activity mock nhận `activity_status_code=CANCELLED` chỉ cho MEETING | Cần bổ sung/duyệt quy tắc API và audit hủy lịch |
| G-05 | To-do độc lập với Calendar | `TASK/FOLLOW_UP`, `due_at`, `OPEN/DONE` | Task List cùng activity store | Cần đối chiếu owner và quyền trên mỗi loại hoạt động |
| G-06 | Độ ưu tiên To-do | Không có trường priority riêng | Không hiển thị priority; không tự chèn schema | Nếu V1 chính thức cần mức ưu tiên, phải quyết định quy tắc/cột và migration riêng |
| G-07 | Báo cáo kết quả làm việc | `NOTE`, `title`, `description`, `occurred_at` | NOTE được tạo và hoàn thành, parse mô tả có nhãn | Backend REV01 chưa có Work Report endpoint/schema/hợp đồng trạng thái riêng |
| G-08 | Nội dung thực hiện / kết quả / vấn đề / tiếp tục | Chỉ `description` chung | Marker `[CRM_DEMO_WORK_REPORT_V1]` + các dòng có nhãn | Nếu cần báo cáo cấu trúc, cần hợp đồng trường và chuẩn version; không khẳng định demo text là production design |
| G-09 | Liên kết Report ↔ To-do/Calendar | Chưa có FK/source activity ref ở 11/114 | `origin` id lưu trong description, hiển thị trong picker | Bắt buộc thiết kế liên kết bền vững, tính toàn vẹn và chống trùng báo cáo khi tích hợp thật |
| G-10 | Phân quyền riêng Schedule/To-do/Report | REV01 chỉ có `activity.create/update` và customer scope | Dùng cùng capability hiện có | Xác nhận có cần capability tách riêng theo nghiệp vụ hay không |
| G-11 | Ngày thực hiện báo cáo | `occurred_at` | POST NOTE với `occurred_at` demo | Cần chốt nhập ngày khác ngày tạo trong API contract |
| G-12 | Bàn giao/Legal approvals | 4 bảng/59 cột thuộc migration candidate | Mock hoạt động theo thiết kế target | Không báo các bảng đang cài TEST; cần migration review và runtime acceptance |
| G-13 | Tài liệu upload bền vững | Metadata có, blob storage demo không bền | Blob bộ nhớ phiên trình duyệt | Backend storage/version/retrieval thật phải được triển khai |
| G-14 | Thương hiệu AppShell/assets | Có visual contract, CSS/chrome bám bản trước | Dùng shell hiện có trong REV01, text logo; không sửa Foundation | Cần đối chiếu pixel và assets repo thật khi môi trường dev cho phép |
| G-15 | Ngày giờ / múi giờ và lịch nhắc | `timestamptz` có nhưng timezone policy chưa chuẩn | Datetime-local convert ISO, demo clock 10:00 GMT+7 | Chốt timezone/business date, DST và notification schedule trong API chính thức |
| G-16 | Work Report ghi atomically | API POST NOTE + POST complete riêng | Thao tác nối tiếp; không giao dịch cross-request | Cần thiết kế transaction/idempotency để tránh NOTE mở nếu bước complete lỗi |

**Kết luận tích hợp:** Không chạy SQL, không sửa Foundation/IAM, không công bố MIC đã đăng ký. Các Gap là yêu cầu rà soát và quyết định thiết kế, không phải phê duyệt tự động mở rộng schema.
