# TEST RESULTS (log đầy đủ ngoài repo: `TALO-MOS-V4_exports/REV-01-20261023-135930/t-*.log`)

| Lệnh | Kết quả |
|---|---|
| `backend: npm test` | 426 passed / 169 skipped (595), exit 0 |
| `backend: npm run typecheck` | exit 0 |
| `frontend: npm run build` (typecheck + vite) | exit 0 |
| `vitest foundation.installer.test.ts` | 24/24 (RED trước sửa: 7 failed) |
| `vitest foundation.preflight.toolchain.test.ts` (tsc/vitest/harness thật) | 2/2 |
| DB `foundation.installer.db.test.ts` (TALO_FOUNDATION_DB=1) | 1/1 — IAM thật BLOCKED `IAM_DB_GRANT_MISSING`; service thật → POSTCHECK_INCOMPLETE → (gán quyền fixture) INSTALLED_ACTIVE 7/7; B09 thật `FBET installer <run> › FBET › Đơn hàng`, 0 legacy; lần 2 không ghi B09 |
| DB module-scan / lifecycle / system-test | 2/2 · 10/10 · 2/2 |
| DB navigation | 14/15 — V8 lỗi có sẵn |
| Playwright react-dev + react-preview | 285 passed, 2 failed (`auth-flow`, có sẵn), 9 skipped |
| Live TEST (app đang chạy, tài khoản tạm) | SYSTEM_TEST 1.2.0 `463dddfc…` READY (9 PASS, P5b N/A, P8 NOT_TESTED); plan BLOCKED [UPGRADE_RECOVERY_UNAVAILABLE, IAM_DB_GRANT_MISSING]; trạng thái bảo vệ không đổi; ảnh `rev01-live-*.png` |

## Ma trận nghiệm thu

| Gate | KQ | Gate | KQ | Gate | KQ |
|---|---|---|---|---|---|
| G0.1–G0.4 | PASS | A01–A10 | PASS | A11 | PASS (chặn, có blocker) |
| A12 | BLOCKED (cần phê duyệt) | A13, A14, A16 | PASS | A15 | PASS |
| A07 | PASS | A08 | PARTIAL (shape JSON object, chưa có schema từng trường — MIC-1.0 không mô tả response) | B01–B09, B11 | PASS |
| B10 | PARTIAL (Escape/focus/mobile drawer có test; discard-dirty vẫn `window.confirm`) | C01–C10 | PASS | E2E-03 | BLOCKED (recovery) |
