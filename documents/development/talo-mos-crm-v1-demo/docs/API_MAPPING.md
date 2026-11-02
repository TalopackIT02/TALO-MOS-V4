# Mapping CRM Backend REV01 → Mock API

Prefix logical `/api/cm` là **đề xuất chưa đăng ký runtime**. API giả lập được gọi qua `crmApi.call(path, {method,persona,body,query})` và không sử dụng fetch/network. `MockCrmApi` trả giá trị đã unwrap để thuận tiện với UI; `handleMockRequest` trả envelope HTTP giả lập `{data}` hoặc `{error:{code,message,requestId}}` cùng status.

| Nhóm | Route / handler | Nguồn dữ liệu |
|---|---|---|
| Khách hàng | GET/POST `/customers`, GET/PATCH `/customers/:id`, POST `/verify`, `/hide`, GET `/check-identity` | customers, assignments, groups |
| Sửa pháp lý | POST/GET `/customers/:id/legal-changes` | legalChangeRequests + legalChangeApprovals (CANDIDATE) |
| Liên hệ | GET/POST `/customers/:id/contacts`, PATCH `/contacts/:contactId`, POST `/deactivate` | contacts |
| Phân công | GET/POST `/customers/:id/assignments` | assignments (role column CANDIDATE) |
| Bàn giao | POST `/customers/:id/handovers`, GET `/handovers`, GET `/handovers/:id`, POST `/approve`, `/acknowledge`, `/reject` | handovers + handoverActivityTransfers (CANDIDATE) |
| Hoạt động | GET/POST `/customers/:id/activities`, PATCH `/activities/:id`, POST `/complete`, GET `/customers/:id/timeline` | activities + business event stream |
| Documents | GET/POST `/customers/:id/documents`, GET `/documents/:id/download`, POST `/documents/:id/versions`, PATCH `/documents/:id/metadata`, GET `/documents/expiring` | documents, supersedes column CANDIDATE |
| Danh mục | GET `/references/provinces`, `/references/wards`, `/references/regions`, `/references/customer-types` | verified subset of reference tables |
| Nhóm ngành | GET/POST `/groups`, PATCH `/groups/:id`, PUT `/customers/:id/groups` | groups, groupMembers |

**Tổng 40/40 endpoint** trong `API_ROUTES` kiểm bằng `tests/mock.test.cjs` (TC T00). Bản CSV gốc ở `api-contract-source.csv`. Các route được match chính xác theo thứ tự (check-identity trước `/customers/:id`, expiring trước `/documents/:id/...`).

## Tác nghiệp không được tự đặt API mới

Tài liệu backend nêu 2 cấp approve pháp lý nhưng 40 endpoints không có route phê duyệt. UI sử dụng hàm **mock-only** `decideLegal()`; không tạo endpoint số 41. Cần chủ dự án phê duyệt API addendum trước khi có Backend thật.

## Adapter boundary

- `CrmApi`: interface async trong `service.ts`.
- `MockCrmApi`: state, capability, object scope, validation, transaction clone-and-commit.
- `HttpCrmApi`: intentionally disabled, luôn 503 `CM_NOT_INTEGRATED`, không có host hoặc token.
- `handleMockRequest`: envelope/error contract cho kiểm thử.

Không dùng `document.storage_path` để sinh URL file thật. CSV được quote và neutralize formula-prefix. `requestId` là trace demo ngẫu nhiên, không tương đương Foundation trace middleware.

## REV02 addendum — Calendar / To-do / Work Report

Không tạo endpoint mới. `src/workflows/adapter.ts` tái sử dụng các API activity REV01:

| UI | Method/endpoint hiện có | Dữ liệu / quy ước | Trạng thái tích hợp |
|---|---|---|---|
| Calendar và tab Lịch hẹn | `GET /api/cm/customers/:id/activities` (lọc MEETING ở adapter) | `activity_type_code=MEETING`, giờ hẹn từ `occurred_at`, địa điểm/nội dung serialized `description` | Mock-only projection; contract body chưa được duyệt |
| Tạo lịch hẹn | `POST /api/cm/customers/:id/activities` | `MEETING`, `title`, `occurred_at`, description marker, assignee | Mock-only request extension |
| Sửa / hủy lịch | `PATCH /api/cm/activities/:id` | `occurred_at`, `description`, `activity_status_code=CANCELLED` | Mock-only request extension; cần phê duyệt API chính thức |
| To-do và tab Công việc | GET/POST activity + PATCH + complete | `TASK/FOLLOW_UP`, `due_at`, `OPEN/DONE` | Trường baseline hiện có |
| Work Report và tab Hoạt động & Kết quả | POST activity NOTE, POST complete | `NOTE/DONE`, `occurred_at`, trường nội dung báo cáo gói thành text | Mock-only projection, chưa có schema/endpoint báo cáo riêng |
| Link báo cáo với nguồn Calendar/To-do | Không có endpoint chuyên biệt | `activity_id` nguồn trong `description` của NOTE | Demo-text link; **không có FK** |

**Cần đối chiếu** `docs/GAP_REPORT_REV02.md` trước khi thay Mock API bằng Backend thật. Không giả định hai phía hỗ trợ cùng kiểu request chỉ vì demo đã hoạt động.
