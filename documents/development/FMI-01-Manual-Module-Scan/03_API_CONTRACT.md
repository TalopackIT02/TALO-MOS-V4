# FMI-01 — API Contract v1

**Các endpoint này là đề xuất cần triển khai, không phải API đã có.** Prefix server hiện tại: `/api`.

## 1. POST `/api/foundation/module-packages/scan`

- Request `Content-Type: application/json`, body chính xác `{}`. Không chấp nhận `path`, `moduleKey`, `force`, `execute`, `register` hay trường không biết.
- Cookie session hiện hành, same-origin và Origin/CSRF hiện tại.
- Yêu cầu **cả** READ và CREATE trên Foundation Module Registry.
- Trả 200 khi có báo cáo hoàn chỉnh gồm folder lỗi riêng lẻ, ngay cả khi một package lỗi.

```json
{
  "scanId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "COMPLETED",
  "scannedAt": "2026-10-23T00:00:00.000Z",
  "summary": {"total":1,"passed":0,"warnings":1,"failed":0,"unavailable":0},
  "modules": [
    {
      "folder": "CUSTOMER_MANAGEMENT",
      "moduleKey": "CUSTOMER_MANAGEMENT",
      "moduleName": "Quản lý khách hàng",
      "packageVersion": "0.1.0",
      "classification": "NEW_MODULE",
      "foundationVersionStatus": null,
      "scanStatus": "WARN",
      "eligibleForPreflight": true,
      "packageHash": "0000000000000000000000000000000000000000000000000000000000000000",
      "micFormat": "JSON",
      "checks": [
        {"id":"MS-03","status":"PASS","code":"MANIFEST_VALID","path":"module.json","message":"Manifest hợp lệ."},
        {"id":"MS-19","status":"WARN","code":"TEST_EVIDENCE_PENDING","path":"mic/module.mic.json","message":"Chưa xác minh runtime evidence."}
      ],
      "issues": [{"code":"TEST_EVIDENCE_PENDING","severity":"WARNING","path":"mic/module.mic.json","message":"Chưa xác minh runtime evidence."}]
    }
  ]
}
```

Ghi chú: `packageHash` gồm 64 ký tự `0` chỉ là ví dụ cú pháp, không phải digest thực. Response production phải tính hash thật (64 hex) hoặc trả `null`, tuyệt đối không trả giá trị mẫu. Các trường null hợp lệ khi không đọc được manifest.

### Contracts cụ thể

- `status`: `COMPLETED`; không emit success giả khi lỗi root/registry toàn cục.
- `summary.total = modules.length`; tổng `passed+warnings+failed+unavailable = total`.
- `scanId`: UUID hoặc opaque ID ngẫu nhiên không đoán trước.
- `scannedAt`: ISO-8601 UTC.
- `folder`: tên folder tương đối, không path tuyệt đối.
- `packageVersion`: SemVer hoặc null.
- `classification`: `NEW_MODULE|UPGRADE_CANDIDATE|EXISTING_VERSION|OLDER_PACKAGE|INVALID_PACKAGE|REGISTRY_UNKNOWN`.
- `foundationVersionStatus`: `DRAFT|IN_REVIEW|APPROVED|ACTIVE|RETIRED|REJECTED|null`.
- `scanStatus`: `PASS|WARN|FAIL|UNAVAILABLE`.
- `micFormat`: `JSON|LEGACY_TS|MISSING|INVALID`.
- `checks[].status`: `PASS|WARN|FAIL|UNAVAILABLE`.
- `issues[].severity`: `WARNING|ERROR|UNAVAILABLE`; có `code`, `message`, `path?`, `field?`, `expected?`, `actual?`, `remediation?`.
- `eligibleForPreflight`: Boolean theo static blockers; không bao hàm MIC10 runtime PASS.

## 2. GET `/api/foundation/module-packages/scans/:scanId`

Trả cùng snapshot như lần POST thành công; KHÔNG chạy scan. Snapshot giữ tối đa 10 phút và giới hạn 10 báo cáo gần nhất mỗi Backend instance (đề xuất). Sau hết hạn trả 404 `SCAN_NOT_FOUND`; không tự tạo scan mới. Cả READ+CREATE hoặc ít nhất cùng cấp quyền dùng endpoint POST theo policy hiện tại; không cho người chỉ có READ truy xuất kết quả scan chứa thông tin cấu trúc package nhạy cảm.

## 3. Error response

Tuân Foundation envelope:

```json
{"error":{"code":"SCAN_IN_PROGRESS","message":"Đang có lượt quét khác.","requestId":"request-uuid"}}
```

| Status | Code | Nguyên nhân |
|---|---|---|
| 400 | VALIDATION_ERROR | Body không phải object rỗng, scanId không hợp lệ |
| 401 | Auth hiện có | Thiếu/hết session |
| 403 | FORBIDDEN | Không đủ cả hai quyền |
| 404 | SCAN_NOT_FOUND | Snapshot hết hạn / không có |
| 409 | SCAN_IN_PROGRESS | Lock process-local đang giữ |
| 413 | SCAN_LIMIT_EXCEEDED | Vượt giới hạn toàn lượt, nếu chưa thể trả per-folder an toàn |
| 503 | SCAN_ROOT_UNAVAILABLE | Không thể đọc modules root |
| 503 | REGISTRY_UNAVAILABLE | Không thể xác minh Foundation Registry toàn lượt |
| 500 | SCAN_INTERNAL_ERROR | Lỗi không dự đoán, không lộ stack/details |

Lỗi folder riêng nên được phản ánh trong `modules[].checks/issues`, không biến thành 500 toàn bộ.

## 4. Bảo đảm bất biến

Scan không gọi API đăng ký module (`POST /foundation/modules`), tạo version, PUT manifest, SUBMIT, APPROVE, ACTIVATE, ENABLE, hay các mutation IAM/B09. Scan cũng không gọi `modules:sync`, `spawn`, `child_process`, hoặc import Backend entry.
