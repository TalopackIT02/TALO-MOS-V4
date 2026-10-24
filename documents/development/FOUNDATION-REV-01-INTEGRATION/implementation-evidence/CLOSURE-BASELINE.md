# CLOSURE-BASELINE — FOUNDATION REV-01 CLOSURE + UI-01

Ngày: 2026-10-24 · Nhánh `feat/system-test-diagnostics-v1-1` · HEAD `ea91c29` + thay đổi REV-A/B/C chưa commit (working tree local là nguồn chuẩn; không checkout / reset / restore).

Thư mục log dài, ảnh và dump: `D:/Documents/ClaudeProject/TALO-MOS-V4_exports/REV-01-20261023-135930/CLOSURE-20261024-110735/` (gọi tắt `$OUT`).

## Sao lưu trước mọi ghi DB

| Mục | Giá trị |
|---|---|
| Dump | `$OUT/talo_test_before_closure_20261024-110735.dump` (pg_dump -Fc, `talo_mos_v4_test`, 25 data blocks) |
| SHA-256 | `57651054bfd65d137713fc822cbb97c691ddd971276dbeba64546b6ad8644490` (`$OUT/backup.sha256`) |

## Trạng thái bảo vệ (read-only, `$OUT/baseline-db.txt`)

| Mục | Baseline |
|---|---|
| DATA_INSPECTOR | `false` · 0.1.0 ACTIVE `7739cbcb…` |
| SYSTEM_TEST | bật · 1.1.1 ACTIVE `aaee3940…` · 1.2.0 DRAFT (không hash) · 1.0.0 / 1.0.2 / 1.1.0 APPROVED · 1.0.1 REJECTED · 1.0.3 RETIRED |
| B09 | 896 dòng / 637 hiển thị |
| IAM (permissions / role_permissions / user_roles / user_permissions) | 27 / 25 / 1 / 2 |
| Leftovers (FBET- roles / AUTHT- accounts / FBET% permissions) | 0 / 0 / 0 |
| Fixture FBET ACTIVE + ENABLED | 208 (tất cả cùng giữ `/sales/orders` của `validMic`) |
| `backend/module-deployments.json` sha256 | `80c70e4cfe3491733f602605ad16dad0aa4e6768d0189e0d6a63fb800e503df3` |

Git: `$OUT/baseline-git-status.txt` (26 mục — thay đổi REV-01 chưa commit).

## Lỗi có sẵn trước task (không do CLOSURE)

- Playwright `auth-flow.e2e.spec.ts:38` (react-dev + react-preview).
- `foundation.navigation.db.test.ts` V8 và `foundation.acceptance.db.test.ts` beforeAll: 2 quyền `data_inspector.*` ngoài FOUNDATION / SYSTEM_TEST / IAM (đăng ký DATA_INSPECTOR đang chờ chủ dự án).
- DATA_INSPECTOR DB TC-19 (baseline `is_enabled=false`).
