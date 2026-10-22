# 11 — Bàn giao AI Coding Agent — chưa ủy quyền lập trình

> TALO-MOS-V4 | DATA_INSPECTOR | Hồ sơ v0.2 DRAFT | Package/MIC dự kiến 0.1.0 | 22/10/2026 | Repo `main` `fafc4d5f5e0215d40dc9ee7308d23973d1a7b19d`
> USER REVISED SCOPE (22/10/2026). Chỉ thiết kế; không cấp IAM/SQL privileges, không sửa Foundation/Host, không deploy. Bằng chứng runtime: NOT_TESTED.

## Mục đích / quyền hạn

**`implementation_authorized=false`**. Đây là handoff để chuẩn bị phiên code sau khi Owner phê duyệt; không tự code, sync, migrate, grant, register, activate hoặc deploy trong phiên đọc hồ sơ này.

**Goal khi được ủy quyền:** Module `DATA_INSPECTOR` duy nhất trong `modules/DATA_INSPECTOR/`, có 3 API GET, Host readOnly, hiển thị tất cả bảng PostgreSQL, chỉ session account username `admin` ở **backend**, cộng IAM + lifecycle; AppShell screen `/data-inspector` đọc dữ liệu không edit.

## Các bước bắt buộc khi coding (sau approval)

1. Check live branch/commit vs `fafc4d5f5e0215d40dc9ee7308d23973d1a7b19d`, kiểm tra CLAUDE.md và package loader, MIC schema, Host protocol, menu Foundation, database test contract; báo DRIFT nếu khác.
2. Tạo cấu trúc `modules/DATA_INSPECTOR/module.json`, `backend/index.ts`, `backend/*`, `frontend/index.tsx`, `mic/data-inspector.mic.ts`, tests trong module. Các paths trong `module.json` là thiết kế, phải trỏ file thật lúc code.
3. Export `HOST_PROTOCOL='TALO-MODULE-HOST-1'`, `REQUIRED_CAPABILITIES=['session','authorize','lifecycle','readOnly','logger']`, `createModule(host):{router}`; frontend `screens['data.inspector']` và `{tab,onSessionLost}`.
4. Chỉ 3 GET; mỗi request luôn Host session/authorize/lifecycle. Qua `host.readOnly`, tìm account bằng actor.userAccountId (bound UUID) và kiểm tra `username==='admin'`, `ACTIVE`/not disabled. Không tin username client, không role bypass.
5. Catalog tất cả schema (bao gồm system), `relkind r/p`, không app schema allowlist, revalidate `tableKey`; SELECT bảng đúng SQL role/RLS hiện hữu. SQL identifier quoted an toàn, no client SQL. No DDL/migrations/GRANT/role switching.
6. UI hai vùng, chỉ đọc, row page default 50 max 100. Nếu SQL role không đọc được thì hiển thị NOT_READABLE, không nâng quyền.
7. Test quyền admin, nonadmin IAM grant nhầm, direct DENY, session invalid, lifecycle, SQL privilege, RLS, injected tableKey, read-only transaction, body secrets không log.
8. Run static MIC/package validator, Host tests, module build TEST (sau khi được phép). Không ghi PASS nếu không có evidence thực.
9. **STOP nếu** cần sửa `backend/src/modules/foundation/**`, `backend/src/module-host/**`, `frontend/src/**` shared code, IAM schema/grant, DB schema, SQL GRANT, service account hoặc deployment. Lập đề xuất và xin Owner phê duyệt riêng.

## Không được nhầm menu vs API

`host.authorize()` + hard-coded username trong module **bảo vệ API**, nhưng Foundation B09 **không đọc username**. Để user khác không thấy menu theo kiến trúc giữ nguyên, cần IAM provision **hai direct ALLOW chỉ `admin`**, không role grant chung, kiểm chứng danh sách B09. Nếu tình huống bắt buộc ẩn menu khi người khác được cấp nhầm quyền, mục tiêu vượt khả năng module-only: dừng và trình báo, không lén thay Foundation.

## Cấu trúc kết quả mong đợi

Báo diff/commit, files touched, source HEAD, test/DB/route evidence, IAM permissions/grants (read-only verification), menu visibility tests, `NOT_TESTED` case, blockers, action cần Owner phê duyệt. Không deploy và không activate khi MIC10 vẫn NOT_TESTED.

## Prompt giao Coding Agent

> Đọc tất cả 13 file của MODULE-DATA_INSPECTOR-SPEC-v0.2 và mã nguồn main thực tế, rà drift với baseline. Chỉ sau khi Owner duyệt G5, triển khai `DATA_INSPECTOR` trong `modules/DATA_INSPECTOR/`: PostgreSQL all schema base/partitioned table viewer, 3 GET, chỉ read-only, hardcoded backend username `admin` từ actor.userAccountId, luôn Host IAM/lifecycle. Không sửa Foundation/IAM/AppShell/Host, không migration/GRANT/schema/role switch. Nếu strict menu admin-only không thể bảo đảm bằng provision đã duyệt, dừng phần activation và báo blocker. Test thực, không bịa PASS. Report evidence và diffs.
