# CRM — API contract (client ↔ backend)

- Interface phía client: `frontend/src/services/adapter.ts` (`CrmAdapter`). Mọi màn hình chỉ gọi interface này.
- Hợp đồng backend đã thiết kế (CM-BE-SPEC-REV01 + quyết định chủ dự án 2026-10-30): prefix `/api/cm`, hai endpoint duyệt pháp lý `POST /api/cm/legal-changes/:id/management-decision` và `.../accounting-decision`; ma trận API → quyền → bảng/cột → phạm vi ở báo cáo `INTEGRATION_CONTRACT_FOUNDATION_IAM.md` (gói DB) và báo cáo Gate 1.
- Lịch hẹn, Công việc, Báo cáo: **chưa có hợp đồng backend** (chưa có bảng) — Gate 2 `CRM_V1_DB_EXTENSION_APPROVAL`.
