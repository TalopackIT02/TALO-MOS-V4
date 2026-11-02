# Build & runtime verification — CRM V1 REV02

**Mốc:** 29/10/2026.

| Kiểm tra | Kết quả |
|---|---|
| Parser TS/TSX `npm run check:syntax` | PASS |
| Mock tests `npm test` | PASS — 51/51 |
| Semantic TS check với shim tạm để kiểm lỗi logic khi thiếu React types | PASS — chỉ là kiểm tra phụ, **không thay thế** `tsc -b` với types thật |
| `npm run build` | **BLOCKED / NOT VERIFIED** — môi trường không có `react`, `@types/react`, `vite`, `lucide-react` trong node_modules |
| `npm install` | **BLOCKED** — không phân giải được `registry.npmjs.org` (DNS/network) |
| Dev server / Playwright / UI acceptance | **NOT_TESTED** — chưa có dependency bundle |

**Không được báo PASS cho frontend runtime**. Để kiểm chứng: máy có internet cài `npm install`, chạy `npm run build`, `npm run dev`, mở `http://127.0.0.1:5173/demo/crm`, kiểm thử `docs/FRONTEND_ACCEPTANCE_STATUS.md`.

Dữ liệu chỉ nằm trong browser localStorage `TALO_CM_DEMO_REV02_WORKFLOW`; đây là key riêng tránh xung đột REV01. File upload binary chỉ giữ trong bộ nhớ phiên.
