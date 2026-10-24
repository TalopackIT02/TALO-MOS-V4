# RED TESTS — viết trước khi sửa (backend/test/unit/foundation/foundation.installer.test.ts)

Lệnh: `cd backend && npx vitest run test/unit/foundation/foundation.installer.test.ts` → **7 failed | 16 passed (23)** trên mã `b7b5f07`.

| Test | Lỗi tái hiện (đúng nguyên nhân) |
|---|---|
| A01/A02/A10 module đã đăng ký, DRAFT chứa MIC mẫu | plan BLOCKED `UPGRADE_NOT_SUPPORTED`, không có `micDiff` |
| A03 DRAFT đổi sau khi lập kế hoạch | không phát hiện `DRAFT_CHANGED_EXTERNALLY` (ghi đè âm thầm) |
| A13/A15 catalog có, chưa gán quyền | trả `RECOVERY_REQUIRED`/`INSTALLED_ACTIVE` thay vì `POSTCHECK_INCOMPLETE` |
| A14 B09 3 tầng + link ẩn | installer gọi `createItem` (nhóm gốc → Function, legacy `FUNCTION_UNDER_AREA`); không có `navigationPlan` |
| IN-12 / IN-09 / IN-01 (test cũ đổi kỳ vọng theo REV-01) | danh sách hậu kiểm 5 mục, B09 2 dòng, `UPGRADE_NOT_SUPPORTED` |

Sau khi sửa: **24/24 PASS** (thêm test A08/E2E-05: 200 sai hợp đồng → `ACCESS_VERIFIED` FAIL).
