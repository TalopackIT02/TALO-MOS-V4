# CRM — danh mục quyền dự kiến (K05, chưa đăng ký)

`permission_code = lower('CRM.<FUNCTION>.<ACTION>')`, `module_code = CRM`, `resource_code = FUNCTION`, `operation = ACTION`.

| Function | Actions |
|---|---|
| CUSTOMER | READ, READ_ALL (phạm vi toàn bộ — chỉ khi IAM cấp), CREATE, UPDATE, VERIFY, HIDE, EXPORT |
| LEGAL_CHANGE | READ, REQUEST, APPROVE_MANAGEMENT, APPROVE_ACCOUNTING |
| CONTACT | READ, MANAGE |
| GROUP | READ, MANAGE, ASSIGN |
| ASSIGNMENT | READ, MANAGE |
| HANDOVER | REQUEST, APPROVE, ACKNOWLEDGE, REJECT, OVERRIDE |
| ACTIVITY | READ, CREATE, UPDATE, COMPLETE |
| DOCUMENT | READ, MANAGE |
| REFERENCE | READ |

Quyền cho Lịch hẹn / Công việc / Báo cáo: chưa thiết kế (Gate 2). Mock Adapter dùng bộ quyền giả lập theo vai trò (`frontend/src/mock/seed.ts`, `MOCK_PERMISSIONS`) — **không** phải cấp quyền thật.
