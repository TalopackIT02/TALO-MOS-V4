# BASELINE — FOUNDATION-REV-01 (23/10/2026)

- Branch `feat/system-test-diagnostics-v1-1`, HEAD `ea91c29` (hồ sơ REV-01) trên `b7b5f07` (FMI-02/03). Working tree sạch lúc bắt đầu (0 thay đổi).
- Local vs GitHub tham chiếu `b7b5f071`: không có khác biệt mã ngoài commit hồ sơ `ea91c29` (DIFF = chỉ `documents/development/FOUNDATION-REV-01-INTEGRATION/`). Không checkout / reset.
- DB: `current_database()` = `talo_mos_v4_test` (đọc qua session read-only). Runtime backend/frontend dev đang chạy (health 200).
- B01/B02 (trạng thái lúc bắt đầu, đọc-chỉ):
  - SYSTEM_TEST enabled: 1.1.1 ACTIVE (`aaee3940…`), 1.2.0 DRAFT **manifest NULL** (template `MAIN.READ` chỉ là pre-fill phía frontend, không nằm trong DB), 1.0.3 RETIRED, 1.0.0/1.0.2/1.1.0 APPROVED, 1.0.1 REJECTED.
  - DATA_INSPECTOR 0.1.0 ACTIVE, **is_enabled = false** (baseline, không đổi).
- Lock `backend/module-deployments.json`: DATA_INSPECTOR 0.1.0 `45c4a3a0…`, SYSTEM_TEST 1.1.1 `4cc97571…`; runtime backend = frontend = lock.
- B09: 851 dòng (605 visible), digest `bf63c1ad…`; B07 6.099 / B08 13.312; IAM permissions 27, role_permissions 25, user_roles 1; FBET modules 1.944 (237 enabled).
- Candidate `modules/SYSTEM_TEST` 1.2.0 hash `463dddfc…` (= bản chủ dự án báo đã vá).
- Backup trước test ghi DB: `TALO-MOS-V4_exports/REV-01-20261023-135930/talo_test_before_rev01_20261023-135930.dump`, SHA-256 `cf97f29927cd781fd4e73e2db656e3f265f7a922fc069f7c98a472816b76e01c`, `pg_restore -l` 25 khối dữ liệu.
- Lỗi có sẵn trước khi sửa: Playwright `auth-flow` ×2, DB navigation V8, DATA_INSPECTOR DB TC-19 (do baseline is_enabled=false).
