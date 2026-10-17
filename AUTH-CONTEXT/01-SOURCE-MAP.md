# SOURCE MAP — mở file theo vấn đề, không đọc toàn repo

> **Superseded (AUTH-FIX):** TALO-MOS-V4 no longer uses HIBP / Pwned Passwords. Every HIBP / blocklist item below is historical; the current contract is `backend/src/modules/auth/AUTH-API-v1.md` §5.3.

Kiểm chứng từ GitHub `main` tại thời điểm lập snapshot; file local có thể mới hơn. **Chỉ mở nhóm đang sửa.**

| Cần xử lý | Entry point hiện hữu | Test/hỗ trợ |
|---|---|---|
| Password policy / P-4d | `backend/src/modules/auth/passwordPolicy.ts`, `pwnedPasswords.ts`, `auth.service.ts` | `backend/test/support/pwnedFixture.ts` và test auth tương ứng |
| HIBP manifest/verify | `backend/src/modules/auth/tools/pwnedManifest.ts` | `npm run pwned:manifest`; `npm run pwned:verify` (xem arguments trong script hiện tại) |
| Provisioning cấp mới | `backend/src/modules/auth/provisioning/{cli.ts,provisionAccount.ts,temporaryPassword.ts}` | `backend/test/support/authFixtures.ts`; test provisioning hiện hữu |
| Recovery / session revoke | `backend/src/modules/auth/auth.repository.ts`, `auth.service.ts`; IAM grant scripts trong `database/scripts/` | `backend/test/integration/auth/` và SC5 writer protocol |
| API behavior | `backend/src/modules/auth/auth.routes.ts`, `AUTH-API-v1.md`, `AUTH-API-v1.yaml` | `backend/test/unit/auth/`, `backend/test/integration/auth/` |
| React E2E | `frontend/src/App.tsx`, `frontend/src/pages/auth/`, `frontend/src/services/auth/` | `tests/e2e/`, `tests/playwright.auth.config.ts` |
| Database fixture | `backend/test/support/{authFixtures.ts,e2eFixtures.ts,pwnedFixture.ts}` | Tái sử dụng, **không tạo harness mới** |

## Lệnh chính đã xác nhận trong package.json
```text
# Từ backend/
npm run typecheck
npm run build
npm test
npm run smoke:db                    # thật sự kết nối DB: KHÔNG chạy như fast check
npm run provision:account -- ...    # GHI DB: chỉ khi user đã duyệt cụ thể
npm run pwned:manifest -- ...       # GHI manifest: chỉ khi có dataset được phép
npm run pwned:verify -- ...         # đọc dataset, có thể rất lâu với full set

# Từ frontend/
npm run typecheck
npm run build

# Từ tests/
npm run typecheck
```

**Không tự chạy** `TALO_AUTH_DB=1`, `TALO_AUTH_PRIV=1`, Playwright E2E hay provisioning nếu chưa xác minh guard, DB mục tiêu và phạm vi được duyệt trong phiên mới. Các lệnh đó có thể ghi dữ liệu hoặc tác động tiến trình đang chạy.

## Lưu ý lỗi thời
Root `README.md`, `CATALOG.html` vẫn mô tả frontend/backend là placeholder. `backend/src/modules/auth/README.md` có một số dòng file cũ (ví dụ `blocklist.ts`) dù code hiện có `pwnedPasswords.ts`. Ưu tiên file thực và `package.json`, không sửa README chỉ để tô đẹp task.
