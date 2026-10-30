# CRM — Module Package (TALO-MODULE-PACKAGE-1)

Module CRM V1 độc lập, do Foundation quản lý (Registry, Lifecycle, IAM, Audit, cài đặt/nâng cấp). Không có nghiệp vụ CRM trong Foundation hay Backend Core.

| Thư mục | Nội dung | Trạng thái 0.1.0 |
|---|---|---|
| `module.json` | Manifest gói: 5 màn hình `/crm`, `/crm/customers`, `/crm/calendar`, `/crm/tasks`, `/crm/reports` | Hoàn chỉnh |
| `frontend/` | Entry `index.tsx` (export `screens`) + `src/` (pages, components, services, hooks, mock, types, styles, utils) | **Hoàn chỉnh, chạy bằng Mock Adapter** |
| `frontend/src/services/adapter.ts` | Ranh giới adapter: Mock ↔ API thật | Mock: có. API: `BLOCKED_BY_MODULE_HOST_WRITE_CAPABILITY` |
| `frontend/src/mock/` | Dữ liệu giả lập (seed) — nằm trong `frontend/` vì sync chỉ copy `frontend/` | Có |
| `backend/` | Entry `index.ts` (Host protocol); `src/` cho api / services / repositories / authorization / adapters / types | Khung — `BLOCKED_BY_MODULE_HOST_WRITE_CAPABILITY` |
| `mic/` | MIC-1.0 | Chưa soạn (Gate 3) |
| `contracts/` | API contract của module | Xem `contracts/README.md` |
| `tests/` | Test của gói (Host chạy `tests/*.test.ts` ở Preflight P3) | Test quy tắc nghiệp vụ của Mock Adapter |
| `docs/` | Tài liệu module | Xem `docs/` |
| `dev/` | Harness chạy độc lập (AppShell + Mock) — **không** thuộc runtime (sync không copy `dev/`) | Có |

Tên thư mục là `CRM` (không phải `crm`): quy tắc MS-05 / `validateManifest()` bắt buộc `moduleKey` = tên thư mục (K01, chữ hoa).

## Chạy độc lập (từ thư mục gốc repo)
```bash
node frontend/node_modules/typescript/bin/tsc -p modules/CRM/tsconfig.json                     # typecheck (cờ strict như Host)
node frontend/node_modules/vite/bin/vite.js --config modules/CRM/dev/vite.config.mjs           # dev server http://127.0.0.1:5181/crm
node frontend/node_modules/vite/bin/vite.js build --config modules/CRM/dev/vite.config.mjs     # build (ra TALO-MOS-V4_exports/crm-frontend-dev-build)
node backend/node_modules/vitest/vitest.mjs run --root modules/CRM                              # test quy tắc nghiệp vụ (mock)
```
