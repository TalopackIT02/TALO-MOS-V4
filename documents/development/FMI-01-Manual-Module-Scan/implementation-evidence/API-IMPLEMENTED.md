# FMI-01 — API đã triển khai

Mã nguồn: `backend/src/modules/foundation/foundation.module-scan.{routes,service,files,validation,types}.ts`, gắn vào Foundation tại `index.ts`.

## POST `/api/foundation/module-packages/scan`

- Body đúng `{}` (zod `strictObject({})`); mọi trường khác, `null`, mảng → 400 `VALIDATION_ERROR`; body > 10 kB → 413 (parser JSON chung).
- Phiên + Origin + JSON qua `sessionHandler` và stack `/api` hiện có.
- Quyền: `AccessGuard.authorize` lần lượt `foundation.module_registry.read` rồi `.create` (evaluator IAM, assurance hiện hành). Từ chối → 403 `FORBIDDEN` + 1 dòng B08 DENIED, `action_code = MODULE_PACKAGE.SCAN`, `target_type = MODULE_PACKAGE`; lỗi đánh giá IAM → 503 `SERVICE_BUSY`. Không có permission mới.
- Quét được phép: chỉ đọc filesystem `<repo>/modules` (đường dẫn tính từ vị trí mã server) + một câu SELECT Registry (`MODULE_SCAN_SQL.registry`: B01 LEFT JOIN B02, MIC-04 của bản ACTIVE). Không ghi B01–B14/IAM/B09, không B08 SUCCESS.
- 200 `ScanReport`:

```
{ scanId: uuid, status: "COMPLETED", scannedAt: ISO-UTC, durationMs, registryAvailable: boolean,
  summary: { total, passed, warnings, failed, unavailable },            // tổng 4 nhóm = total = modules.length
  modules: [{ folder, moduleKey|null, moduleName|null, packageVersion|null,
              classification: NEW_MODULE|UPGRADE_CANDIDATE|EXISTING_VERSION|OLDER_PACKAGE|INVALID_PACKAGE|REGISTRY_UNKNOWN,
              foundationVersionStatus: DRAFT|IN_REVIEW|APPROVED|ACTIVE|RETIRED|REJECTED|null,
              registeredVersions: [{ moduleVersion, status }],
              scanStatus: PASS|WARN|FAIL|UNAVAILABLE, eligibleForPreflight: boolean,
              packageHash: hex64|null, micFormat: JSON|LEGACY_TS|MISSING|INVALID, fileCount, routes: [string],
              checks: [{ id: "MS-01".."MS-20", status, code, path|null, message }],          // luôn đủ 20
              issues: [{ checkId, code, severity: WARNING|ERROR|UNAVAILABLE, message, path?, field?, expected?, actual?, remediation? }] }] }
```

Bổ sung so với ví dụ hợp đồng (chỉ thêm, không đổi tên): `durationMs`, `registryAvailable`, `registeredVersions`, `fileCount`, `routes`, `issues[].checkId`.

- Lỗi: 409 `SCAN_IN_PROGRESS` (khóa trong tiến trình), 413 `SCAN_LIMIT_EXCEEDED` (> 250 folder), 503 `SCAN_ROOT_UNAVAILABLE`, 500 `SCAN_INTERNAL_ERROR` (không lộ stack). Registry lỗi **không** làm hỏng cả lượt: mỗi package REGISTRY_UNKNOWN + MS-17/18 UNAVAILABLE.

## GET `/api/foundation/module-packages/scans/:scanId`

Trả lại snapshot đã lưu (không quét lại). Cùng hai quyền (`action_code = MODULE_PACKAGE.SCAN_READ` khi từ chối). `scanId` không phải UUID → 400; không có / hết hạn → 404 `SCAN_NOT_FOUND`. Lưu trong RAM 10 phút, tối đa 10 bản (bỏ bản cũ nhất).

## Mã issue

Đủ danh mục tối thiểu của 04_SCAN_RULES và thêm: `MODULE_FOLDER_INVALID`, `MODULE_SCREEN_INVALID`, `SENSITIVE_FILE`, `OLDER_PACKAGE`, `INTEGRITY_UNVERIFIED`, `NOT_EVALUATED` (check không chạy vì điều kiện trước lỗi — luôn là FAIL, không bao giờ PASS).

## Mã băm package `TALO-PACKAGE-HASH-1`

`backend/scripts/module-package.mjs` (dùng chung scanner và `modules:sync`): tệp thường, không theo liên kết, bỏ `.git node_modules dist build coverage generated installed-modules`, không đọc tệp bí mật; sắp theo byte UTF-8 của đường dẫn `/`; mỗi tệp sha256 (tệp văn bản chuẩn hóa CRLF→LF); digest = sha256(`"TALO-PACKAGE-HASH-1\n" + Σ "<len>:<path>:<sha256>\n"`); lstat trước/sau + liệt kê lại cây, khác → không có hash. **Không phải** `manifest_hash` của B02.
