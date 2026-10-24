# CLOSURE-FINAL — FOUNDATION REV-01 CLOSURE + UI-01

**Kết luận: PARTIAL.**
- D1, D2, D3 và UI-01 đều PASS, có bằng chứng.
- Hồi quy backend còn 2 timeout ở hai test không liên quan (xem dưới).
- Chưa commit, chưa push.

## Bảng nghiệm thu

| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| REV01-D1 Active Upgrade Recovery | **PASS** | Unit 10 ca D1 + 5 ca Lifecycle; DB: lifecycle D1-DB, installer 1.0.0→1.1.0 FAIL→RECOVERED→1.2.0 INSTALLED_ACTIVE |
| REV01-D2 IAM privilege | **PASS** | False negative ở mức bảng đã sửa. Không cần và không thực thi GRANT. Repository thật trên `talo_iam_admin`: hợp lệ / sai K05 / sai level / chưa ACTIVE / trùng / 403 / audit |
| REV01-D3 Route conflict guard | **PASS** | Unit 6/6 (RED 3 fail); DB: FBET_ST so với SYSTEM_TEST → 409 không đổi gì; race 200 + 409 |
| UI01 | **PASS** | 13 ca × 2 project; RED 13 fail → GREEN; ảnh before / after |
| A12 | **PASS** | Phục hồi đã được phê duyệt và kiểm thử với failure injection; chỉ qua Lifecycle Service, không có SQL trực tiếp |
| E2E-03 | **PASS (API / DB)** | Luồng end-to-end qua API thật trên TEST (failure injection + success). Chưa có Playwright cho luồng upgrade |
| Backend regression | **PARTIAL** | typecheck PASS; `npm test` 445 / 447: 2 timeout ở `sc5Model` H-a và `module-scan` limits (file không sửa, nhạy thời gian) |
| Frontend regression | **PASS** | `npm run build` (typecheck + vite build) |
| Playwright responsive | **PASS** | 311 passed. 2 fail `auth-flow:38` có sẵn |
| DB TEST postcheck | **PASS** | Leftovers 0/0/0; IAM 27/25/1/2; D2 postcheck_ok = 1 |
| ACTIVE baseline preserved | **PASS** | SYSTEM_TEST 1.1.1 ACTIVE `aaee3940…`, 1.2.0 DRAFT; DATA_INSPECTOR không đổi; lock sha `80c70e4c…` không đổi |
| Git working tree | **Chưa commit** | 40 mục (`$OUT/final-git-status.txt`); không checkout / reset; không push / merge / deploy |

## SQL grant và role

- **Role:** `talo_iam_admin`, kết nối `IAM_ADMIN_DATABASE_URL`, `current_user = session_user = talo_iam_admin`, DB `talo_mos_v4_test`.
- **GRANT đã thực thi:** **không có.** Các quyền cột cần thiết đã tồn tại.
- **Script:** `database/scripts/iam-admin/10…13`. Chỉ chạy 10 (precheck) và 12 (postcheck), cả hai read-only. Không chạy 11 (grant) và 13 (rollback).

## Ngoài phạm vi / không làm

- Không đổi schema, Prisma, SYSTEM_TEST 1.2.0 hay hash `463dddfc…`.
- Không ACTIVATE SYSTEM_TEST.
- Không sửa B02 bằng SQL.
- Không xóa B07 / B08 / B09.
- Không tự gán quyền.
- Không cài thư viện.

## Cần chủ dự án phê duyệt / quyết định

1. **Commit thay đổi REV-01 + CLOSURE.** Chưa commit vì hồi quy backend chưa xanh hoàn toàn.
2. **Hai test nhạy thời gian** (`sc5Model` H-a, `module-scan` limits). Phương án: tăng timeout riêng, hoặc giảm số worker chạy song song.
3. **208 fixture FBET cũ đang bật** cùng giữ `/sales/orders`. Có dọn (DISABLE qua API) không? Chưa dọn thì guard D3 vẫn chặn mọi module mới dùng route này. Fixture mới nay đã dùng route riêng.
4. **Module của run** `FBET_MVLX2VY2_7BD553_15` (`a7469591-6307-4a58-adce-72435ad6e9a6`) còn bật. Có tắt không?
5. **Harness `AuthFixtures.cleanup()`** xóa `iam_audit_logs` của account fixture AUTHT-. Lượt này xóa 4 dòng, gồm audit `IAM.PERMISSION.CREATE` của actor fixture. Có giữ chính sách này không, khi đối chiếu với nguyên tắc "không xóa IAM audit"?
6. **Lỗi có sẵn:** navigation DB V8 / acceptance beforeAll, do quyền `data_inspector.*` chờ đăng ký; Playwright `auth-flow:38`.
